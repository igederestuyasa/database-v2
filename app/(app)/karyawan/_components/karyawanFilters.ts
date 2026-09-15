/**
 * The `/karyawan?…` contract: what the URL may say, and how it is written.
 *
 * WHY THE FILTERS LIVE IN THE URL and not in component state: a filtered list
 * of Karyawan is something HC staff send to each other ("ini yang di Divisi
 * QHSSE"), bookmark, and come back to after the browser reloads. `useState`
 * gives none of that, and it would also force the whole page to be a Client
 * Component reading 1.500 rows it cannot page.
 *
 * WHY THIS MODULE CARRIES NO `"use client"`: both halves of the page import it
 * — `page.tsx` (a Server Component) to read the URL, and the filter bar / table
 * (Client Components) to write the next one. An export of a `"use client"`
 * module that a server module imports becomes a client *reference*: calling it
 * throws in a production build only, which is exactly how `toOrgUnitOptions()`
 * took down `/bereskan` (see `lib/entityOptions.ts`). So the
 * parser and the href builder stay here, directive-free.
 *
 * Everything that reaches the database is validated here rather than trusted:
 * an id has to look like a uuid, a tipe has to be one of the eleven, a status
 * has to be one of three. Anything else is dropped — a malformed `?unit=`
 * shows the unfiltered list, it never reaches PostgREST as a broken query.
 */
import type { EmployeeOrderBy } from "@/lib/db/employees";
import type { SortDirection, StatusFilter } from "@/lib/db/shared";
import { LOOKUP_TYPES, type LookupType } from "@/lib/validation/lookupTypes";
import { isUuid } from "@/lib/validation/uuid";

/** One page of the Karyawan table. `lib/db/shared.ts` defaults to the same. */
export const KARYAWAN_PER_PAGE = 50;

/**
 * The value that means "belum diisi" in the URL: `?unit=tanpa` lists Karyawan
 * **without** a Unit Organisasi — a Temuan on "Perlu Dibereskan", and the one
 * thing a plain id filter cannot express.
 */
export const TANPA = "tanpa";

/**
 * `undefined` — no filter at all.
 * `null` — only rows where the column is NULL (`?…=tanpa`).
 * `string` — that id.
 *
 * Same three-way shape `listEmployees()` already takes, so the page hands its
 * filters straight through without translating them.
 */
export type IdFilter = string | null | undefined;

export type KaryawanFilters = {
  /** Free text over nama, NIP and Personnel Number (PRD #2). */
  q: string | null;
  status: StatusFilter;
  unitId: IdFilter;
  /** A Divisi filter includes its Bagian and Sub Bagian unless turned off. */
  includeChildren: boolean;
  jabatanId: IdFilter;
  /** One entry per Lookup tipe the user filtered by. */
  lookups: Partial<Record<LookupType, string | null>>;
  /** Key into `SORT_OPTIONS`; the sort itself happens in the query. */
  sort: SortValue;
  /** 1-based. */
  page: number;
};

/* ── status ──────────────────────────────────────────────────────────────── */

export const STATUS_FILTERS = ["aktif", "nonaktif", "semua"] as const;

/**
 * `STATUS_LABELS` in `lib/i18n/terms.ts` names the two states a Karyawan can
 * be in; these name the three things the *filter* can do, which is a different
 * list ("Semua status" is not a Status Karyawan).
 */
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  aktif: "Hanya aktif",
  nonaktif: "Hanya nonaktif",
  semua: "Semua status",
};

/* ── sort ────────────────────────────────────────────────────────────────── */

/**
 * The sort options, as URL values.
 *
 * SORTING IS DONE BY THE QUERY, NOT BY THE TABLE. `DataTable` in server mode
 * still sorts client-side if its columns allow it — which would reorder the 50
 * rows on screen while looking like it ordered all 1.500 Karyawan, the same
 * trap its own search box is disabled to avoid. So every column is declared
 * unsortable and the order is chosen here, travels in the URL, and is applied
 * by `listEmployees()` across the whole filtered set.
 */
export type SortOption = {
  value: string;
  label: string;
  orderBy: EmployeeOrderBy;
  direction: SortDirection;
};

export const SORT_OPTIONS = [
  { value: "nama", label: "Nama A → Z", orderBy: "full_name", direction: "asc" },
  { value: "nama-z", label: "Nama Z → A", orderBy: "full_name", direction: "desc" },
  {
    value: "pn",
    label: "Personnel Number",
    orderBy: "personnel_number",
    direction: "asc",
  },
  { value: "nip", label: "NIP", orderBy: "nip", direction: "asc" },
  {
    value: "unit",
    label: "Unit Organisasi",
    orderBy: "org_unit_nama",
    direction: "asc",
  },
  { value: "jabatan", label: "Jabatan", orderBy: "jabatan_nama", direction: "asc" },
  {
    value: "job-grade",
    label: "Job Grade",
    orderBy: "job_grade_kode",
    direction: "asc",
  },
  {
    value: "masuk",
    label: "Terlama bergabung",
    orderBy: "original_start_date",
    direction: "asc",
  },
  {
    value: "diubah",
    label: "Terakhir diubah",
    orderBy: "updated_at",
    direction: "desc",
  },
] as const satisfies readonly SortOption[];

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_SORT: SortValue = "nama";

export function sortOption(value: SortValue): SortOption {
  return SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0];
}

/* ── parsing ─────────────────────────────────────────────────────────────── */

/** `?unit=a&unit=b` is a mistake, not a feature: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `tanpa` → `null`, a uuid → itself, anything else → no filter. */
function parseIdFilter(value: string | string[] | undefined): IdFilter {
  const first = one(value);
  if (first === TANPA) return null;
  return isUuid(first) ? first : undefined;
}

function parseStatus(value: string | string[] | undefined): StatusFilter {
  const first = one(value);
  return (STATUS_FILTERS as readonly string[]).includes(first ?? "")
    ? (first as StatusFilter)
    : "aktif";
}

function parseSort(value: string | string[] | undefined): SortValue {
  const first = one(value);
  return SORT_OPTIONS.some((option) => option.value === first)
    ? (first as SortValue)
    : DEFAULT_SORT;
}

function parsePage(value: string | string[] | undefined): number {
  const page = Number.parseInt(one(value) ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/** Read `searchParams` into the shape `listEmployees()` takes. */
export function parseKaryawanFilters(
  params: Record<string, string | string[] | undefined>,
): KaryawanFilters {
  const lookups: Partial<Record<LookupType, string | null>> = {};
  for (const tipe of LOOKUP_TYPES) {
    // Each Lookup tipe is its own query parameter (`?job_grade=…`), so a link
    // says what it filters by without a decoder ring. The keys come from the
    // frozen list, never from the URL, so an unknown one cannot get through.
    const value = parseIdFilter(params[tipe]);
    if (value !== undefined) lookups[tipe] = value;
  }

  return {
    q: (one(params.q) ?? "").trim() || null,
    status: parseStatus(params.status),
    unitId: parseIdFilter(params.unit),
    // Opt OUT, not in: someone filtering by a Direktorat means the people in
    // it, and every Divisi and Bagian under it. `sub=0` narrows to the one unit.
    includeChildren: one(params.sub) !== "0",
    jabatanId: parseIdFilter(params.jabatan),
    lookups,
    sort: parseSort(params.urut),
    page: parsePage(params.page),
  };
}

/* ── writing the URL back ────────────────────────────────────────────────── */

/** The href for a set of filters. Defaults are left out, so `/karyawan` is clean. */
export function karyawanHref(filters: KaryawanFilters): string {
  const query = new URLSearchParams();

  if (filters.q) query.set("q", filters.q);
  if (filters.status !== "aktif") query.set("status", filters.status);

  if (filters.unitId === null) query.set("unit", TANPA);
  else if (filters.unitId) {
    query.set("unit", filters.unitId);
    // Only meaningful with a unit selected; "tanpa unit" has no children.
    if (!filters.includeChildren) query.set("sub", "0");
  }

  if (filters.jabatanId === null) query.set("jabatan", TANPA);
  else if (filters.jabatanId) query.set("jabatan", filters.jabatanId);

  for (const tipe of LOOKUP_TYPES) {
    const value = filters.lookups[tipe];
    if (value === undefined) continue;
    query.set(tipe, value === null ? TANPA : value);
  }

  if (filters.sort !== DEFAULT_SORT) query.set("urut", filters.sort);
  if (filters.page > 1) query.set("page", String(filters.page));

  const suffix = query.toString();
  return suffix ? `/karyawan?${suffix}` : "/karyawan";
}

/**
 * Change something and go back to page 1.
 *
 * Staying on page 8 while narrowing 1.500 Karyawan down to 12 shows an empty
 * table and looks like "tidak ada yang cocok". Paging is the one change that
 * keeps its page, so it passes `page` explicitly.
 */
export function ubahFilter(
  filters: KaryawanFilters,
  perubahan: Partial<KaryawanFilters>,
): KaryawanFilters {
  return { ...filters, page: 1, ...perubahan };
}

/** Nothing selected: the plain list, aktif, default order. */
export const FILTER_KOSONG: KaryawanFilters = {
  q: null,
  status: "aktif",
  unitId: undefined,
  includeChildren: true,
  jabatanId: undefined,
  lookups: {},
  sort: DEFAULT_SORT,
  page: 1,
};

/**
 * What "Bersihkan N filter" produces.
 *
 * Everything the user narrowed the list with goes, and the order they chose
 * stays. That is not a detail: `hitungFilterAktif()` deliberately does not
 * count `sort`, so a button that promises to clear N filters must not quietly
 * put the ordering back to A → Z as a side effect.
 */
export function bersihkanFilter(filters: KaryawanFilters): KaryawanFilters {
  return { ...FILTER_KOSONG, sort: filters.sort };
}

/**
 * How many filters are narrowing the list right now — for "Bersihkan (3)".
 *
 * `status: "aktif"` is not counted: it is the default view, not something the
 * user chose. Sort and page are not filters.
 */
export function hitungFilterAktif(filters: KaryawanFilters): number {
  let jumlah = 0;
  if (filters.q) jumlah += 1;
  if (filters.status !== "aktif") jumlah += 1;
  if (filters.unitId !== undefined) jumlah += 1;
  if (filters.jabatanId !== undefined) jumlah += 1;
  jumlah += hitungFilterLookup(filters);
  return jumlah;
}

/** Only the Lookup half, for the "Filter Lookup" disclosure. */
export function hitungFilterLookup(filters: KaryawanFilters): number {
  return LOOKUP_TYPES.filter((tipe) => filters.lookups[tipe] !== undefined).length;
}
