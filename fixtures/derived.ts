/**
 * Hand-computed expectations for the derived columns, against `ASOF`.
 *
 * Every number here was worked out by hand from the rules in
 * `lib/derived/pgAge.ts` and then confirmed against PostgreSQL's own `age()`
 * — see `lib/derived/pgAge.test.ts` for the raw pairs and
 * `lib/derived/sql.test.ts`, which re-derives them from `v_employees` in a
 * live local database.
 *
 * DUMMY DATA ONLY: the dates belong to the invented Karyawan in
 * `fixtures/employees.ts`.
 */
import { EMPLOYEE_ID } from "./ids";

export type DerivedExpectation = {
  employeeId: string;
  keterangan: string;
  masa_kerja_tahun: number | null;
  masa_kerja_bulan: number | null;
  masa_sejak_diangkat_tahun: number | null;
  masa_sejak_diangkat_bulan: number | null;
  masa_pg_tahun: number | null;
  masa_jg_tahun: number | null;
  usia: number | null;
};

/**
 * Expected derived values at `ASOF` (2026-09-14).
 *
 *   Budi   mulai 2023-05-14 → 3 tahun 4 bulan (tepat, tanpa sisa hari)
 *          diangkat 2024-01-01 → 2 tahun 8 bulan
 *          promosi PG 2022-09-14 → tepat 4 tahun
 *          promosi JG 2025-12-31 → 0 tahun (8 bulan 14 hari)
 *          lahir 1980-02-29 → 46 tahun (tahun kabisat, ulang tahun 29 Feb)
 *   Siti   mulai 2020-02-29 → 6 tahun 6 bulan: hari dipinjam dari Februari
 *          2020 yang 29 hari, bukan dari September
 *   Agus   mulai 2015-08-17 → 11 tahun 0 bulan (28 hari)
 *   Dewi   mulai 2027-01-01 (di masa depan) → negatif: 0 tahun -3 bulan,
 *          persis seperti yang dilaporkan view
 */
export const DERIVED_EXPECTATIONS: DerivedExpectation[] = [
  {
    employeeId: EMPLOYEE_ID.lengkap,
    keterangan: "Budi Contoh — semua tanggal terisi",
    masa_kerja_tahun: 3,
    masa_kerja_bulan: 4,
    masa_sejak_diangkat_tahun: 2,
    masa_sejak_diangkat_bulan: 8,
    masa_pg_tahun: 4,
    masa_jg_tahun: 0,
    usia: 46,
  },
  {
    employeeId: EMPLOYEE_ID.tanpaUnit,
    keterangan: "Siti Contoh — mulai 29 Februari tahun kabisat",
    masa_kerja_tahun: 6,
    masa_kerja_bulan: 6,
    masa_sejak_diangkat_tahun: null,
    masa_sejak_diangkat_bulan: null,
    masa_pg_tahun: null,
    masa_jg_tahun: null,
    usia: null,
  },
  {
    employeeId: EMPLOYEE_ID.nonaktif,
    keterangan: "Agus Contoh — nonaktif, masa kerja tetap dihitung",
    masa_kerja_tahun: 11,
    masa_kerja_bulan: 0,
    masa_sejak_diangkat_tahun: null,
    masa_sejak_diangkat_bulan: null,
    masa_pg_tahun: null,
    masa_jg_tahun: null,
    usia: null,
  },
  {
    employeeId: EMPLOYEE_ID.baru,
    keterangan: "Dewi Contoh — tanggal mulai di masa depan",
    masa_kerja_tahun: 0,
    masa_kerja_bulan: -3,
    masa_sejak_diangkat_tahun: null,
    masa_sejak_diangkat_bulan: null,
    masa_pg_tahun: null,
    masa_jg_tahun: null,
    usia: null,
  },
];

/**
 * Raw `age()` pairs confirmed against PostgreSQL 16.
 *
 * `[kemudian, lebih_awal, tahun, bulan, hari]`. These are the cases where a
 * naive "days ÷ 365.25" implementation goes wrong: month-end borrows, leap
 * days, and dates in the future.
 */
export const PG_AGE_CASES: ReadonlyArray<
  readonly [string, string, number, number, number]
> = [
  ["2026-09-14", "2023-05-14", 3, 4, 0],
  ["2024-03-01", "2024-01-31", 0, 1, 1],
  ["2024-02-29", "2023-02-28", 1, 0, 1],
  ["2023-03-01", "2023-01-31", 0, 1, 1],
  ["2026-09-14", "1980-02-29", 46, 6, 14],
  ["2026-01-01", "2025-12-31", 0, 0, 1],
  ["2026-03-31", "2026-02-28", 0, 1, 3],
  ["2026-02-28", "2026-03-31", 0, -1, -3],
  ["2020-01-01", "2026-09-14", -6, -8, -13],
  ["2026-09-14", "2026-09-14", 0, 0, 0],
  ["2026-09-01", "2025-09-02", 0, 11, 29],
  ["2026-08-31", "2025-08-31", 1, 0, 0],
  ["2027-03-30", "2024-12-31", 2, 2, 30],
  ["2026-09-14", "2000-01-01", 26, 8, 13],
  ["2026-07-15", "2026-06-16", 0, 0, 29],
];
