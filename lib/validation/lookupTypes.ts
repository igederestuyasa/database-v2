/**
 * The 11 Lookup types HC Core knows about.
 *
 * FROZEN CONTRACT. This list must stay byte-identical to the CHECK constraint
 * on `lookups.tipe` in `supabase/migrations/0001_init.sql` (CLAUDE.md).
 * Two independent checks enforce that:
 *   - `lib/validation/lookupTypes.test.ts` (runs in `npm test`)
 *   - section 17 of `scripts/verify-schema.sql` (runs against real Postgres)
 *
 * Changing this list means changing the migration too — and there is only ever
 * one migration file, so that change must be made in place before any Supabase
 * project exists.
 */
export const LOOKUP_TYPES = [
  "gender",
  "work_contract",
  "person_grade",
  "job_grade",
  "legal_entity",
  "klasifikasi_rekrutmen",
  "teknik_non_teknik",
  "bod_range",
  "band_jabatan",
  "kategori_penempatan",
  "kategori_fungsi",
] as const;

export type LookupType = (typeof LOOKUP_TYPES)[number];

/** Indonesian labels for the Master Data page (CONTEXT.md vocabulary). */
export const LOOKUP_TYPE_LABELS: Record<LookupType, string> = {
  gender: "Jenis Kelamin",
  work_contract: "Work Contract",
  person_grade: "Person Grade",
  job_grade: "Job Grade",
  legal_entity: "Legal Entity",
  klasifikasi_rekrutmen: "Klasifikasi Rekrutmen",
  teknik_non_teknik: "Teknik / Non Teknik",
  bod_range: "BoD Range",
  band_jabatan: "Band Jabatan",
  kategori_penempatan: "Kategori Penempatan",
  kategori_fungsi: "Kategori Fungsi",
};

/** Narrowing guard for untrusted input (query strings, API params, Excel seed). */
export function isLookupType(value: unknown): value is LookupType {
  return (
    typeof value === "string" &&
    (LOOKUP_TYPES as readonly string[]).includes(value)
  );
}

/**
 * The `employees` column that stores each Lookup type's FK.
 * Mirrors the `employees_validate_lookups` trigger in the migration.
 */
export const LOOKUP_TYPE_TO_EMPLOYEE_COLUMN = {
  gender: "gender_id",
  work_contract: "work_contract_id",
  person_grade: "person_grade_id",
  job_grade: "job_grade_id",
  legal_entity: "legal_entity_id",
  klasifikasi_rekrutmen: "klasifikasi_rekrutmen_id",
  teknik_non_teknik: "teknik_non_teknik_id",
  bod_range: "bod_range_id",
  band_jabatan: "band_jabatan_id",
  kategori_penempatan: "kategori_penempatan_id",
  kategori_fungsi: "kategori_fungsi_id",
} as const satisfies Record<LookupType, string>;
