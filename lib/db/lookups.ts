/**
 * Read layer for Lookup (`lookups`) — the values behind every dropdown.
 *
 * FROZEN CONTRACT (Wave 1) — reads only. Writes live in
 * `lib/actions/lookups.ts` (another unit) and always go through `withBatch()`.
 *
 * The 11 valid `tipe` values come from `lib/validation/lookupTypes.ts`, which
 * is kept byte-identical to the CHECK constraint in the migration. Anything
 * that reaches this module from a URL or an API query must be narrowed with
 * `isLookupType()` first.
 */
import {
  isLookupType,
  LOOKUP_TYPES,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
  type LookupType,
} from "@/lib/validation/lookupTypes";
import type { Lookup } from "@/lib/types/db";

import {
  containsPattern,
  DbError,
  normalizeSearch,
  resolvePage,
  toPaged,
  unwrapMaybe,
  unwrapRows,
  type DbClient,
  type PageParams,
  type Paged,
  type SortDirection,
  type StatusFilter,
} from "./shared";

export type LookupOrderBy = "urutan" | "label" | "kode" | "created_at" | "updated_at";

export type LookupListParams = PageParams & {
  /** One tipe, several, or all 11 when omitted. */
  tipe?: LookupType | readonly LookupType[];
  /** Default `"aktif"`. */
  status?: StatusFilter;
  /** Partial, case-insensitive match on `label` or `kode`. */
  search?: string | null;
  /**
   * Default `"urutan"` — the order Master Data is curated in. `urutan` is
   * nullable, so a secondary sort on `label` always follows.
   */
  orderBy?: LookupOrderBy;
  /** Default `"asc"`. */
  direction?: SortDirection;
};

const SELECT_ALL =
  "id, tipe, kode, label, urutan, status, merged_into_id, created_at, updated_at";

/** Guard rail for the unpaginated reads that feed pickers. */
export const MAX_PICKER_ROWS = 5000;

/** One page of Lookup rows, for one tab of `/master-data`. */
export async function listLookups(
  client: DbClient,
  params?: LookupListParams,
): Promise<Paged<Lookup>> {
  const { page, perPage, from, to } = resolvePage(params);
  const ascending = (params?.direction ?? "asc") === "asc";

  let query = client
    .from("lookups")
    .select(SELECT_ALL, { count: "exact" })
    .order(params?.orderBy ?? "urutan", { ascending, nullsFirst: false })
    .order("label", { ascending: true })
    .range(from, to);

  const tipe = params?.tipe
    ? Array.isArray(params.tipe)
      ? params.tipe
      : [params.tipe as LookupType]
    : [];
  if (tipe.length > 0) query = query.in("tipe", tipe);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`label.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat Lookup", result);
  return toPaged(rows, result.count, page, perPage);
}

/** Every matching Lookup, unpaginated — for pickers and merge candidates. */
export async function listAllLookups(
  client: DbClient,
  params?: Omit<LookupListParams, "page" | "perPage">,
): Promise<Lookup[]> {
  const ascending = (params?.direction ?? "asc") === "asc";

  let query = client
    .from("lookups")
    .select(SELECT_ALL)
    .order(params?.orderBy ?? "urutan", { ascending, nullsFirst: false })
    .order("label", { ascending: true })
    .limit(MAX_PICKER_ROWS + 1);

  const tipe = params?.tipe
    ? Array.isArray(params.tipe)
      ? params.tipe
      : [params.tipe as LookupType]
    : [];
  if (tipe.length > 0) query = query.in("tipe", tipe);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`label.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const rows = unwrapRows("Gagal memuat Lookup", await query);
  if (rows.length > MAX_PICKER_ROWS) {
    throw new Error(
      `Jumlah Lookup melebihi ${MAX_PICKER_ROWS}; daftar tidak dimuat utuh. Tambahkan pagination sebelum melanjutkan.`,
    );
  }
  return rows;
}

/** Shorthand for "give me the options for this one dropdown". */
export async function listLookupsByType(
  client: DbClient,
  tipe: LookupType,
  params?: Omit<LookupListParams, "page" | "perPage" | "tipe">,
): Promise<Lookup[]> {
  return listAllLookups(client, { ...params, tipe });
}

/**
 * Every Lookup, grouped by `tipe` — one read for a form with 11 dropdowns.
 *
 * Every one of the 11 types is present as a key, even when it has no rows, so
 * a form can render an empty picker instead of crashing on `undefined`.
 */
export async function getLookupsGroupedByType(
  client: DbClient,
  params?: Omit<LookupListParams, "page" | "perPage" | "tipe">,
): Promise<Record<LookupType, Lookup[]>> {
  const rows = await listAllLookups(client, params);

  const grouped = Object.fromEntries(
    LOOKUP_TYPES.map((tipe) => [tipe, [] as Lookup[]]),
  ) as Record<LookupType, Lookup[]>;

  for (const row of rows) {
    const bucket = grouped[row.tipe as LookupType];
    // A tipe outside the 11 cannot exist (CHECK constraint), but a defensive
    // skip keeps a future migration from crashing every form at once.
    if (bucket) bucket.push(row);
  }
  return grouped;
}

export async function getLookupById(
  client: DbClient,
  id: string,
): Promise<Lookup | null> {
  return unwrapMaybe(
    "Gagal memuat Lookup",
    await client.from("lookups").select(SELECT_ALL).eq("id", id).maybeSingle(),
  );
}

/** `(tipe, kode)` is the natural key — see the UNIQUE constraint. */
export async function getLookupByKode(
  client: DbClient,
  tipe: LookupType,
  kode: string,
): Promise<Lookup | null> {
  return unwrapMaybe(
    "Gagal memuat Lookup",
    await client
      .from("lookups")
      .select(SELECT_ALL)
      .eq("tipe", tipe)
      .eq("kode", kode)
      .maybeSingle(),
  );
}

/**
 * How many Karyawan point at this Lookup through the column that belongs to
 * its `tipe` (`job_grade` → `employees.job_grade_id`, and so on).
 *
 * The column name comes from the frozen `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map,
 * never from caller input, so it can never be used to reach another column.
 */
export async function countEmployeesByLookup(
  client: DbClient,
  lookup: Pick<Lookup, "id" | "tipe">,
  options?: { status?: StatusFilter },
): Promise<number> {
  if (!isLookupType(lookup.tipe)) {
    throw new Error(`Tipe Lookup tidak dikenal: ${lookup.tipe}`);
  }
  const column = LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[lookup.tipe];

  let query = client
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq(column, lookup.id);

  const status = options?.status ?? "semua";
  if (status !== "semua") query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw new DbError("Gagal menghitung Karyawan", error);
  return count ?? 0;
}
