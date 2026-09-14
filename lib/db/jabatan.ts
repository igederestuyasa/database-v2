/**
 * Read layer for Jabatan.
 *
 * FROZEN CONTRACT (Wave 1) — reads only. Writes live in
 * `lib/actions/jabatan.ts` (another unit): one statement per Server Action, or
 * `merge_jabatan` when several rows move (ADR-006).
 *
 * Jabatan is a *nama pekerjaan* that many Karyawan can hold at once, not a
 * seat: there is no quota and no unit binding (ADR-002, CONTEXT.md).
 */
import type { Jabatan } from "@/lib/types/db";

import {
  containsPattern,
  DbError,
  normalizeSearch,
  resolvePage,
  toFullRead,
  toPaged,
  unwrapMaybe,
  unwrapRows,
  type DbClient,
  type FullRead,
  type PageParams,
  type Paged,
  type SortDirection,
  type StatusFilter,
} from "./shared";

export type JabatanOrderBy = "nama" | "kode" | "created_at" | "updated_at";

export type JabatanListParams = PageParams & {
  /** Default `"aktif"`. */
  status?: StatusFilter;
  /** Partial, case-insensitive match on `nama` or `kode`. */
  search?: string | null;
  /** Default `"nama"`. */
  orderBy?: JabatanOrderBy;
  /** Default `"asc"`. */
  direction?: SortDirection;
};

const SELECT_ALL = "id, kode, nama, status, merged_into_id, created_at, updated_at";

/**
 * Ceiling this module asks PostgREST for on an unpaginated read.
 *
 * It is a sanity ceiling, **not** a truncation detector: a server-side
 * `db-max-rows` (1000 by default) is applied first and reports success, so the
 * only thing that can prove a read was cut short is the exact count. See
 * `FullRead` in `lib/db/shared.ts`. Same ceiling as the Unit Organisasi tree.
 */
export const MAX_PICKER_ROWS = 5000;

/** One page of Jabatan, for the table on `/jabatan`. */
export async function listJabatan(
  client: DbClient,
  params?: JabatanListParams,
): Promise<Paged<Jabatan>> {
  const { page, perPage, from, to } = resolvePage(params);

  let query = client
    .from("jabatan")
    .select(SELECT_ALL, { count: "exact" })
    .order(params?.orderBy ?? "nama", {
      ascending: (params?.direction ?? "asc") === "asc",
    })
    .range(from, to);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`nama.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat Jabatan", result);
  return toPaged(rows, result.count, page, perPage);
}

/**
 * Every matching Jabatan, unpaginated — for pickers and merge candidates.
 *
 * Returns a `FullRead`, not a bare array: a response capped by PostgREST's
 * `db-max-rows` is a successful HTTP 200 with a short array, so the caller
 * needs `truncated` to know that the picker it is about to render — and the
 * Merge target list inside it — is missing rows. Show the rows and say so, or
 * call `requireComplete()` if a partial answer would be a wrong one.
 */
export async function listAllJabatan(
  client: DbClient,
  params?: Omit<JabatanListParams, "page" | "perPage">,
): Promise<FullRead<Jabatan>> {
  let query = client
    .from("jabatan")
    .select(SELECT_ALL, { count: "exact" })
    .order(params?.orderBy ?? "nama", {
      ascending: (params?.direction ?? "asc") === "asc",
    })
    .limit(MAX_PICKER_ROWS);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`nama.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat Jabatan", result);
  return toFullRead(rows, result.count);
}

export async function getJabatanById(
  client: DbClient,
  id: string,
): Promise<Jabatan | null> {
  return unwrapMaybe(
    "Gagal memuat Jabatan",
    await client.from("jabatan").select(SELECT_ALL).eq("id", id).maybeSingle(),
  );
}

export async function getJabatanByKode(
  client: DbClient,
  kode: string,
): Promise<Jabatan | null> {
  return unwrapMaybe(
    "Gagal memuat Jabatan",
    await client.from("jabatan").select(SELECT_ALL).eq("kode", kode).maybeSingle(),
  );
}

/**
 * How many Karyawan hold this Jabatan.
 *
 * Feeds "… Karyawan memegang Jabatan ini" in the merge and deactivate dialogs.
 */
export async function countEmployeesByJabatan(
  client: DbClient,
  jabatanId: string,
  options?: { status?: StatusFilter },
): Promise<number> {
  let query = client
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("jabatan_id", jabatanId);

  const status = options?.status ?? "semua";
  if (status !== "semua") query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw new DbError("Gagal menghitung Karyawan", error);
  return count ?? 0;
}
