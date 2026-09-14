/**
 * `withBatch()` — every write from the UI runs inside one Batch.
 *
 * FROZEN CONTRACT (Wave 1). ARCHITECTURE.md §4A and §6: a Server Action opens
 * a Batch, does its writes, and closes it; the `log_revision` trigger attaches
 * each Revisi to whatever `app.batch_id` is set, so that one action shows up
 * in the Log Perubahan as one line that can be reverted as a unit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHEN TO USE THIS, AND WHEN TO USE AN RPC INSTEAD
 * ────────────────────────────────────────────────────────────────────────────
 * `begin_batch(p_jenis, p_keterangan, p_local default true)` sets
 * `app.batch_id` with `set_config(..., p_local)`:
 *
 *   * `p_local = true` (the default, and what this helper uses) scopes the
 *     setting to the current **transaction**.
 *   * `p_local = false` scopes it to the **session**, i.e. to whichever pooled
 *     connection happened to serve the call. If the request dies before
 *     `end_batch()`, the next request on that connection inherits the batch id
 *     and another admin's writes get folded into this Batch — and then
 *     "kembalikan Batch ini" undoes their work too. ADR-005 §9 made `true` the
 *     default for exactly that reason.
 *
 * supabase-js speaks HTTP: `begin_batch`, each write and `end_batch` are
 * separate requests and therefore separate transactions. So with the safe
 * default, a write in `fn` does **not** see `app.batch_id`, and the trigger
 * opens an automatic `edit` Batch for it (which is why no change can ever
 * escape the log). Two consequences, and both still hold:
 *
 *   * Grouping is guaranteed **per statement**: everything one UPDATE touches
 *     shares one Batch — the trigger's automatic one.
 *   * The Batch this helper opens carries `jenis` and `keterangan` and is what
 *     the Log Perubahan shows for the action, but the Revisi hang off that
 *     automatic Batch instead. Expect TWO rows on `/log`. Use `keterangan`
 *     generously so a human can still read the log.
 *
 * WHAT CHANGED, AND THE RULE THAT FOLLOWS (ADR-006)
 * ────────────────────────────────────────────────────────────────────────────
 * The old version of this comment said none of it could be fixed without a
 * server-side function and a schema change. That is what ADR-006 did, for the
 * operations where per-statement grouping was not merely untidy but wrong:
 *
 *   * **More than one statement → a Postgres function, never this helper.** A
 *     Merge is three UPDATEs across two tables; a Seed is ~1.475 inserts; a
 *     Batch revert is one UPDATE per Revisi. Driving those from here scatters
 *     them across one Batch per statement and breaks "satu Batch bisa
 *     dibalikkan utuh" (CONTEXT.md, PRD #16). They now live in
 *     `supabase/migrations/0002_batch_operations.sql` — `merge_org_unit`,
 *     `merge_jabatan`, `merge_lookup`, `apply_revert`, `revert_batch` — where
 *     one RPC call is one transaction and one real Batch. **Those functions
 *     open their own Batch: never wrap an RPC in `withBatch()`.**
 *   * **A script that owns its connection → a real transaction.**
 *     `lib/revisions/seedBatch.ts` connects with `pg`, opens `BEGIN`, calls
 *     `begin_batch(..., p_local => true)` and commits. Same safe scope,
 *     covering as many statements as the script likes.
 *   * **One statement per action → still this helper.** Renaming a Jabatan,
 *     editing one Karyawan, deactivating one row. You get the named Batch plus
 *     the trigger's automatic one, exactly as described above; the change
 *     itself is still fully logged and still revertable one Revisi at a time
 *     (`planRevert()` + `applyRevert()`), which is what PRD #15 asks for.
 *     Reverting *the named Batch* of such an action would find it empty — if a
 *     future action needs whole-Batch revert, it belongs in SQL like the ones
 *     above. `lib/actions/_reference.ts` is the worked example.
 *
 * `sessionScoped: true` (→ `p_local = false`) remains available for a caller
 * that owns its connection end to end, but nothing in HC Core needs it any
 * more: `seedBatch.ts` gets real grouping from a real transaction without the
 * leak. Never pass it from a Server Action on a pooled connection.
 */
import type { DbClient } from "@/lib/db/shared";

import { BATCH_JENIS, type BatchJenis } from "./tables";

export { BATCH_JENIS, type BatchJenis };

export type BatchOptions = {
  /** Why this Batch exists — one of the seven values of the CHECK constraint. */
  jenis: BatchJenis;
  /** Human-readable, Indonesian, shown verbatim in the Log Perubahan. */
  keterangan?: string | null;
  /**
   * Opt into a SESSION-scoped `app.batch_id` (`p_local = false`).
   *
   * Only for a caller that owns its connection end to end — a maintenance
   * script. Never from a Server Action: see the header. The Seed does **not**
   * need it; `lib/revisions/seedBatch.ts` gets real grouping from a real
   * transaction instead (ADR-006).
   */
  sessionScoped?: boolean;
};

/** What the callback receives. */
export type BatchContext = {
  client: DbClient;
  /** `batches.id` — the Batch this action opened. */
  batchId: string;
};

export type BatchOutcome<T> = {
  batchId: string;
  result: T;
};

/** Thrown when the Batch itself could not be opened or closed. */
export class BatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "BatchError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Open a Batch, run `fn`, close the Batch — even when `fn` throws.
 *
 * Authorisation is checked in three places and all three are meant:
 * `requireAdmin()` in the Server Action, `is_admin()` inside `begin_batch`,
 * and the RLS policy on the table being written (CLAUDE.md: "Cek role di
 * Server Action **dan** RLS — keduanya").
 */
export async function withBatch<T>(
  client: DbClient,
  options: BatchOptions,
  fn: (ctx: BatchContext) => Promise<T>,
): Promise<BatchOutcome<T>> {
  const batchId = await beginBatch(client, options);
  try {
    const result = await fn({ client, batchId });
    return { batchId, result };
  } finally {
    // Never let a failure to clear `app.batch_id` replace the real error: the
    // caller needs to see why the write failed, not why the cleanup did.
    await endBatch(client).catch((error: unknown) => {
      console.error("end_batch gagal setelah Batch selesai:", error);
    });
  }
}

/**
 * Low-level: open a Batch and return its id.
 *
 * Prefer `withBatch()`, which cannot forget to call `endBatch()`.
 */
export async function beginBatch(
  client: DbClient,
  options: BatchOptions,
): Promise<string> {
  if (!(BATCH_JENIS as readonly string[]).includes(options.jenis)) {
    throw new BatchError(`Jenis Batch tidak dikenal: ${options.jenis}`);
  }

  const { data, error } = await client.rpc("begin_batch", {
    p_jenis: options.jenis,
    p_keterangan: options.keterangan ?? undefined,
    // Passing it explicitly documents the choice at the call site; `true` is
    // also the function's own default (ADR-005 §9).
    p_local: options.sessionScoped !== true,
  });

  if (error) {
    throw new BatchError(`Gagal memulai Batch perubahan: ${error.message}`, {
      cause: error,
    });
  }
  if (!data) {
    throw new BatchError("begin_batch tidak mengembalikan id Batch.");
  }
  return data;
}

/** Low-level: release `app.batch_id` in both transaction and session scope. */
export async function endBatch(client: DbClient): Promise<void> {
  const { error } = await client.rpc("end_batch");
  if (error) {
    throw new BatchError(`Gagal menutup Batch perubahan: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Build a `keterangan` that reads like a sentence in the Log Perubahan.
 *
 *     batchKeterangan("Ganti nama Jabatan", "Site Manager", "Site Ops Manager")
 *     → 'Ganti nama Jabatan: "Site Manager" → "Site Ops Manager"'
 */
export function batchKeterangan(
  aksi: string,
  dari?: string | null,
  ke?: string | null,
): string {
  if (dari && ke) return `${aksi}: "${dari}" → "${ke}"`;
  if (ke) return `${aksi}: "${ke}"`;
  if (dari) return `${aksi}: "${dari}"`;
  return aksi;
}
