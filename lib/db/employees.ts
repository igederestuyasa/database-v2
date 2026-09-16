/**
 * Read layer for Karyawan.
 *
 * FROZEN CONTRACT (Wave 1) — reads only. Writes live in
 * `lib/actions/employees.ts` (another unit): one statement per Server Action,
 * or an RPC when several rows move (ADR-006).
 *
 * **Which relation to read.** Everything here reads `v_employees`: the Karyawan
 * row with its Unit Organisasi chain, every Lookup label, the Jabatan name and
 * the derived columns already resolved. `v_employees_private` is deliberately
 * never queried from this module — it INNER JOINs `employee_private`, so for a
 * viewer RLS makes it return **zero rows**, not rows with NULL sensitive
 * columns (ADR-005 §10). An admin page that needs Data Pribadi Sensitif calls
 * `getEmployeeById()` for the visible half and `getEmployeePrivate()` for the
 * sensitive half, and renders whatever it gets.
 */
import {
  isLookupType,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
  type LookupType,
} from "@/lib/validation/lookupTypes";
import type { Employee, EmployeePrivate, VEmployee } from "@/lib/types/db";

import { getOrgUnitDescendantIds } from "./orgUnits";
import {
  containsPattern,
  DbError,
  IncompleteReadError,
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

/** Columns of `v_employees` the Karyawan table may be sorted by. */
export type EmployeeOrderBy =
  | "full_name"
  | "personnel_number"
  | "nip"
  | "status"
  | "org_unit_nama"
  | "jabatan_nama"
  | "direktorat_nama"
  | "divisi_nama"
  | "person_grade_kode"
  | "job_grade_kode"
  | "original_start_date"
  | "tanggal_diangkat"
  | "created_at"
  | "updated_at";

export type EmployeeListParams = PageParams & {
  /** Partial match on `full_name`, `nip` or `personnel_number` (PRD #2). */
  search?: string | null;
  /** Default `"aktif"`. */
  status?: StatusFilter;
  /**
   * `undefined` — no filter.
   * `null` — only Karyawan **without** a Unit Organisasi (a Temuan on "Perlu
   *   Dibereskan").
   * `string` — that unit, plus everything below it unless
   *   `includeChildren: false`.
   */
  orgUnitId?: string | null;
  /** Default `true` — a Divisi filter includes its Bagian and Sub Bagian. */
  includeChildren?: boolean;
  /** `null` selects Karyawan without a Jabatan. */
  jabatanId?: string | null;
  /**
   * Filter by any Lookup, keyed by tipe:
   * `{ job_grade: "…uuid…", work_contract: "…uuid…" }`.
   * The `employees` column for each tipe comes from the frozen
   * `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map, never from caller input.
   */
  lookups?: Partial<Record<LookupType, string | null>>;
  /** ISO 8601 — only rows changed at or after this moment. */
  updatedSince?: string | null;
  /** Default `"full_name"`. */
  orderBy?: EmployeeOrderBy;
  /** Default `"asc"`. */
  direction?: SortDirection;
};

/**
 * `select("*")` on a view is checked by TypeScript against the generated
 * `Database["public"]["Views"]`, so the column list cannot drift; the 70-odd
 * names are not repeated here where every one would be a chance to typo.
 */
const SELECT_VIEW = "*";

const SELECT_EMPLOYEE_ROW =
  "id, personnel_number, nip, full_name, email_kantor, org_unit_id, jabatan_id, " +
  "gender_id, work_contract_id, person_grade_id, job_grade_id, legal_entity_id, " +
  "klasifikasi_rekrutmen_id, teknik_non_teknik_id, bod_range_id, band_jabatan_id, " +
  "kategori_penempatan_id, kategori_fungsi_id, keterangan_pj_plt, " +
  "keterangan_rangkap_1, keterangan_rangkap_2, keterangan, jurusan, " +
  "original_start_date, tanggal_diangkat, tanggal_promosi_pg, tanggal_promosi_jg, " +
  "tanggal_keluar, nomor_surat_pg, nomor_surat_jg, status, created_at, updated_at";

/**
 * One page of Karyawan for the table on `/karyawan` (PRD #2).
 *
 * NOTE (Wave 1): written against the frozen schema and checked by
 * `npm run check:columns`, but never executed against a live Supabase — this
 * environment cannot reach one. The first unit to run it against real data
 * owns confirming the filter semantics.
 */
export async function listEmployees(
  client: DbClient,
  params?: EmployeeListParams,
): Promise<Paged<VEmployee>> {
  const { page, perPage, from, to } = resolvePage(params);

  let query = client
    .from("v_employees")
    .select(SELECT_VIEW, { count: "exact" })
    .order(params?.orderBy ?? "full_name", {
      ascending: (params?.direction ?? "asc") === "asc",
      nullsFirst: false,
    })
    // Stable tie-break: two Karyawan may share a name, and without this a row
    // can appear on two pages (or on none) as Postgres re-orders equal keys.
    .order("personnel_number", { ascending: true })
    .range(from, to);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(
      `full_name.ilike.${pattern},nip.ilike.${pattern},personnel_number.ilike.${pattern}`,
    );
  }

  if (params?.orgUnitId === null) {
    query = query.is("org_unit_id", null);
  } else if (typeof params?.orgUnitId === "string") {
    if (params.includeChildren === false) {
      query = query.eq("org_unit_id", params.orgUnitId);
    } else {
      const ids = await getOrgUnitDescendantIds(client, params.orgUnitId);
      query = query.in("org_unit_id", ids);
    }
  }

  if (params?.jabatanId === null) query = query.is("jabatan_id", null);
  else if (typeof params?.jabatanId === "string") {
    query = query.eq("jabatan_id", params.jabatanId);
  }

  for (const [tipe, value] of Object.entries(params?.lookups ?? {})) {
    if (value === undefined) continue;
    if (!isLookupType(tipe)) throw new Error(`Tipe Lookup tidak dikenal: ${tipe}`);
    const column = LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[tipe];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }

  if (params?.updatedSince) query = query.gte("updated_at", params.updatedSince);

  const result = await query;
  const rows = unwrapRows("Gagal memuat Karyawan", result);
  return toPaged(rows, result.count, page, perPage);
}

/** One Karyawan, ready to display (labels and derived columns resolved). */
export async function getEmployeeById(
  client: DbClient,
  id: string,
): Promise<VEmployee | null> {
  return unwrapMaybe(
    "Gagal memuat Karyawan",
    await client.from("v_employees").select(SELECT_VIEW).eq("id", id).maybeSingle(),
  );
}

/**
 * One Karyawan by business key (CONTEXT.md: Personnel Number).
 *
 * This is the key Konsumen use; `nip` is a different, second code.
 */
export async function getEmployeeByPersonnelNumber(
  client: DbClient,
  personnelNumber: string,
): Promise<VEmployee | null> {
  return unwrapMaybe(
    "Gagal memuat Karyawan",
    await client
      .from("v_employees")
      .select(SELECT_VIEW)
      .eq("personnel_number", personnelNumber)
      .maybeSingle(),
  );
}

/**
 * The raw `employees` row — FK ids only, no labels.
 *
 * For the edit form and for Server Actions that need the current values to
 * diff against. Rendering should use `getEmployeeById()` instead.
 */
export async function getEmployeeRowById(
  client: DbClient,
  id: string,
): Promise<Employee | null> {
  return unwrapMaybe(
    "Gagal memuat Karyawan",
    await client
      .from("employees")
      .select(SELECT_EMPLOYEE_ROW)
      .eq("id", id)
      .maybeSingle(),
  );
}

/**
 * Data Pribadi Sensitif for one Karyawan (PRD #22).
 *
 * Admin only. For a viewer, RLS filters the row out and this returns `null` —
 * the same as "belum diisi", which is what the UI should render either way.
 * Never reachable through `/api/v1` (ARCHITECTURE.md §6).
 */
export async function getEmployeePrivate(
  client: DbClient,
  employeeId: string,
): Promise<EmployeePrivate | null> {
  return unwrapMaybe(
    "Gagal memuat Data Pribadi Sensitif",
    await client
      .from("employee_private")
      .select(
        "employee_id, date_of_birth, place_of_birth, religion, marital_status, created_at, updated_at",
      )
      .eq("employee_id", employeeId)
      .maybeSingle(),
  );
}

/**
 * Does another Karyawan already use this `personnel_number`?
 *
 * `personnel_number` and `nip` are UNIQUE, so the database is the real
 * guarantee; this is the friendly check a form runs before submitting.
 * Pass `exceptId` when editing so the row does not collide with itself.
 */
export async function isPersonnelNumberTaken(
  client: DbClient,
  personnelNumber: string,
  exceptId?: string,
): Promise<boolean> {
  let query = client
    .from("employees")
    .select("id")
    .eq("personnel_number", personnelNumber)
    .limit(1);
  if (exceptId) query = query.neq("id", exceptId);
  return unwrapRows("Gagal memeriksa Personnel Number", await query).length > 0;
}

/** Same check for `nip`, which is UNIQUE but nullable. */
export async function isNipTaken(
  client: DbClient,
  nip: string,
  exceptId?: string,
): Promise<boolean> {
  let query = client.from("employees").select("id").eq("nip", nip).limit(1);
  if (exceptId) query = query.neq("id", exceptId);
  return unwrapRows("Gagal memeriksa NIP", await query).length > 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tallies — how many Karyawan point at each Data Referensi row
 *
 * These read the whole table in pages and count in memory. The obvious
 * alternative, one `count` query per row, is one round trip per Unit
 * Organisasi (a few hundred) to draw one page. Both readers below keep the
 * page BELOW PostgREST's `db-max-rows` (1000 by default): that cap is applied
 * server-side before any range we ask for and comes back as a short array
 * with no error, so a single 1.500-row read would look complete while quietly
 * hiding 500 Karyawan. A tally that stops short of the exact `count` throws
 * `IncompleteReadError` rather than reporting a number it knows is low — the
 * number is read right before someone presses Merge.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The FK columns of `employees` a tally may group by: two Data Referensi, eleven Lookup. */
export type EmployeeReferenceColumn =
  | "org_unit_id"
  | "jabatan_id"
  | (typeof LOOKUP_TYPE_TO_EMPLOYEE_COLUMN)[LookupType];

/** Rows per request, kept below `db-max-rows`. */
const TALLY_PAGE = 500;

/** `in(...)` chunk size — keeps the PostgREST query string well under any URL cap. */
const TALLY_CHUNK = 100;

/**
 * Ceiling on one tally. There are ~1.500 Karyawan in total, so a chunk can
 * never legitimately come close; it exists so a runaway read stops.
 */
const MAX_TALLY_ROWS = 5000;

function chunked<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Count Karyawan per value of one FK column, for the ids given — paged, and
 * verified against the exact count.
 *
 * Every status counts: `merge_org_unit` / `merge_jabatan` / `merge_lookup`
 * move rows with `where <kolom> = p_source` and no status predicate
 * (`0002_batch_operations.sql`), so a tally that skipped nonaktif Karyawan
 * would promise to move fewer people than the Merge actually moves.
 *
 * Ids with no Karyawan are seeded to `0`, so "0 Karyawan" — the safest merge
 * there is — reads differently from "belum dihitung".
 *
 * `column` is never caller text: the type admits only `org_unit_id`,
 * `jabatan_id`, or a column the frozen `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map
 * assigns to a tipe.
 */
export async function countEmployeesByColumn(
  client: DbClient,
  column: EmployeeReferenceColumn,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const chunk of chunked(ids, TALLY_CHUNK)) {
    let dibaca = 0;
    let total = 0;

    for (;;) {
      // hc-check-columns-ignore — `column` is typed to the employees FK columns;
      // nothing here comes from user input.
      const { data, count, error } = await client
        .from("employees")
        .select(column, { count: "exact" })
        .in(column, chunk)
        // Stable order, or a range-paged read can show one row twice and miss
        // another as Postgres re-orders equal keys.
        .order("id", { ascending: true })
        .range(dibaca, dibaca + TALLY_PAGE - 1);
      if (error) throw new DbError("Gagal menghitung Karyawan", error);

      const rows = (data ?? []) as unknown as Record<string, string | null>[];
      total = count ?? rows.length;
      for (const row of rows) {
        const id = row[column];
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      dibaca += rows.length;

      if (rows.length === 0) break;
      if (dibaca >= total) break;
      if (dibaca >= MAX_TALLY_ROWS) break;
    }

    if (dibaca < total) throw new IncompleteReadError("Karyawan", dibaca, total);
  }

  return counts;
}

/** Karyawan per Unit Organisasi, by status — what the tree on `/struktur` prints. */
export type PlacementCounts = {
  /** Karyawan aktif per unit — what the tree shows. */
  aktif: Map<string, number>;
  /** Karyawan of any status per unit — what a Merge would move. */
  semua: Map<string, number>;
};

/**
 * Every Karyawan's placement in one paged read of two columns.
 *
 * Throws `IncompleteReadError` when the pages stop short of the exact count:
 * a per-unit number that is quietly low is worse than no number, and the
 * caller (`/struktur`) shows "—" instead.
 */
export async function countEmployeesPerOrgUnit(client: DbClient): Promise<PlacementCounts> {
  const aktif = new Map<string, number>();
  const semua = new Map<string, number>();

  let dibaca = 0;
  let seharusnya: number | null = null;

  for (let offset = 0; offset <= MAX_TALLY_ROWS * 4; offset += TALLY_PAGE) {
    // `.order("id")` matters: without a stable sort, paging over PostgREST can
    // repeat or skip rows between requests, and every count would be off.
    const { data, error, count } = await client
      .from("employees")
      .select("org_unit_id, status", offset === 0 ? { count: "exact" } : undefined)
      .order("id")
      .range(offset, offset + TALLY_PAGE - 1);
    if (error) throw new DbError("Gagal menghitung Karyawan per Unit Organisasi", error);
    if (offset === 0) seharusnya = count;

    for (const row of data ?? []) {
      const unitId = row.org_unit_id;
      if (!unitId) continue;
      semua.set(unitId, (semua.get(unitId) ?? 0) + 1);
      if (row.status === "aktif") aktif.set(unitId, (aktif.get(unitId) ?? 0) + 1);
    }

    dibaca += data?.length ?? 0;
    if ((data?.length ?? 0) < TALLY_PAGE) break;
  }

  if (seharusnya !== null && dibaca < seharusnya) {
    throw new IncompleteReadError("Karyawan", dibaca, seharusnya);
  }

  return { aktif, semua };
}

/**
 * How many Karyawan exist at all, aktif or not.
 */
export async function countEmployees(client: DbClient): Promise<number> {
  const { count, error } = await client
    .from("employees")
    .select("id", { count: "exact", head: true });
  if (error) throw new DbError("Gagal menghitung Karyawan", error);
  return count ?? 0;
}

/**
 * Setiap `personnel_number` yang sudah ada, untuk pratinjau halaman Impor
 * (PRD #24).
 *
 * Impor memakai Personnel Number sebagai kunci, jadi pratinjaunya hanya bisa
 * mengatakan "N baru, M diperbarui" kalau ia tahu nomor mana yang sudah
 * terdaftar. Perbandingannya terjadi di peramban, terhadap daftar ini —
 * bukan satu permintaan per baris.
 *
 * Satu kolom pendek untuk ±1.500 orang adalah ~20 KB; itu sebabnya daftar ini
 * boleh dibaca utuh sementara pembacaan lain di berkas ini berhati-hati soal
 * halaman. Kalau `db-max-rows` PostgREST memotongnya, `IncompleteReadError`
 * dilempar daripada mengembalikan daftar pendek — sebab daftar yang pendek
 * akan membuat pratinjau menjanjikan "baru" untuk orang yang sudah ada, dan
 * itu kebohongan yang baru ketahuan setelah tombolnya ditekan.
 */
export async function listPersonnelNumbers(client: DbClient): Promise<string[]> {
  const semua: string[] = [];
  let seharusnya: number | null = null;

  for (let offset = 0; offset <= MAX_TALLY_ROWS * 4; offset += TALLY_PAGE) {
    const { data, error, count } = await client
      .from("employees")
      .select("personnel_number", offset === 0 ? { count: "exact" } : undefined)
      // Urutan stabil: tanpa ini, paging PostgREST bisa mengulang satu baris
      // dan melewatkan yang lain.
      .order("id")
      .range(offset, offset + TALLY_PAGE - 1);
    if (error) throw new DbError("Gagal membaca daftar Personnel Number", error);
    if (offset === 0) seharusnya = count;

    for (const row of data ?? []) semua.push(row.personnel_number);
    if ((data?.length ?? 0) < TALLY_PAGE) break;
  }

  if (seharusnya !== null && semua.length < seharusnya) {
    throw new IncompleteReadError("Personnel Number", semua.length, seharusnya);
  }
  return semua;
}
