/**
 * Revert — split into a pure planner and an impure applier.
 *
 * `planRevert()` is pure and unit-tested (`revert.test.ts`). `applyRevert()`
 * hands the plan it produces to the `apply_revert` RPC; `revertBatch()` undoes
 * a whole Batch through the `revert_batch` RPC. Both signatures are frozen.
 *
 * WHY THE WRITES LIVE IN SQL
 * ---------------------------------------------------------------------------
 * `begin_batch()` sets `app.batch_id` transaction-locally, and over PostgREST
 * every statement is its own transaction — so a revert driven from TypeScript,
 * one UPDATE per round trip, would scatter its Revisi across one automatic
 * `edit` Batch per statement instead of collecting them in the `revert` Batch
 * it opened. `supabase/migrations/0002_batch_operations.sql` therefore performs
 * the whole revert inside one function call: one transaction, one Batch
 * (ADR-006). These wrappers validate the answer and carry `skipped` through.
 *
 * Why the planner/applier split: revert is the feature that is most expensive
 * to get wrong —
 * it writes to real Karyawan rows, on the strength of a jsonb snapshot, at the
 * moment an admin has already made one mistake. Deciding *what* to write is
 * pure data-in/data-out and therefore testable without a database; only the
 * writing itself needs one.
 *
 * The rules (ARCHITECTURE.md §4C, ADR-003):
 *
 *   * A revert never edits or deletes the log. It performs new writes, which
 *     the `log_revision` trigger records as new Revisi inside a Batch of jenis
 *     `revert`.
 *   * Reverting an `update` writes `before` back over the row.
 *   * Reverting an `insert` sets `status = 'nonaktif'` — it does **not** delete
 *     the row; DELETE is refused by trigger on all six data tables, and a
 *     Konsumen may already be holding that id (ADR-003).
 *   * A Batch is reverted **in descending `revisions.id` order**, so that a row
 *     touched twice ends up at its oldest `before`.
 *   * `profiles` is the seventh logged table (ADR-005 §12), so role changes
 *     appear here like everything else. It has no `status` column, so its
 *     `insert` Revisi cannot be reverted — that is reported, not invented.
 */
import type { Json, Revision } from "@/lib/types/db";
import { DbError, type DbClient } from "@/lib/db/shared";

import {
  columnsOf,
  hasStatusColumn,
  isLoggedTable,
  LOGGED_TABLE_LABELS,
  NON_RESTORABLE_COLUMNS,
  PK_COLUMN_BY_TABLE,
  REVISION_ACTIONS,
  type LoggedTable,
  type PkColumn,
} from "./tables";

/**
 * The parts of a `revisions` row a plan is built from.
 *
 * Deliberately a `Pick`, not the whole row: a test can build one by hand, and
 * a caller can hand over whatever `lib/db/revisions.ts` returned.
 */
export type RevertableRevision = Pick<
  Revision,
  "id" | "table_name" | "row_id" | "action" | "before" | "after"
>;

/** What a single step does. */
export type RevertOperationKind =
  /** Write `before` back over the row (reverting an `update`). */
  | "restore"
  /** Set `status = 'nonaktif'` (reverting an `insert`; never a DELETE). */
  | "deactivate";

export type RevertOperation = {
  /** The Revisi being undone. */
  revisionId: number;
  table: LoggedTable;
  /** `"id"` everywhere except `employee_private`, keyed by `employee_id`. */
  pkColumn: PkColumn;
  rowId: string;
  kind: RevertOperationKind;
  /** Column → value to write. Never contains the pk, `created_at`, `updated_at`. */
  values: Record<string, Json>;
};

export type RevertSkipReason =
  /** `table_name` is not one of the seven logged tables. */
  | "tabel_tidak_dikenal"
  /** `action` is neither `insert` nor `update`. */
  | "aksi_tidak_dikenal"
  /** An `update` Revisi with no `before` snapshot (the CHECK forbids it). */
  | "before_kosong"
  /** An `insert` on a table with no `status` column (`employee_private`, `profiles`). */
  | "tanpa_kolom_status"
  /** `before` held nothing this schema can still write. */
  | "tidak_ada_kolom_dipulihkan";

export type RevertSkipped = {
  revisionId: number;
  tableName: string;
  rowId: string;
  reason: RevertSkipReason;
  /** Indonesian, ready to show next to the Revisi in the UI. */
  keterangan: string;
};

/**
 * Everything needed to perform a revert, and nothing that needs a database.
 *
 * `operations` are already in application order (descending Revisi id).
 */
export type RevertPlan = {
  /** Always `"revert"` — the jenis of the Batch that will apply this plan. */
  jenis: "revert";
  /** `batches.keterangan` for that Batch. */
  keterangan: string;
  operations: RevertOperation[];
  /** Revisi that cannot be reverted, each with a reason to show the admin. */
  skipped: RevertSkipped[];
};

export type PlanRevertOptions = {
  /** Overrides the generated `keterangan`. */
  keterangan?: string;
};

export type RevertResult = {
  /** The `revert` Batch that was created. */
  batchId: string;
  /** How many operations were written. */
  applied: number;
  /** Carried over from the plan, so the caller can report them. */
  skipped: RevertSkipped[];
};

const SKIP_MESSAGES: Record<RevertSkipReason, string> = {
  tabel_tidak_dikenal:
    "Tabel ini tidak termasuk tujuh tabel ter-log, jadi Revisi-nya tidak bisa dikembalikan.",
  aksi_tidak_dikenal: "Aksi Revisi tidak dikenal (hanya insert dan update yang ada).",
  before_kosong: "Revisi update ini tidak menyimpan keadaan sebelumnya.",
  tanpa_kolom_status:
    "Baris ini dibuat oleh Revisi tersebut dan tabelnya tidak punya kolom status, sehingga tidak bisa dinonaktifkan. Hapus permanen tidak pernah dilakukan.",
  tidak_ada_kolom_dipulihkan:
    "Tidak ada kolom yang masih dikenal skema saat ini untuk dipulihkan.",
};

function skip(
  revision: RevertableRevision,
  reason: RevertSkipReason,
): RevertSkipped {
  return {
    revisionId: revision.id,
    tableName: revision.table_name,
    rowId: revision.row_id,
    reason,
    keterangan: SKIP_MESSAGES[reason],
  };
}

function isJsonObject(value: Json | null): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Columns of `before` that may be written back.
 *
 * Unknown columns are dropped rather than failing the whole revert: a Revisi
 * written before a column was removed must still be usable (ADR-003
 * "abaikan kolom tak dikenal"). The primary key is dropped because it is the
 * WHERE clause, and `created_at` / `updated_at` because they are the row's own
 * history — `set_updated_at` will move `updated_at` forward, as it should.
 */
function restorableValues(
  table: LoggedTable,
  before: { [key: string]: Json },
): Record<string, Json> {
  const known = columnsOf(table);
  const pk: string = PK_COLUMN_BY_TABLE[table];
  const values: Record<string, Json> = {};
  for (const column of known) {
    if (column === pk) continue;
    if ((NON_RESTORABLE_COLUMNS as readonly string[]).includes(column)) continue;
    if (!(column in before)) continue;
    values[column] = before[column];
  }
  return values;
}

function defaultKeterangan(operations: RevertOperation[]): string {
  if (operations.length === 0) return "Revert tanpa perubahan";
  if (operations.length === 1) {
    const [op] = operations;
    return `Kembalikan Revisi #${op.revisionId} pada ${LOGGED_TABLE_LABELS[op.table]}`;
  }
  const tables = [...new Set(operations.map((op) => LOGGED_TABLE_LABELS[op.table]))];
  return `Kembalikan ${operations.length} Revisi pada ${tables.join(", ")}`;
}

/**
 * Decide what a revert should write — pure, no database, no clock.
 *
 * Hand it one Revisi to revert a single change (PRD #15), or every Revisi of a
 * Batch to revert the whole thing (PRD #16). Order of the input does not
 * matter: operations come back sorted by `revisionId` descending, which is the
 * order they must be applied in.
 *
 * A row that appears twice produces two operations; applying them in order
 * leaves the row at the oldest `before`, which is what "kembalikan Batch ini"
 * means.
 */
export function planRevert(
  revisions: readonly RevertableRevision[],
  options?: PlanRevertOptions,
): RevertPlan {
  const ordered = [...revisions].sort((a, b) => b.id - a.id);

  const operations: RevertOperation[] = [];
  const skipped: RevertSkipped[] = [];

  for (const revision of ordered) {
    const table = revision.table_name;
    if (!isLoggedTable(table)) {
      skipped.push(skip(revision, "tabel_tidak_dikenal"));
      continue;
    }

    if (!(REVISION_ACTIONS as readonly string[]).includes(revision.action)) {
      skipped.push(skip(revision, "aksi_tidak_dikenal"));
      continue;
    }

    if (revision.action === "insert") {
      if (!hasStatusColumn(table)) {
        skipped.push(skip(revision, "tanpa_kolom_status"));
        continue;
      }
      operations.push({
        revisionId: revision.id,
        table,
        pkColumn: PK_COLUMN_BY_TABLE[table],
        rowId: revision.row_id,
        kind: "deactivate",
        values: { status: "nonaktif" },
      });
      continue;
    }

    if (!isJsonObject(revision.before)) {
      skipped.push(skip(revision, "before_kosong"));
      continue;
    }

    const values = restorableValues(table, revision.before);
    if (Object.keys(values).length === 0) {
      skipped.push(skip(revision, "tidak_ada_kolom_dipulihkan"));
      continue;
    }

    operations.push({
      revisionId: revision.id,
      table,
      pkColumn: PK_COLUMN_BY_TABLE[table],
      rowId: revision.row_id,
      kind: "restore",
      values,
    });
  }

  return {
    jenis: "revert",
    keterangan: options?.keterangan ?? defaultKeterangan(operations),
    operations,
    skipped,
  };
}

/** What `revertBatch()` returns: a `RevertResult` plus what it undid. */
export type RevertBatchResult = RevertResult & {
  /** The Batch that was undone; its `reverted_by_batch_id` now points at `batchId`. */
  revertedBatchId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readBatchId(data: unknown, context: string): string {
  const row = asRecord(data);
  const batchId = row?.batch_id;
  if (typeof batchId !== "string") {
    throw new Error(`${context}: database tidak mengembalikan id Batch.`);
  }
  return batchId;
}

function readApplied(data: unknown): number {
  const applied = asRecord(data)?.applied;
  return typeof applied === "number" && Number.isFinite(applied) ? applied : 0;
}

const SKIP_REASONS = Object.keys(SKIP_MESSAGES) as RevertSkipReason[];

/**
 * Decode the `skipped` array `revert_batch` returns.
 *
 * The SQL side builds the same shape `planRevert()` does (ADR-006); anything
 * that does not fit is dropped rather than shown as a malformed row, because
 * `skipped` is explanatory text next to a successful revert, not the result.
 */
function readSkipped(data: unknown): RevertSkipped[] {
  const raw = asRecord(data)?.skipped;
  if (!Array.isArray(raw)) return [];
  const out: RevertSkipped[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const revisionId = row.revisionId;
    const tableName = row.tableName;
    const rowId = row.rowId;
    const reason = row.reason;
    if (
      typeof revisionId !== "number" ||
      typeof tableName !== "string" ||
      typeof rowId !== "string" ||
      typeof reason !== "string" ||
      !(SKIP_REASONS as readonly string[]).includes(reason)
    ) {
      continue;
    }
    const typedReason = reason as RevertSkipReason;
    out.push({
      revisionId,
      tableName,
      rowId,
      reason: typedReason,
      keterangan:
        typeof row.keterangan === "string" && row.keterangan.length > 0
          ? row.keterangan
          : SKIP_MESSAGES[typedReason],
    });
  }
  return out;
}

/**
 * Perform a plan: open a Batch of jenis `revert`, apply every operation in
 * order, and return what happened (PRD #15).
 *
 * The whole plan goes to the `apply_revert` RPC as one jsonb argument, so the
 * Batch and every write it groups share one transaction. The database re-checks
 * everything the planner decided — the table is one of the seven logged ones,
 * the pk column is the right one for it, a `deactivate` writes
 * `status = 'nonaktif'` and nothing else — because a plan arrives as data and
 * data is not to be trusted.
 *
 * `plan.skipped` is carried through untouched so the UI can explain what was
 * left out. A plan with no operations is refused rather than opening an empty
 * Batch that would clutter the Log Perubahan.
 *
 * Reverting a whole Batch is `revertBatch()`, not this: a `RevertPlan`
 * deliberately does not carry a Batch id, and `batches.reverted_by_batch_id`
 * has to be set by whoever knows it.
 */
export async function applyRevert(
  plan: RevertPlan,
  client: DbClient,
): Promise<RevertResult> {
  const { data, error } = await client.rpc("apply_revert", {
    // `RevertPlan` is plain JSON by construction (`values` is Record<string, Json>).
    p_plan: plan as unknown as Json,
  });

  if (error) throw new DbError("Gagal mengembalikan Revisi", error);

  return {
    batchId: readBatchId(data, "Gagal mengembalikan Revisi"),
    applied: readApplied(data),
    skipped: plan.skipped,
  };
}

/**
 * Kembalikan satu Batch utuh (PRD #16, ARCHITECTURE.md §4C).
 *
 * The `revert_batch` RPC does the whole thing in one transaction: it locks the
 * Batch, refuses one that already carries `reverted_by_batch_id`, plans its
 * Revisi **in descending `revisions.id` order** with the same rules as
 * `planRevert()`, applies them inside one new Batch of jenis `revert`, and
 * finally fills in `reverted_by_batch_id` — the only column of `batches` that
 * may ever be written (ADR-003).
 *
 * Descending order is what makes a Merge revert cleanly: the source Unit
 * Organisasi comes back to `aktif` before its children are re-parented onto
 * it, and a row touched twice ends at its oldest `before`.
 */
export async function revertBatch(
  batchId: string,
  client: DbClient,
  options?: { keterangan?: string },
): Promise<RevertBatchResult> {
  const { data, error } = await client.rpc("revert_batch", {
    p_batch_id: batchId,
    p_keterangan: options?.keterangan,
  });

  if (error) throw new DbError("Gagal mengembalikan Batch", error);

  return {
    batchId: readBatchId(data, "Gagal mengembalikan Batch"),
    applied: readApplied(data),
    skipped: readSkipped(data),
    revertedBatchId: batchId,
  };
}
