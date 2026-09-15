/**
 * `v_employees` rows → the handful of fields the Karyawan table renders.
 *
 * NO `"use client"` HERE, on purpose: `page.tsx` is a Server Component and it
 * calls this. A mapper exported from a client module becomes a client
 * reference on the server, and calling it throws in a production build only —
 * see the long note in `lib/entityOptions.ts`.
 *
 * Mapping instead of handing `VEmployee` straight to the browser: the view has
 * seventy-odd columns and the table shows seven of them, so fifty full rows
 * would be serialised into the page payload for nothing. The narrow row also
 * keeps Data Pribadi Sensitif structurally out of reach — but note that is a
 * second line of defence, not the first: this page reads `v_employees`, never
 * `v_employees_private`, whose INNER JOIN would hand a viewer zero rows rather
 * than NULL columns (ADR-005 §10).
 */
import type { VEmployee } from "@/lib/types/db";

/** One line of the Karyawan table. */
export type KaryawanRow = {
  id: string;
  personnelNumber: string;
  nip: string | null;
  nama: string;
  /** Nama of the lowest Unit Organisasi the Karyawan points at. */
  unitNama: string | null;
  /** The chain above it, "Direktorat X › Divisi Y", for the second line. */
  unitInduk: string | null;
  jabatanNama: string | null;
  personGrade: string | null;
  jobGrade: string | null;
  status: "aktif" | "nonaktif";
};

/**
 * The hierarchy above the unit the Karyawan actually sits in.
 *
 * A Karyawan points at the LOWEST unit (ARCHITECTURE.md §3); the view resolves
 * the chain above it, and two units really can share a nama, so showing
 * "Bagian Kepesertaan" alone can be genuinely ambiguous. The unit's own nama is
 * dropped from the chain so it is not printed twice, and so is any repeat — in
 * the seed data a Sub Bagian may carry the same nama as its Bagian, which is
 * itself a Temuan on "Perlu Dibereskan".
 */
function rangkaiInduk(row: VEmployee): string | null {
  const rantai = [
    row.direktorat_nama,
    row.divisi_nama,
    row.departemen_nama,
    row.bagian_nama,
    row.sub_bagian_nama,
    row.proyek_nama,
  ];

  const terlihat = new Set<string>();
  if (row.org_unit_nama) terlihat.add(row.org_unit_nama);

  const bagian: string[] = [];
  for (const nama of rantai) {
    if (!nama || terlihat.has(nama)) continue;
    terlihat.add(nama);
    bagian.push(nama);
  }
  return bagian.length > 0 ? bagian.join(" › ") : null;
}

export function toKaryawanRow(row: VEmployee): KaryawanRow {
  return {
    id: row.id,
    personnelNumber: row.personnel_number,
    nip: row.nip,
    nama: row.full_name,
    unitNama: row.org_unit_nama,
    unitInduk: rangkaiInduk(row),
    jabatanNama: row.jabatan_nama,
    // The label is what a human reads ("Pratama III - 13"); the kode is the
    // half that never changes, and the detail page shows both.
    personGrade: row.person_grade_label ?? row.person_grade_kode,
    jobGrade: row.job_grade_label ?? row.job_grade_kode,
    // `v_employees.status` is a plain text column here; the CHECK constraint
    // keeps it to two values, and anything else is shown as nonaktif rather
    // than printed raw.
    status: row.status === "aktif" ? "aktif" : "nonaktif",
  };
}

export function toKaryawanRows(rows: readonly VEmployee[]): KaryawanRow[] {
  return rows.map(toKaryawanRow);
}
