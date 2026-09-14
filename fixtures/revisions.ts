/**
 * Dummy Batch and Revisi, for testing revert planning without a database.
 *
 * DUMMY DATA ONLY. The `before`/`after` snapshots are trimmed to the columns a
 * test cares about — `planRevert()` intersects them with the real column list
 * from `lib/schema/columns.generated.ts`, so a partial snapshot is exactly the
 * case worth covering (ADR-003: "abaikan kolom tak dikenal").
 */
import type { Batch, Json, Revision } from "@/lib/types/db";

import { BATCH_ID, EMPLOYEE_ID, JABATAN_ID, ORG_UNIT_ID, PROFILE_ID } from "./ids";

const WAKTU = "2026-02-03T04:05:06.000Z";

function revision(
  row: Pick<Revision, "id" | "batch_id" | "table_name" | "row_id" | "action"> & {
    before?: Json | null;
    after: Json;
    actor_id?: string | null;
  },
): Revision {
  return {
    before: row.before ?? null,
    actor_id: row.actor_id ?? PROFILE_ID.admin,
    created_at: WAKTU,
    ...row,
  };
}

export const BATCHES: Batch[] = [
  {
    id: BATCH_ID.edit,
    jenis: "edit",
    keterangan: "Ubah data Karyawan",
    actor_id: PROFILE_ID.admin,
    reverted_by_batch_id: null,
    created_at: WAKTU,
  },
  {
    id: BATCH_ID.merge,
    jenis: "merge",
    keterangan: 'Merge Unit Organisasi: "DIVISI CONTOH" → "Divisi Contoh"',
    actor_id: PROFILE_ID.admin,
    reverted_by_batch_id: null,
    created_at: WAKTU,
  },
  {
    id: BATCH_ID.seed,
    jenis: "seed",
    keterangan: "Seed awal dari Excel",
    actor_id: null,
    reverted_by_batch_id: null,
    created_at: WAKTU,
  },
];

/** One `edit` Batch: a Karyawan moved to another Unit Organisasi. */
export const REVISI_EDIT_KARYAWAN: Revision = revision({
  id: 101,
  batch_id: BATCH_ID.edit,
  table_name: "employees",
  row_id: EMPLOYEE_ID.lengkap,
  action: "update",
  before: {
    id: EMPLOYEE_ID.lengkap,
    full_name: "Budi Contoh",
    org_unit_id: ORG_UNIT_ID.bagian,
    jabatan_id: JABATAN_ID.staf,
    status: "aktif",
    created_at: WAKTU,
    updated_at: WAKTU,
  },
  after: {
    id: EMPLOYEE_ID.lengkap,
    full_name: "Budi Contoh",
    org_unit_id: ORG_UNIT_ID.subBagian,
    jabatan_id: JABATAN_ID.manager,
    status: "aktif",
    created_at: WAKTU,
    updated_at: "2026-02-03T04:05:07.000Z",
  },
});

/** A second change to the same Karyawan, later in the same Batch. */
export const REVISI_EDIT_KARYAWAN_LANJUTAN: Revision = revision({
  id: 102,
  batch_id: BATCH_ID.edit,
  table_name: "employees",
  row_id: EMPLOYEE_ID.lengkap,
  action: "update",
  before: {
    id: EMPLOYEE_ID.lengkap,
    full_name: "Budi Contoh",
    org_unit_id: ORG_UNIT_ID.subBagian,
    jabatan_id: JABATAN_ID.manager,
    status: "aktif",
  },
  after: {
    id: EMPLOYEE_ID.lengkap,
    full_name: "Budi Contoh Revisi",
    org_unit_id: ORG_UNIT_ID.subBagian,
    jabatan_id: JABATAN_ID.manager,
    status: "aktif",
  },
});

/** A newly created Unit Organisasi — reverting this deactivates it. */
export const REVISI_INSERT_UNIT: Revision = revision({
  id: 103,
  batch_id: BATCH_ID.merge,
  table_name: "org_units",
  row_id: ORG_UNIT_ID.proyek,
  action: "insert",
  after: {
    id: ORG_UNIT_ID.proyek,
    kode: "PRY-CONTOH",
    nama: "Proyek Contoh",
    tipe: "proyek",
    parent_id: ORG_UNIT_ID.divisi,
    status: "aktif",
    merged_into_id: null,
  },
});

/** Data Pribadi Sensitif — keyed by `employee_id`, not `id`. */
export const REVISI_UPDATE_PRIVATE: Revision = revision({
  id: 104,
  batch_id: BATCH_ID.edit,
  table_name: "employee_private",
  row_id: EMPLOYEE_ID.lengkap,
  action: "update",
  before: {
    employee_id: EMPLOYEE_ID.lengkap,
    date_of_birth: "1980-02-29",
    place_of_birth: "Kota Contoh",
    religion: "Islam",
    marital_status: "Belum Menikah",
  },
  after: {
    employee_id: EMPLOYEE_ID.lengkap,
    date_of_birth: "1980-02-29",
    place_of_birth: "Kota Contoh",
    religion: "Islam",
    marital_status: "Menikah",
  },
});

/** A role change — `profiles` is the seventh logged table (ADR-005 §12). */
export const REVISI_UPDATE_PROFIL: Revision = revision({
  id: 105,
  batch_id: BATCH_ID.edit,
  table_name: "profiles",
  row_id: PROFILE_ID.viewer,
  action: "update",
  before: {
    id: PROFILE_ID.viewer,
    email: "viewer.contoh@example.test",
    role: "viewer",
  },
  after: {
    id: PROFILE_ID.viewer,
    email: "viewer.contoh@example.test",
    role: "admin",
  },
});

/** A newly created profile — no `status` column, so it cannot be reverted. */
export const REVISI_INSERT_PROFIL: Revision = revision({
  id: 106,
  batch_id: BATCH_ID.edit,
  table_name: "profiles",
  row_id: PROFILE_ID.viewer,
  action: "insert",
  after: {
    id: PROFILE_ID.viewer,
    email: "viewer.contoh@example.test",
    role: "viewer",
  },
});

/**
 * A Revisi whose `before` only holds columns this schema no longer knows.
 *
 * Cannot happen today — the schema has never changed — but ADR-003 promises
 * that a revert ignores unknown columns instead of failing, and that promise
 * needs a test.
 */
export const REVISI_KOLOM_ASING: Revision = revision({
  id: 107,
  batch_id: BATCH_ID.seed,
  table_name: "jabatan",
  row_id: JABATAN_ID.staf,
  action: "update",
  before: { kolom_yang_sudah_dihapus: "nilai lama" },
  after: { kolom_yang_sudah_dihapus: "nilai baru" },
});

/** Not one of the seven logged tables. */
export const REVISI_TABEL_ASING: Revision = revision({
  id: 108,
  batch_id: BATCH_ID.seed,
  table_name: "tabel_yang_tidak_ada",
  row_id: JABATAN_ID.staf,
  action: "update",
  before: { nama: "lama" },
  after: { nama: "baru" },
});

/** Every fixture Revisi, in the order they were written. */
export const REVISIONS: Revision[] = [
  REVISI_EDIT_KARYAWAN,
  REVISI_EDIT_KARYAWAN_LANJUTAN,
  REVISI_INSERT_UNIT,
  REVISI_UPDATE_PRIVATE,
  REVISI_UPDATE_PROFIL,
  REVISI_INSERT_PROFIL,
  REVISI_KOLOM_ASING,
  REVISI_TABEL_ASING,
];
