"use server";

/**
 * Riwayat Revisi, Revert, dan Log Perubahan — the Server Actions behind
 * PRD #14, #15 and #16.
 *
 * Five actions, three of them reads. Reads are here rather than in a Client
 * Component because `RevisionPanel` is rendered by pages that already fetched
 * their Revisi on the server *and* by pages that did not, and because the uuid
 * → nama resolution behind a readable diff needs four relations at once. Going
 * through a Server Action keeps every one of those queries on the session
 * client, where RLS still decides what comes back.
 *
 * WHAT THIS FILE DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not decide what a revert writes, and it does not write it.
 * `lib/revisions/revert.ts:planRevert()` decides (pure, unit-tested), and the
 * `apply_revert` / `revert_batch` functions in
 * `supabase/migrations/0002_batch_operations.sql` write — one RPC call, one
 * transaction, one Batch of jenis `revert` (ADR-006). Re-implementing either
 * half in TypeScript would scatter a revert across one automatic Batch per
 * statement and quietly break "kembalikan Batch ini".
 *
 * There is no Batch opened here, and none to open: the RPCs open their own.
 *
 * The rules a reader of this file should already know:
 *
 *   * **A revert never deletes.** Reverting an `insert` sets
 *     `status = 'nonaktif'`; the row stays, because a Konsumen may be holding
 *     its id (ADR-003). The UI says so out loud.
 *   * **A revert is a new Revisi**, inside a new Batch. `revisions` is
 *     append-only and `batches` only ever has `reverted_by_batch_id` filled in.
 *   * **A Batch is reverted once.** `revert_batch` locks the row, refuses one
 *     that already carries `reverted_by_batch_id`, and records the new Batch on
 *     it. The button is hidden too, but the server is what makes it true.
 *   * **RLS shortens these lists, and that is correct.** A Revisi is readable
 *     by exactly the people who may read the row it describes: `employee_private`
 *     and `api_keys` are admin-only, `profiles` is admin-or-owner. A viewer
 *     therefore sees fewer rows, not an error — the UI must not present that as
 *     data loss.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ReferenceIds, ReferenceLabels } from "@/components/revisions/revisionDiff";
import {
  countRevisionsInBatch,
  getBatchById,
  getRevisionById,
  listRevisionsByBatch,
  listRevisionsByRow,
} from "@/lib/db/revisions";
import { DbError, type DbClient } from "@/lib/db/shared";
import { applyRevert, planRevert, revertBatch as revertBatchRpc } from "@/lib/revisions/revert";
import type { RevertSkipped } from "@/lib/revisions/revert";
import { LOGGED_TABLES, type LoggedTable } from "@/lib/revisions/tables";
import type { Revision } from "@/lib/types/db";
import { uuidField } from "@/lib/validation/common";

import {
  actionFail,
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  requireUser,
  toActionFailure,
  type ActionErrorCode,
  type ActionFailure,
  type ActionResult,
} from "./_guard";

/**
 * Ceiling on one Riwayat Revisi read.
 *
 * Not exported: a `"use server"` file may export only async functions, and the
 * panel does not need the number — it asks for what it shows.
 */
const MAX_ROW_REVISIONS = 200;

/**
 * How many Revisi of one Batch the Log Perubahan renders.
 *
 * A `seed` Batch holds ~3.000 of them; rendering all of them would freeze the
 * page and resolve thousands of names to fill a list nobody scrolls. The page
 * says how many are not shown, and reverting the Batch still covers every one —
 * that happens in SQL, over the whole Batch, not over what is on screen.
 */
const MAX_BATCH_REVISIONS = 100;

/**
 * Ceiling on one `in (…)` list of ids to resolve.
 *
 * Applied by trimming, not by refusing: a request that somehow carries more
 * than this still gets names for what fits, which beats a page where every
 * reference reads "(tidak dikenal)". Unreachable in practice — one page of
 * Revisi cannot name this many distinct rows.
 */
const MAX_IDS_PER_ENTITY = 2000;

/** Pages that show data from each logged table, for `revalidatePath`. */
const PATHS_BY_TABLE: Record<LoggedTable, readonly string[]> = {
  // `/struktur` is in this row because the tree prints Karyawan counts per
  // Unit Organisasi: reverting a Revisi that moved someone moves two numbers
  // there. It matches `revalidateEmployeePages()` in `lib/actions/employees.ts`.
  employees: ["/karyawan", "/struktur", "/bereskan"],
  employee_private: ["/karyawan"],
  org_units: ["/struktur", "/karyawan", "/bereskan"],
  jabatan: ["/jabatan", "/karyawan", "/bereskan"],
  lookups: ["/master-data", "/karyawan", "/bereskan"],
  api_keys: ["/api-keys"],
  profiles: ["/pengguna"],
};

/** A Batch can touch any table, so reverting one refreshes everything. */
const ALL_PATHS: readonly string[] = [
  "/karyawan",
  "/struktur",
  "/jabatan",
  "/master-data",
  "/bereskan",
  "/api-keys",
  "/pengguna",
];

function revalidate(paths: readonly string[]): void {
  for (const path of new Set(["/log", ...paths])) revalidatePath(path);
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * SQLSTATE → `ActionErrorCode`, for the errors our own SQL raises.
 *
 * `42501` and `22023` carry sentences written by `0002_batch_operations.sql`
 * itself — "Hanya admin yang boleh mengembalikan Revisi.", "Tidak ada Revisi di
 * Batch ini yang bisa dikembalikan." — so they are shown verbatim. `55000`
 * (already reverted) and `P0002` (row or Batch gone) are re-worded below,
 * because the database's version of those names a uuid and staf HC should never
 * have to read one.
 *
 * `22023` is `KONFLIK`, not `VALIDASI`: by the time an RPC sees these arguments
 * zod has already checked their shape, so the only way to reach it is a plan
 * with nothing revertable in it — which is a state, not a typo.
 */
const CODE_BY_SQLSTATE: Record<string, ActionErrorCode> = {
  "42501": "BUKAN_ADMIN",
  "22023": "KONFLIK",
  "55000": "KONFLIK",
  P0002: "TIDAK_DITEMUKAN",
  // PostgREST, not Postgres: a row the reader may not see behaves as absent.
  PGRST116: "TIDAK_DITEMUKAN",
};

const REWORDED_BY_SQLSTATE: Record<string, string> = {
  "55000":
    "Batch ini sudah pernah dikembalikan. Satu Batch hanya bisa dikembalikan sekali.",
  P0002:
    "Data yang akan dikembalikan tidak ditemukan lagi. Muat ulang halaman ini, lalu coba lagi.",
  PGRST116:
    "Data yang akan dikembalikan tidak ditemukan lagi. Muat ulang halaman ini, lalu coba lagi.",
};

/**
 * Turn a failed revert into something a toast can say.
 *
 * `applyRevert()` / `revertBatch()` wrap PostgREST errors in `DbError`, which
 * keeps the SQLSTATE. Anything without one is unexpected: it is logged and
 * reported generically, exactly as `_guard.ts` asks.
 */
function revertFailure(error: unknown, fallback: string): ActionError {
  if (!(error instanceof DbError)) {
    console.error("[revisions]", error);
    return new ActionError("GAGAL", fallback);
  }

  const sqlstate = error.code ?? "";
  const code = CODE_BY_SQLSTATE[sqlstate];
  if (!code) {
    console.error("[revisions]", error);
    return new ActionError("GAGAL", fallback);
  }

  const reworded = REWORDED_BY_SQLSTATE[sqlstate];
  if (reworded) {
    console.error("[revisions]", error);
    return new ActionError(code, reworded);
  }

  // `DbError` prefixes its context ("Gagal mengembalikan Revisi: …"); the
  // sentence our SQL wrote is what is worth showing.
  const message = error.message.split(": ").slice(1).join(": ") || error.message;
  return new ActionError(code, message);
}

/**
 * Wrap a read inside a write, so a failed database read says so.
 *
 * Without this, a pre-read that fails inside a revert surfaces as "Gagal
 * menyimpan perubahan" — the generic write message from `_guard.ts` — which
 * points the reader at the wrong half of the action.
 */
async function reading<T>(pesan: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof DbError) {
      console.error("[revisions]", error);
      throw new ActionError("GAGAL", pesan);
    }
    throw error;
  }
}

/** A read that failed is never the user's fault; say what did not load. */
function readFailure(error: unknown, pesan: string): ActionFailure {
  if (error instanceof DbError) {
    console.error("[revisions]", error);
    return actionFail("GAGAL", pesan);
  }
  return toActionFailure(error);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const loggedTableSchema = z.enum(LOGGED_TABLES, {
  error: "Tabel ini tidak punya Riwayat Revisi.",
});

const rowRevisionsSchema = z.object({
  table: loggedTableSchema,
  rowId: uuidField("Baris"),
  limit: z.coerce.number().int().min(1).max(MAX_ROW_REVISIONS).optional(),
});

export type LoadRowRevisionsInput = {
  /** One of the seven logged tables. */
  table: LoggedTable;
  /** `revisions.row_id`: `employees.id`, or `employee_private.employee_id`. */
  rowId: string;
  /** Default 50, capped at 200. */
  limit?: number;
};

/**
 * Riwayat Revisi of one row, newest first (PRD #14).
 *
 * Any signed-in user may read the log (ARCHITECTURE.md §5); RLS decides which
 * rows that means. A viewer asking for an `employee_private` row gets an empty
 * list, not an error.
 */
export async function loadRowRevisions(
  input: LoadRowRevisionsInput,
): Promise<ActionResult<{ revisions: Revision[] }>> {
  const parsed = rowRevisionsSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { table, rowId, limit } = parsed.data;

  try {
    const { client } = await requireUser();
    const revisions = await listRevisionsByRow(client, {
      table,
      rowId,
      limit: limit ?? 50,
    });
    return actionOk({ revisions });
  } catch (error) {
    return readFailure(error, "Gagal memuat Riwayat Revisi.");
  }
}

const batchRevisionsSchema = z.object({
  batchId: uuidField("Batch"),
  limit: z.coerce.number().int().min(1).max(MAX_BATCH_REVISIONS).optional(),
});

export type LoadBatchRevisionsInput = {
  batchId: string;
  /** Default and maximum: 100. */
  limit?: number;
};

/**
 * The Revisi inside one Batch — what an expanded row on `/log` shows (PRD #16).
 *
 * `total` is one more than `revisions.length` can be: it is what a Batch of
 * this size holds, so the page can say "menampilkan 100 dari 2.950" instead of
 * pretending the Batch is small. Both numbers are already filtered by RLS.
 */
export async function loadBatchRevisions(
  input: LoadBatchRevisionsInput,
): Promise<ActionResult<{ revisions: Revision[]; total: number }>> {
  const parsed = batchRevisionsSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { batchId, limit } = parsed.data;
  const take = limit ?? MAX_BATCH_REVISIONS;

  try {
    const { client } = await requireUser();
    const [revisions, total] = await Promise.all([
      listRevisionsByBatch(client, batchId, { limit: take }),
      countRevisionsInBatch(client, batchId),
    ]);
    return actionOk({ revisions, total });
  } catch (error) {
    return readFailure(error, "Gagal memuat Revisi dalam Batch.");
  }
}

/**
 * No `.max()` here on purpose: the ceiling is applied by `capped()` when the
 * query is built, so an over-long list loses its tail instead of failing the
 * whole request and leaving every name on screen as "(tidak dikenal)". The
 * `z.uuid()` per element is what keeps the input a list of ids.
 */
const idListSchema = z.array(z.uuid()).default([]);

const referenceIdsSchema = z.object({
  org_units: idListSchema,
  jabatan: idListSchema,
  lookups: idListSchema,
  employees: idListSchema,
  profiles: idListSchema,
});

export type ResolveRevisionLabelsInput = {
  /** Ids per relation. Omitted relations are simply not queried. */
  ids: Partial<ReferenceIds>;
};

/**
 * uuid → the name a human recognises, for every reference in a set of Revisi.
 *
 * This is what stands between staf HC and a diff that reads
 * `org_unit_id: 3f2a… → 9b1c…`. Five relations, one query each, only the ids
 * actually on screen.
 *
 * Missing keys are normal and must not be treated as an error: `profiles` is
 * readable only by an admin or its owner, so a viewer cannot resolve a
 * colleague's email. `actorLabel()` falls back to a short id rather than
 * claiming the actor is unknown.
 */
export async function resolveRevisionLabels(
  input: ResolveRevisionLabelsInput,
): Promise<ActionResult<{ labels: ReferenceLabels }>> {
  const parsed = referenceIdsSchema.safeParse(input?.ids ?? {});
  if (!parsed.success) return actionInvalid(parsed.error);
  const ids = parsed.data;

  try {
    const { client } = await requireUser();
    const labels: Record<string, string> = {};

    const [orgUnits, jabatan, lookups, employees, profiles] = await Promise.all([
      readOrgUnitLabels(client, ids.org_units),
      readJabatanLabels(client, ids.jabatan),
      readLookupLabels(client, ids.lookups),
      readEmployeeLabels(client, ids.employees),
      readProfileLabels(client, ids.profiles),
    ]);

    for (const group of [orgUnits, jabatan, lookups, employees, profiles]) {
      Object.assign(labels, group);
    }

    return actionOk({ labels });
  } catch (error) {
    return readFailure(error, "Gagal memuat nama data referensi.");
  }
}

/** Cap one `in (…)` list; the UI never sends this many distinct references. */
function capped(ids: readonly string[]): string[] {
  return ids.slice(0, MAX_IDS_PER_ENTITY);
}

async function readOrgUnitLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("org_units")
    .select("id, nama, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Unit Organisasi", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.nama} (${row.kode})`]),
  );
}

async function readJabatanLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("jabatan")
    .select("id, nama, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Jabatan", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.nama} (${row.kode})`]),
  );
}

async function readLookupLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("lookups")
    .select("id, label, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Lookup", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.label} (${row.kode})`]),
  );
}

async function readEmployeeLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  // `employees`, not `v_employees_private`: that view INNER JOINs
  // `employee_private`, so a viewer would get zero rows (ADR-005 §10).
  const { data, error } = await client
    .from("employees")
    .select("id, full_name, personnel_number")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Karyawan", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.full_name} · ${row.personnel_number}`]),
  );
}

async function readProfileLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  // RLS: an admin sees everyone, a viewer only themselves. Fewer rows than ids
  // is the normal case, not a failure.
  const { data, error } = await client
    .from("profiles")
    .select("id, email")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Pengguna", error);
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.email]));
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

const revertRevisionSchema = z.object({
  revisionId: z.coerce
    .number({ error: "Revisi harus dipilih dari daftar." })
    .int({ error: "Revisi harus dipilih dari daftar." })
    .positive({ error: "Revisi harus dipilih dari daftar." }),
});

export type RevertRevisionInput = { revisionId: number };

export type RevertRevisionResult = {
  /** The new Batch of jenis `revert` that holds the undo. */
  batchId: string;
  /** The Revisi that was undone. */
  revisionId: number;
  /**
   * How many rows the revert actually wrote — normally 1.
   *
   * Zero is possible and the UI must say so rather than claim success: an RLS
   * policy written `using (is_admin())` refuses by matching **no rows**, not by
   * raising `42501`. `apply_revert_operation` turns that into a loud `P0002`
   * for the six data tables, but `profiles` is deliberately left out of that
   * check (its rows cascade from `auth.users`), so a Revisi there can write
   * nothing and still return.
   */
  applied: number;
  /** Why a Revisi could not be undone, in Indonesian, ready to show. */
  skipped: RevertSkipped[];
};

/**
 * Kembalikan satu Revisi (PRD #15).
 *
 * Reverting an `update` writes `before` back over the row. Reverting an
 * `insert` sets `status = 'nonaktif'` — the row is not deleted, and there is no
 * code path in HC Core that deletes one.
 *
 * The plan comes from `planRevert()`, the pure planner that
 * `lib/revisions/revert.test.ts` covers; `apply_revert` re-checks every
 * decision in SQL before writing, because a plan arrives as data and data is
 * not trusted.
 */
export async function revertRevision(
  input: RevertRevisionInput,
): Promise<ActionResult<RevertRevisionResult>> {
  const parsed = revertRevisionSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { revisionId } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const revision = await reading(
      "Gagal memeriksa Revisi yang akan dikembalikan. Coba lagi.",
      getRevisionById(client, revisionId),
    );
    if (!revision) {
      throw new ActionError(
        "TIDAK_DITEMUKAN",
        "Revisi ini tidak ditemukan, atau Anda tidak berhak membacanya.",
      );
    }

    const plan = planRevert([revision]);
    if (plan.operations.length === 0) {
      // The planner already worded why, in Indonesian, for this exact screen.
      throw new ActionError(
        "KONFLIK",
        plan.skipped[0]?.keterangan ?? "Revisi ini tidak bisa dikembalikan.",
      );
    }

    let result;
    try {
      result = await applyRevert(plan, client);
    } catch (error) {
      throw revertFailure(error, "Gagal mengembalikan Revisi. Coba lagi.");
    }

    revalidate(PATHS_BY_TABLE[plan.operations[0].table]);

    return actionOk({
      batchId: result.batchId,
      revisionId,
      applied: result.applied,
      skipped: result.skipped,
    });
  } catch (error) {
    return toActionFailure(error);
  }
}

const revertBatchSchema = z.object({ batchId: uuidField("Batch") });

export type RevertBatchInput = { batchId: string };

export type RevertBatchResult = {
  /** The new Batch of jenis `revert`. */
  batchId: string;
  /** The Batch that was undone; its `reverted_by_batch_id` now points at `batchId`. */
  revertedBatchId: string;
  applied: number;
  skipped: RevertSkipped[];
};

/**
 * Kembalikan satu Batch utuh (PRD #16).
 *
 * Everything happens inside `revert_batch`: it locks the Batch, refuses one
 * that has already been reverted, plans its Revisi in descending id order (the
 * order that makes a Merge come back cleanly), applies them in one new Batch,
 * and fills in `reverted_by_batch_id`.
 *
 * The check below is not the guard — the RPC is. It exists so that a Batch
 * reverted in another tab produces "sudah pernah dikembalikan" instead of a
 * database error, and so the read happens before an admin is asked to confirm.
 */
export async function revertBatch(
  input: RevertBatchInput,
): Promise<ActionResult<RevertBatchResult>> {
  const parsed = revertBatchSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { batchId } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const batch = await reading(
      "Gagal memeriksa Batch yang akan dikembalikan. Coba lagi.",
      getBatchById(client, batchId),
    );
    if (!batch) {
      throw new ActionError("TIDAK_DITEMUKAN", "Batch ini tidak ditemukan.");
    }
    if (batch.reverted_by_batch_id) {
      throw new ActionError(
        "KONFLIK",
        REWORDED_BY_SQLSTATE["55000"] ?? "Batch ini sudah pernah dikembalikan.",
      );
    }

    let result;
    try {
      result = await revertBatchRpc(batchId, client);
    } catch (error) {
      throw revertFailure(error, "Gagal mengembalikan Batch. Coba lagi.");
    }

    revalidate(ALL_PATHS);

    return actionOk({
      batchId: result.batchId,
      revertedBatchId: result.revertedBatchId,
      applied: result.applied,
      skipped: result.skipped,
    });
  } catch (error) {
    return toActionFailure(error);
  }
}
