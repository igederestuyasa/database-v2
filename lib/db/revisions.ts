/**
 * Read layer for Revisi and Batch (`revisions`, `batches`).
 *
 * FROZEN CONTRACT (Wave 1) — reads only. `revisions` is append-only and is
 * written exclusively by the `log_revision` trigger; `batches` is written by
 * `begin_batch()` and may only ever have `reverted_by_batch_id` filled in
 * (ADR-003).
 *
 * **RLS shapes what comes back.** A Revisi is readable by exactly the people
 * who may read the row it describes (ADR-005 §9): `employee_private` and
 * `api_keys` revisions are admin-only, `profiles` revisions are admin-or-own,
 * the rest are readable by anyone logged in. A viewer therefore sees a
 * *shorter* list here, not an error — that is the intended behaviour, and the
 * UI must not present a missing Revisi as data loss.
 */
import type { Batch, Revision } from "@/lib/types/db";
import type { BatchJenis, LoggedTable } from "@/lib/revisions/tables";

import {
  DbError,
  likePattern,
  normalizeSearch,
  resolvePage,
  toPaged,
  unwrapMaybe,
  unwrapRows,
  type DbClient,
  type PageParams,
  type Paged,
} from "./shared";

const SELECT_REVISION =
  "id, batch_id, table_name, row_id, action, before, after, actor_id, created_at";

const SELECT_BATCH =
  "id, jenis, keterangan, actor_id, reverted_by_batch_id, created_at";

/** Hard cap on one unpaginated revision read (a `seed` Batch has ~1.500). */
export const MAX_REVISIONS_PER_READ = 5000;

export type RevisionsByRowParams = {
  table: LoggedTable;
  rowId: string;
  /** Default 50. */
  limit?: number;
};

/**
 * Riwayat Revisi for one row, newest first (PRD #14).
 *
 * Ordered by `id` descending rather than `created_at`: several Revisi inside
 * one Batch share a timestamp, and `id` is the order they actually happened —
 * the same order `planRevert()` undoes them in.
 */
export async function listRevisionsByRow(
  client: DbClient,
  params: RevisionsByRowParams,
): Promise<Revision[]> {
  return unwrapRows(
    "Gagal memuat Riwayat Revisi",
    await client
      .from("revisions")
      .select(SELECT_REVISION)
      .eq("table_name", params.table)
      .eq("row_id", params.rowId)
      .order("id", { ascending: false })
      .limit(Math.min(params.limit ?? 50, MAX_REVISIONS_PER_READ)),
  );
}

export async function getRevisionById(
  client: DbClient,
  id: number,
): Promise<Revision | null> {
  return unwrapMaybe(
    "Gagal memuat Revisi",
    await client.from("revisions").select(SELECT_REVISION).eq("id", id).maybeSingle(),
  );
}

/**
 * Every Revisi in one Batch, oldest first (the order they were written).
 *
 * `planRevert()` re-sorts to descending on its own, so callers may hand this
 * straight to it without thinking about order.
 */
export async function listRevisionsByBatch(
  client: DbClient,
  batchId: string,
  options?: { limit?: number },
): Promise<Revision[]> {
  const limit = Math.min(options?.limit ?? MAX_REVISIONS_PER_READ, MAX_REVISIONS_PER_READ);
  return unwrapRows(
    "Gagal memuat Revisi dalam Batch",
    await client
      .from("revisions")
      .select(SELECT_REVISION)
      .eq("batch_id", batchId)
      .order("id", { ascending: true })
      .limit(limit),
  );
}

export async function countRevisionsInBatch(
  client: DbClient,
  batchId: string,
): Promise<number> {
  const { count, error } = await client
    .from("revisions")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);
  if (error) throw new DbError("Gagal menghitung Revisi", error);
  return count ?? 0;
}

export type BatchListParams = PageParams & {
  /** One jenis or several; all when omitted. */
  jenis?: BatchJenis | readonly BatchJenis[];
  /** Only Batch created by this user. */
  actorId?: string;
  /** Partial, case-insensitive match on `keterangan`. */
  search?: string | null;
  /** ISO 8601 bounds on `created_at`. */
  since?: string | null;
  until?: string | null;
  /**
   * `undefined` — all Batch.
   * `true` — only Batch that have already been reverted.
   * `false` — only Batch that have not.
   */
  reverted?: boolean;
};

/** The global Log Perubahan, newest first (PRD #16). */
export async function listBatches(
  client: DbClient,
  params?: BatchListParams,
): Promise<Paged<Batch>> {
  const { page, perPage, from, to } = resolvePage(params);

  let query = client
    .from("batches")
    .select(SELECT_BATCH, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const jenis = params?.jenis
    ? Array.isArray(params.jenis)
      ? params.jenis
      : [params.jenis as BatchJenis]
    : [];
  if (jenis.length > 0) query = query.in("jenis", jenis);

  if (params?.actorId) query = query.eq("actor_id", params.actorId);
  if (params?.since) query = query.gte("created_at", params.since);
  if (params?.until) query = query.lte("created_at", params.until);

  if (params?.reverted === true) query = query.not("reverted_by_batch_id", "is", null);
  else if (params?.reverted === false) query = query.is("reverted_by_batch_id", null);

  const search = normalizeSearch(params?.search);
  if (search) query = query.ilike("keterangan", likePattern(search));

  const result = await query;
  const rows = unwrapRows("Gagal memuat Log Perubahan", result);
  return toPaged(rows, result.count, page, perPage);
}

export async function getBatchById(
  client: DbClient,
  id: string,
): Promise<Batch | null> {
  return unwrapMaybe(
    "Gagal memuat Batch",
    await client.from("batches").select(SELECT_BATCH).eq("id", id).maybeSingle(),
  );
}

/** One Batch with its Revisi — what the expanded row on `/log` shows. */
export async function getBatchWithRevisions(
  client: DbClient,
  id: string,
  options?: { limit?: number },
): Promise<{ batch: Batch; revisions: Revision[] } | null> {
  const batch = await getBatchById(client, id);
  if (!batch) return null;
  return { batch, revisions: await listRevisionsByBatch(client, id, options) };
}

/**
 * Batch that this Batch reverted, if any.
 *
 * `batches.reverted_by_batch_id` points forward (original → the revert), so
 * finding what a `revert` Batch undid means looking the other way.
 */
export async function getRevertedBatch(
  client: DbClient,
  revertBatchId: string,
): Promise<Batch | null> {
  return unwrapMaybe(
    "Gagal memuat Batch",
    await client
      .from("batches")
      .select(SELECT_BATCH)
      .eq("reverted_by_batch_id", revertBatchId)
      .maybeSingle(),
  );
}
