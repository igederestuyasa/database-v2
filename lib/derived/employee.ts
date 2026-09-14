/**
 * Kolom turunan Karyawan: usia, masa kerja, masa sejak promosi PG/JG (PRD #6).
 *
 * FROZEN CONTRACT (Wave 1). These are never stored (CLAUDE.md). `v_employees`
 * computes them in SQL; this module is the TypeScript half, for a UI that has
 * a row in hand and wants to recompute or reformat it. **The two must agree**,
 * so everything here goes through `pgAge()`, a faithful port of Postgres's
 * `age()` — see `lib/derived/pgAge.ts`.
 *
 * The one trap, straight from ADR-005: `*_bulan` is the **residual** months
 * after whole years (0–11), not total months. "3 tahun 4 bulan" is
 * `masa_kerja_tahun = 3, masa_kerja_bulan = 4`, never `bulan = 40`.
 *
 * The view's own columns are:
 *
 *   masa_kerja_*            ← original_start_date   (tahun + bulan)
 *   masa_sejak_diangkat_*   ← tanggal_diangkat      (tahun + bulan)
 *   masa_pg_tahun           ← tanggal_promosi_pg    (tahun only)
 *   masa_jg_tahun           ← tanggal_promosi_jg    (tahun only)
 *   usia                    ← employee_private.date_of_birth, and only in
 *                             v_employees_private (admin) — PRD #22
 */
import { ageSince, type DateInput } from "./pgAge";

/** Whole years plus the residual months (0–11), as the view reports them. */
export type Masa = {
  tahun: number;
  /** Residual months after whole years — 0–11, never a total. */
  bulan: number;
};

/** One `age()` in the shape the UI wants. `null` when the date is empty. */
export function computeMasa(value: DateInput, asOf?: DateInput): Masa | null {
  const interval = ageSince(value, asOf);
  return interval ? { tahun: interval.years, bulan: interval.months } : null;
}

/** Masa kerja sejak `original_start_date` (PRD #6). */
export function computeMasaKerja(
  originalStartDate: DateInput,
  asOf?: DateInput,
): Masa | null {
  return computeMasa(originalStartDate, asOf);
}

/** Masa sejak `tanggal_diangkat` — diangkat as tetap, not first joined. */
export function computeMasaSejakDiangkat(
  tanggalDiangkat: DateInput,
  asOf?: DateInput,
): Masa | null {
  return computeMasa(tanggalDiangkat, asOf);
}

/**
 * Masa sejak promosi Person Grade.
 *
 * The view exposes only the `tahun` half (`masa_pg_tahun`); the months are
 * computed here as well because a detail page reads better as "2 tahun 7
 * bulan". Both halves come from the same `age()` call, so the year always
 * matches the view.
 */
export function computeMasaPg(
  tanggalPromosiPg: DateInput,
  asOf?: DateInput,
): Masa | null {
  return computeMasa(tanggalPromosiPg, asOf);
}

/** Masa sejak promosi Job Grade. See `computeMasaPg`. */
export function computeMasaJg(
  tanggalPromosiJg: DateInput,
  asOf?: DateInput,
): Masa | null {
  return computeMasa(tanggalPromosiJg, asOf);
}

/**
 * Usia, in whole years, from Data Pribadi Sensitif (PRD #22).
 *
 * Only an admin ever has `date_of_birth` to pass in: for a viewer the column
 * is filtered by RLS and this returns `null`, which renders as "—".
 */
export function computeUsia(dateOfBirth: DateInput, asOf?: DateInput): number | null {
  const interval = ageSince(dateOfBirth, asOf);
  return interval ? interval.years : null;
}

/** The raw date columns every derived value is computed from. */
export type DerivableEmployee = {
  original_start_date?: DateInput;
  tanggal_diangkat?: DateInput;
  tanggal_promosi_pg?: DateInput;
  tanggal_promosi_jg?: DateInput;
  /** Only present for an admin, from `employee_private`. */
  date_of_birth?: DateInput;
};

/**
 * Every derived column, keyed exactly as `v_employees` names them.
 *
 * Same keys on purpose: a page can compare this against the view row it was
 * given, and `lib/derived/employee.sql.test.ts` compares the two for the same
 * fixture rows in a real database.
 */
export type DerivedEmployeeColumns = {
  masa_kerja_tahun: number | null;
  masa_kerja_bulan: number | null;
  masa_sejak_diangkat_tahun: number | null;
  masa_sejak_diangkat_bulan: number | null;
  masa_pg_tahun: number | null;
  masa_jg_tahun: number | null;
  /** `null` unless `date_of_birth` was supplied (admin only). */
  usia: number | null;
};

export function deriveEmployeeColumns(
  employee: DerivableEmployee,
  asOf?: DateInput,
): DerivedEmployeeColumns {
  const masaKerja = computeMasaKerja(employee.original_start_date, asOf);
  const masaDiangkat = computeMasaSejakDiangkat(employee.tanggal_diangkat, asOf);
  const masaPg = computeMasaPg(employee.tanggal_promosi_pg, asOf);
  const masaJg = computeMasaJg(employee.tanggal_promosi_jg, asOf);

  return {
    masa_kerja_tahun: masaKerja ? masaKerja.tahun : null,
    masa_kerja_bulan: masaKerja ? masaKerja.bulan : null,
    masa_sejak_diangkat_tahun: masaDiangkat ? masaDiangkat.tahun : null,
    masa_sejak_diangkat_bulan: masaDiangkat ? masaDiangkat.bulan : null,
    masa_pg_tahun: masaPg ? masaPg.tahun : null,
    masa_jg_tahun: masaJg ? masaJg.tahun : null,
    usia: computeUsia(employee.date_of_birth, asOf),
  };
}

/** What an empty cell reads as, so every table renders the same dash. */
export const KOSONG = "—";

/**
 * "3 tahun 4 bulan" — Indonesian, no pluralisation, `—` when unknown.
 *
 * A negative masa (a date in the future, which dirty seed data does contain)
 * is shown as "belum mulai" rather than "-1 tahun", so a Temuan reads as a
 * Temuan instead of as arithmetic.
 */
export function formatMasa(masa: Masa | null | undefined): string {
  if (!masa) return KOSONG;
  if (masa.tahun < 0 || masa.bulan < 0) return "belum mulai";
  if (masa.tahun === 0 && masa.bulan === 0) return "kurang dari 1 bulan";
  const parts: string[] = [];
  if (masa.tahun > 0) parts.push(`${masa.tahun} tahun`);
  if (masa.bulan > 0) parts.push(`${masa.bulan} bulan`);
  return parts.join(" ");
}

/** "45 tahun", or `—`. */
export function formatUsia(usia: number | null | undefined): string {
  if (usia === null || usia === undefined || usia < 0) return KOSONG;
  return `${usia} tahun`;
}

/** "3 tahun 4 bulan" straight from the two view columns. */
export function formatMasaColumns(
  tahun: number | null | undefined,
  bulan: number | null | undefined,
): string {
  if (tahun === null || tahun === undefined) return KOSONG;
  return formatMasa({ tahun, bulan: bulan ?? 0 });
}
