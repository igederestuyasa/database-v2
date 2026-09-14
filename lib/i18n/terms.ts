/**
 * The CONTEXT.md glossary, as constants.
 *
 * UI language is Indonesian and the vocabulary is fixed: "Karyawan" not
 * "Employee", "Jabatan" not "Posisi", "Perlu Dibereskan" not "Perlu
 * Diperbaiki". Import from here instead of typing labels freehand, so the same
 * concept reads the same on every page.
 *
 * Each entry carries the words CONTEXT.md says to AVOID, so a reviewer can see
 * at a glance why the wording is what it is.
 */

/** Core entity names. Singular, Title Case — as they appear in headings. */
export const TERMS = {
  karyawan: "Karyawan", // avoid: employee (di UI), pegawai, staf, user
  personnelNumber: "Personnel Number", // avoid: PERNR, NIP
  nip: "NIP",
  statusKaryawan: "Status Karyawan", // avoid: dihapus, resign, deleted
  unitOrganisasi: "Unit Organisasi", // avoid: org unit, departemen (umum), business unit
  jabatan: "Jabatan", // avoid: posisi, position, role, formasi
  formasi: "Formasi", // reserved — belum ada di sistem (ADR-002)
  lookup: "Lookup", // avoid: enum, master, opsi, dropdown
  masterData: "Master Data", // nama halaman, bukan istilah data karyawan
  dataReferensi: "Data Referensi", // payung: Unit Organisasi + Jabatan + Lookup
  dataPribadiSensitif: "Data Pribadi Sensitif", // avoid: data rahasia, PII
  revisi: "Revisi", // avoid: log (untuk satu perubahan), history entry, versi
  batch: "Batch", // avoid: transaksi, commit, sesi
  revert: "Revert", // avoid: undo, rollback, restore
  merge: "Merge", // avoid: gabung (di kode), dedup
  seed: "Seed", // avoid: import, migrasi data, sync
  perluDibereskan: "Perlu Dibereskan", // avoid: anomali, data quality issue
  temuan: "Temuan", // satu baris di halaman Perlu Dibereskan
  konsumen: "Konsumen", // avoid: client, aplikasi eksternal, integrasi
  apiKey: "API Key", // avoid: token, secret, credential
  admin: "Admin", // avoid: superuser, editor
  viewer: "Viewer", // avoid: read-only user
} as const;

/** Sidebar / navigation labels, keyed by route segment. */
export const NAV_LABELS = {
  karyawan: "Karyawan",
  struktur: "Struktur Organisasi",
  jabatan: "Jabatan",
  "master-data": "Master Data",
  bereskan: "Perlu Dibereskan",
  log: "Log Perubahan",
  "api-keys": "API Key",
  pengguna: "Pengguna",
} as const;

export type NavSegment = keyof typeof NAV_LABELS;

/** `employees.status` / `org_units.status` / … */
export const STATUS_LABELS = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
} as const;

/** `profiles.role` */
export const ROLE_LABELS = {
  admin: "Admin",
  viewer: "Viewer",
} as const;

/** `org_units.tipe` */
export const ORG_UNIT_TYPE_LABELS = {
  direktorat: "Direktorat",
  divisi: "Divisi",
  departemen: "Departemen",
  bagian: "Bagian",
  sub_bagian: "Sub Bagian",
  proyek: "Proyek",
} as const;

/** `batches.jenis` — what one Batch was for. */
export const BATCH_TYPE_LABELS = {
  edit: "Edit",
  create: "Tambah",
  deactivate: "Nonaktifkan",
  merge: "Merge",
  rename: "Ganti Nama",
  seed: "Seed",
  revert: "Revert",
} as const;

/** `revisions.action` */
export const REVISION_ACTION_LABELS = {
  insert: "Ditambahkan",
  update: "Diubah",
} as const;

/** Reusable UI copy, so the same button never gets three wordings. */
export const UI = {
  simpan: "Simpan",
  batal: "Batal",
  tambah: "Tambah",
  ubah: "Ubah",
  cari: "Cari",
  filter: "Filter",
  nonaktifkan: "Nonaktifkan",
  aktifkan: "Aktifkan",
  kembalikan: "Kembalikan", // revert one Revisi
  kembalikanBatch: "Kembalikan seluruh Batch",
  lihatDetail: "Lihat detail",
  riwayatRevisi: "Riwayat Revisi",
  tidakAdaData: "Belum ada data.",
  tidakDitemukan: "Tidak ditemukan.",
  sedangMemuat: "Sedang memuat…",
  gagalMemuat: "Gagal memuat data.",
  cobaLagi: "Coba lagi",
  hanyaAdmin: "Hanya admin yang bisa melakukan ini.",
  sedangDibangun: "Halaman ini sedang dibangun.",
} as const;
