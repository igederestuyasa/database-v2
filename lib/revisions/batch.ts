/**
 * `withBatch()` — every write from the UI runs inside one Batch.
 *
 * FROZEN CONTRACT (Wave 1). ARCHITECTURE.md §4A and §6: a Server Action opens
 * a Batch, does its writes, and closes it; the `log_revision` trigger attaches
 * each Revisi to whatever `app.batch_id` is set, so that one action shows up
 * in the Log Perubahan as one line that can be reverted as a unit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE USING IT — what `p_local` means over PostgREST
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
 * Supabase-js speaks HTTP: `begin_batch`, each write and `end_batch` are
 * separate requests and therefore separate transactions. So with the safe
 * default, a write in `fn` does **not** see `app.batch_id`, and the trigger
 * opens an automatic Batch for it (which is why no change can ever escape the
 * log). Practical consequences, which every calling unit must know:
 *
 *   * Grouping is guaranteed **per statement**: everything one UPDATE touches
 *     shares one Batch. A merge that runs three UPDATEs produces three Batch
 *     entries unless it is done in a single statement.
 *   * The Batch this helper opens still carries `jenis` and `keterangan`, and
 *     is what the Log Perubahan shows for the action — but the Revisi may hang
 *     off the trigger's automatic Batch instead. Use `keterangan` generously so
 *     a human can still read the log.
 *   * `sessionScoped: true` (→ `p_local = false`) makes the grouping real
 *     across round trips, and is **only** safe when the caller owns the
 *     connection for the whole batch: `scripts/seed-from-excel.ts` over a
 *     direct connection, never a Server Action on a pooled one.
 *
 * None of this can be fixed from TypeScript — it would take a server-side
 * function that performs the whole batch in one call, and the schema is frozen
 * (ADR-005). Do not "improve" it by flipping the default.
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
   * Only for a caller that owns its connection end to end — a seed or
   * maintenance script. Never from a Server Action: see the header.
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
