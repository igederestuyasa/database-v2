/**
 * Batch labels — and why a Server Action no longer opens a Batch itself.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THERE IS NO `withBatch()` ANY MORE. THAT IS DELIBERATE. (ADR-006)
 * ────────────────────────────────────────────────────────────────────────────
 * `begin_batch()` points `app.batch_id` at a new Batch with
 * `set_config(..., p_local => true)`, which is scoped to the current
 * **transaction**. supabase-js speaks HTTP, so the `begin_batch` RPC and the
 * `UPDATE` that follows it are two requests and therefore two transactions:
 * by the time the write arrives, `app.batch_id` is gone, and the
 * `log_revision` trigger opens its own automatic Batch for the Revisi.
 *
 * `p_local => false` is not the way out. A session-scoped setting rides a
 * pooled connection into the next request and folds another admin's writes
 * into this Batch — ADR-005 §9 closed that hole on purpose and it stays
 * closed.
 *
 * So a Server Action that called `begin_batch` produced **two** rows in the
 * Log Perubahan: a nicely-named Batch containing nothing, and an automatic
 * `edit` Batch holding the actual Revisi. Two rows, one of them a lie, and
 * "kembalikan Batch ini" on the readable one would have found it empty.
 *
 * The fix is to stop opening the empty one:
 *
 *   * **One statement per action → write it directly.** No Batch call at all.
 *     The trigger's automatic Batch *is* the record of the action, it holds
 *     the Revisi, and `/log` shows exactly one row that actually contains the
 *     change. `lib/actions/_reference.ts` is the worked example.
 *   * **More than one statement → a Postgres function.** A Merge is three
 *     UPDATEs across two tables; a Batch revert is one UPDATE per Revisi.
 *     Those live in `supabase/migrations/0002_batch_operations.sql` —
 *     `merge_org_unit`, `merge_jabatan`, `merge_lookup`, `apply_revert`,
 *     `revert_batch` — where one RPC call is one transaction and one real
 *     Batch. **They open their own Batch; never wrap an RPC call in one.**
 *   * **A script that owns its connection → a real transaction.**
 *     `lib/revisions/seedBatch.ts` connects with `pg`, opens `BEGIN`, calls
 *     `begin_batch('seed', …, p_local => true)` and commits, so ~1.475
 *     Karyawan land in one `seed` Batch.
 *
 * WHAT THIS COSTS, so nobody "restores" it later
 * ────────────────────────────────────────────────────────────────────────────
 * An ordinary edit no longer carries a per-action `keterangan`, and its Batch
 * `jenis` is always `edit` — `create`, `deactivate` and `rename` are now
 * written only by the RPC functions above. Nothing about the change itself is
 * lost: `revisions.action` still separates insert from update, `before`/`after`
 * still show exactly which columns moved (a `status` change included), and
 * every Revisi is still revertable one at a time (PRD #15). Only the
 * Batch-level label goes, and PRD never asked for one — it asked for who,
 * when, what changed, and revertability.
 *
 * The one Batch label a human still writes is the `keterangan` handed to a
 * merge or revert RPC, which is what `batchKeterangan()` below is for.
 */

/**
 * Build a `keterangan` that reads like a sentence in the Log Perubahan.
 *
 *     batchKeterangan("Merge Jabatan", "Site Manager", "Site Ops Manager")
 *     → 'Merge Jabatan: "Site Manager" → "Site Ops Manager"'
 *
 * Pass the result as `MergeInput.keterangan` (`lib/actions/merge.ts`) or as
 * `revertBatch()`'s `keterangan` (`lib/revisions/revert.ts`). Leave it out and
 * the SQL function generates the same shape from the rows it just read.
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
