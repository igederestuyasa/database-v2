/**
 * Tabel yang bisa dirujuk sebuah Revisi, dan bentuk peta uuid → nama.
 *
 * Murni: tanpa React, tanpa database, tanpa `next/*`. Dipakai di dua sisi
 * yang tidak boleh saling mengimpor — `components/revisions/revisionDiff.ts`
 * mengumpulkan id dari snapshot `before`/`after` di browser, dan
 * `lib/db/labels.ts` membacanya menjadi nama di server. Sebelumnya tipe ini
 * hidup di `components/` dan `lib/actions/revisions.ts` mengimpornya dari
 * sana; sekarang keduanya mengimpor dari sini.
 */

/** Tabel yang ditunjuk kolom FK di dalam Revisi. `employees` untuk `employee_private`. */
export const REFERENCE_ENTITIES = [
  "org_units",
  "jabatan",
  "lookups",
  "employees",
  "profiles",
] as const;

export type ReferenceEntity = (typeof REFERENCE_ENTITIES)[number];

/** Id yang perlu diberi nama, dikelompokkan per tabel. Unik dan terurut. */
export type ReferenceIds = Record<ReferenceEntity, string[]>;

/** uuid → nama yang dikenali manusia. Key yang hilang itu wajar (RLS). */
export type ReferenceLabels = Readonly<Record<string, string>>;

export function emptyReferenceIds(): ReferenceIds {
  return {
    org_units: [],
    jabatan: [],
    lookups: [],
    employees: [],
    profiles: [],
  };
}

export function isEmptyReferenceIds(ids: ReferenceIds): boolean {
  return REFERENCE_ENTITIES.every((entity) => ids[entity].length === 0);
}
