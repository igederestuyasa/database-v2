/**
 * Temuan struktural untuk "Perlu Dibereskan" (PRD #11).
 *
 * Three findings live here, all of them things the database deliberately does
 * NOT refuse:
 *
 *   1. **Unit Organisasi tanpa induk.** `org_units.parent_id` is nullable for
 *      every tipe on purpose — ARCHITECTURE.md §3: "NULL hanya boleh untuk
 *      `direktorat` (dicek di halaman Bereskan, bukan constraint, agar seed
 *      data kotor tetap bisa masuk)". A constraint would have made the Seed
 *      fail halfway through 1.475 Karyawan; reporting it here is the
 *      alternative that was chosen, so this function is that constraint.
 *   2. **Karyawan tanpa Unit Organisasi atau Jabatan.** Both FKs are nullable
 *      because the Excel cell was blank for some rows.
 *   3. **Unit Organisasi yang namanya sama dengan induknya.** The Seed skips
 *      creating a Sub Bagian whose name equals its Bagian (ARCHITECTURE.md
 *      §4E), so a pair like that came from a hand edit and means one level of
 *      the hierarchy carries no information.
 *
 * Pure: plain rows in, Temuan out. No Supabase, no React, so every rule here
 * is provable without a database (CLAUDE.md).
 *
 * All three default to reporting **aktif rows only**. A nonaktif Unit
 * Organisasi is either merged away or retired; dragging it back onto the page
 * would mean the page never reaches zero, which PRD §7 names as the measure of
 * success.
 */
import { normalizeName } from "./normalize";

/** One `org_units` row, reduced to what these rules need. */
export type OrgUnitRow = {
  id: string;
  kode: string;
  nama: string;
  /** `direktorat` | `divisi` | `departemen` | `bagian` | `sub_bagian` | `proyek`. */
  tipe: string;
  parent_id: string | null;
  status: string;
};

/** One `employees` row, reduced to what these rules need. */
export type EmployeeRow = {
  id: string;
  personnel_number: string;
  full_name: string;
  org_unit_id: string | null;
  jabatan_id: string | null;
  status: string;
};

/** Why a Unit Organisasi counts as having no induk. */
export type AlasanTanpaInduk =
  /** `parent_id` is NULL, and this tipe is not the root tipe. */
  | "tanpa_induk"
  /** `parent_id` points at a row that is not in the data at all. */
  | "induk_hilang"
  /** The induk exists but is nonaktif, so the branch hangs off nothing live. */
  | "induk_nonaktif";

export type TemuanUnitTanpaInduk = {
  id: string;
  jenis: "unit_tanpa_induk";
  entitas: "org_unit";
  unit: OrgUnitRow;
  alasan: AlasanTanpaInduk;
  /** The `parent_id` on the row, kept for "induk_hilang" so it can be quoted. */
  indukId: string | null;
};

export type TemuanUnitSenamaInduk = {
  id: string;
  jenis: "unit_senama_induk";
  entitas: "org_unit";
  unit: OrgUnitRow;
  induk: OrgUnitRow;
};

/** Which reference a Karyawan is missing. */
export type ReferensiHilang = "unit" | "jabatan";

export type TemuanKaryawanTanpaReferensi = {
  id: string;
  jenis: "karyawan_tanpa_referensi";
  entitas: "employee";
  karyawan: EmployeeRow;
  /** One or both. Never empty. */
  kekurangan: ReferensiHilang[];
};

export type FindOrphanOptions = {
  /** Also report nonaktif rows. Default `false` — see the header. */
  includeNonaktif?: boolean;
};

export type FindOrphanUnitOptions = FindOrphanOptions & {
  /**
   * The tipe for which `parent_id = NULL` is correct. Default `"direktorat"`,
   * the top of the hierarchy in ADR-002.
   */
  tipeAkar?: string;
};

function byNama(a: { nama: string }, b: { nama: string }): number {
  return a.nama.localeCompare(b.nama, "id");
}

/**
 * Unit Organisasi that hang off nothing.
 *
 * `rows` must be **every** Unit Organisasi, nonaktif included: an induk is
 * "hilang" only if it is absent from the whole table, and a list pre-filtered
 * to aktif rows would report every child of every nonaktif unit as an orphan.
 * Filtering for display happens here instead, after the lookup map is built.
 */
export function findOrphanOrgUnits(
  rows: readonly OrgUnitRow[],
  options: FindOrphanUnitOptions = {},
): TemuanUnitTanpaInduk[] {
  const { includeNonaktif = false, tipeAkar = "direktorat" } = options;

  const byId = new Map(rows.map((row) => [row.id, row]));
  const temuan: TemuanUnitTanpaInduk[] = [];

  for (const unit of rows) {
    if (!includeNonaktif && unit.status !== "aktif") continue;
    // A direktorat is the top of the hierarchy: NULL there is the correct
    // answer, not a Temuan.
    if (unit.tipe === tipeAkar) continue;

    let alasan: AlasanTanpaInduk | null = null;

    if (unit.parent_id === null) {
      alasan = "tanpa_induk";
    } else if (unit.parent_id === unit.id) {
      // The `org_units_no_cycle` trigger refuses this, so it can only come
      // from data that predates the trigger — report it rather than let the
      // unit silently look parented.
      alasan = "induk_hilang";
    } else {
      const induk = byId.get(unit.parent_id);
      if (!induk) alasan = "induk_hilang";
      else if (induk.status !== "aktif") alasan = "induk_nonaktif";
    }

    if (!alasan) continue;

    temuan.push({
      id: `unit_tanpa_induk:${unit.id}`,
      jenis: "unit_tanpa_induk",
      entitas: "org_unit",
      unit,
      alasan,
      indukId: unit.parent_id,
    });
  }

  return temuan.sort((a, b) => byNama(a.unit, b.unit) || a.id.localeCompare(b.id));
}

/**
 * Unit Organisasi whose nama is its induk's nama.
 *
 * Compared through `normalizeName()`, so "QHSSE" under "qhsse " counts: the
 * point is that the two levels say the same thing, and capitalisation does not
 * make that less true.
 *
 * Both rows must be aktif (unless `includeNonaktif`): a child under a nonaktif
 * induk is already reported by `findOrphanOrgUnits()`, and saying it twice
 * makes the page longer without making it more finishable.
 */
export function findUnitsNamedLikeParent(
  rows: readonly OrgUnitRow[],
  options: FindOrphanOptions = {},
): TemuanUnitSenamaInduk[] {
  const { includeNonaktif = false } = options;

  const byId = new Map(rows.map((row) => [row.id, row]));
  const temuan: TemuanUnitSenamaInduk[] = [];

  for (const unit of rows) {
    if (!includeNonaktif && unit.status !== "aktif") continue;
    if (!unit.parent_id || unit.parent_id === unit.id) continue;

    const induk = byId.get(unit.parent_id);
    if (!induk) continue;
    if (!includeNonaktif && induk.status !== "aktif") continue;

    const nama = normalizeName(unit.nama);
    if (nama.length === 0 || nama !== normalizeName(induk.nama)) continue;

    temuan.push({
      id: `unit_senama_induk:${unit.id}`,
      jenis: "unit_senama_induk",
      entitas: "org_unit",
      unit,
      induk,
    });
  }

  return temuan.sort((a, b) => byNama(a.unit, b.unit) || a.id.localeCompare(b.id));
}

/**
 * Karyawan with no Unit Organisasi, no Jabatan, or neither.
 *
 * One Temuan per Karyawan, not one per missing column: staf HC fixes both in
 * the same form, and two rows for one person would double the page for no
 * extra work done.
 */
export function findEmployeesMissingReference(
  rows: readonly EmployeeRow[],
  options: FindOrphanOptions = {},
): TemuanKaryawanTanpaReferensi[] {
  const { includeNonaktif = false } = options;

  const temuan: TemuanKaryawanTanpaReferensi[] = [];

  for (const karyawan of rows) {
    if (!includeNonaktif && karyawan.status !== "aktif") continue;

    const kekurangan: ReferensiHilang[] = [];
    if (!karyawan.org_unit_id) kekurangan.push("unit");
    if (!karyawan.jabatan_id) kekurangan.push("jabatan");
    if (kekurangan.length === 0) continue;

    temuan.push({
      id: `karyawan_tanpa_referensi:${karyawan.id}`,
      jenis: "karyawan_tanpa_referensi",
      entitas: "employee",
      karyawan,
      kekurangan,
    });
  }

  return temuan.sort(
    (a, b) =>
      a.karyawan.full_name.localeCompare(b.karyawan.full_name, "id") ||
      a.id.localeCompare(b.id),
  );
}
