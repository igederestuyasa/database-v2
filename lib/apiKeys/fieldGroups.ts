/**
 * Semesta `allowed_fields`, dikelompokkan seperti API-CONTRACT.md
 * mengelompokkannya (PRD #19, ADR-004).
 *
 * `API_EMPLOYEE_FIELDS` (= daftar kolom `v_employees_api`, dibuat dari
 * database) berisi ±57 nama kolom dalam satu larik datar. Itu bentuk yang
 * benar untuk dicocokkan mesin, tapi mustahil dipilih manusia: 57 kotak
 * centang tanpa urutan yang berarti membuat admin mencentang semuanya supaya
 * selesai — dan "centang semua" persis kebalikan dari gunanya whitelist.
 *
 * Jadi urutan dan pengelompokannya diambil dari §"Kolom `v_employees_api` yang
 * bisa diminta" di API-CONTRACT.md, dokumen yang juga dibaca pengembang
 * Konsumen. Keduanya dijaga tetap sama oleh `fieldGroups.test.ts`, yang
 * mem-parse markdown-nya dan membandingkan grup demi grup; menambah kolom di
 * view tanpa menempatkannya di sini akan menggagalkan test, bukan diam-diam
 * hilang dari layar.
 *
 * **Data Pribadi Sensitif tidak ada di sini karena tidak ada di semestanya.**
 * `date_of_birth`, `place_of_birth`, `religion`, `marital_status` dan `usia`
 * bukan bagian dari `v_employees_api` (PRD #22, ADR-004), jadi tidak ada grup
 * yang bisa memuatnya dan tidak ada kotak centang yang bisa memberikannya.
 * Bukan modul ini yang menjaganya — modul ini hanya tidak punya jalan ke sana.
 *
 * Modul biasa, BUKAN `"use client"`: `page.tsx` (Server Component) dan
 * form pemilih kolomnya (Client Component) sama-sama mengimpornya.
 */
import { API_EMPLOYEE_FIELDS } from "@/lib/schema/columns.generated";

export type ApiFieldGroupId =
  | "identitas"
  | "posisi"
  | "lookup"
  | "tanggal"
  | "turunan"
  | "lain";

export type ApiFieldGroup = {
  id: ApiFieldGroupId;
  /** Judul grup, sama dengan yang tertulis di API-CONTRACT.md. */
  label: string;
  /** Satu kalimat: apa isi grup ini, untuk admin yang bukan pengembang. */
  keterangan: string;
  /** Kolom dalam grup ini, urut seperti di API-CONTRACT.md. */
  fields: readonly string[];
};

/**
 * Kesebelas Lookup, masing-masing hadir sebagai `*_kode` dan `*_label`.
 *
 * Dituliskan sebagai nama dasar lalu dimekarkan, persis seperti baris
 * "Lookup (tiap satu `*_kode` dan `*_label`)" di API-CONTRACT.md — 22 nama
 * yang diketik satu per satu adalah 22 kesempatan salah ketik.
 */
const LOOKUP_BASES = [
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

const LOOKUP_FIELDS: readonly string[] = LOOKUP_BASES.flatMap((base) => [
  `${base}_kode`,
  `${base}_label`,
]);

/** Enam grup, urut seperti API-CONTRACT.md. */
export const API_FIELD_GROUPS: readonly ApiFieldGroup[] = [
  {
    id: "identitas",
    label: "Identitas",
    keterangan:
      "Nomor dan nama Karyawan. personnel_number adalah kunci yang dipakai Konsumen untuk mencocokkan datanya sendiri.",
    fields: [
      "id",
      "personnel_number",
      "nip",
      "full_name",
      "status",
      "tanggal_keluar",
    ],
  },
  {
    id: "posisi",
    label: "Posisi",
    keterangan:
      "Unit Organisasi terendah beserta induk-induknya sampai Direktorat, dan Jabatan yang dipegang.",
    fields: [
      "org_unit_id",
      "org_unit_kode",
      "org_unit_nama",
      "org_unit_tipe",
      "direktorat_nama",
      "divisi_nama",
      "departemen_nama",
      "bagian_nama",
      "sub_bagian_nama",
      "proyek_nama",
      "jabatan_id",
      "jabatan_kode",
      "jabatan_nama",
      "keterangan_pj_plt",
      "keterangan_rangkap_1",
      "keterangan_rangkap_2",
    ],
  },
  {
    id: "lookup",
    label: "Lookup",
    keterangan:
      "Nilai pilihan, masing-masing dua kolom: _kode untuk dicocokkan mesin, _label untuk dibaca orang.",
    fields: LOOKUP_FIELDS,
  },
  {
    id: "tanggal",
    label: "Tanggal & surat",
    keterangan:
      "Tanggal mulai, pengangkatan, dan promosi Person Grade / Job Grade beserta nomor suratnya.",
    fields: [
      "original_start_date",
      "tanggal_diangkat",
      "tanggal_promosi_pg",
      "nomor_surat_pg",
      "tanggal_promosi_jg",
      "nomor_surat_jg",
    ],
  },
  {
    id: "turunan",
    label: "Turunan",
    keterangan:
      "Dihitung dari tanggal di atas setiap kali diminta, tidak pernah disimpan — jadi tidak pernah basi.",
    fields: [
      "masa_kerja_tahun",
      "masa_kerja_bulan",
      "masa_pg_tahun",
      "masa_jg_tahun",
    ],
  },
  {
    id: "lain",
    label: "Lain",
    keterangan:
      "Jurusan pendidikan, keterangan bebas, dan waktu perubahan terakhir (dipakai Konsumen yang menarik data secara bertahap).",
    fields: ["jurusan", "keterangan", "updated_at"],
  },
];

/** Semesta yang sama, datar dan urut grup — untuk pencarian dan penghitungan. */
export const API_FIELDS_BY_GROUP_ORDER: readonly string[] =
  API_FIELD_GROUPS.flatMap((group) => group.fields);

/** Jumlah kolom yang bisa dipilih sama sekali. */
export const TOTAL_API_FIELDS = API_EMPLOYEE_FIELDS.length;

const FIELD_SET: ReadonlySet<string> = new Set(API_EMPLOYEE_FIELDS);

/**
 * Apakah nama kolom ini boleh dipilih sama sekali.
 *
 * Dipakai untuk membersihkan `allowed_fields` yang dibaca dari database
 * sebelum ditampilkan: sebuah key yang dibuat sebelum sebuah kolom dibuang
 * dari view masih menyimpan nama kolom itu, dan kotak centang yang tidak ada
 * di layar tidak boleh ikut terkirim lagi saat disimpan.
 */
export function isSelectableApiField(field: string): boolean {
  return FIELD_SET.has(field);
}

/**
 * Urutkan pilihan mengikuti urutan API-CONTRACT.md, dan buang yang tidak
 * dikenal (beserta duplikatnya).
 */
export function sortApiFields(fields: readonly string[]): string[] {
  const dipilih = new Set(fields);
  return API_FIELDS_BY_GROUP_ORDER.filter((field) => dipilih.has(field));
}

/**
 * Kolom yang tersimpan di sebuah key tapi tidak ada lagi di
 * `v_employees_api` — nol pada skema yang sehat, dan sesuatu yang harus
 * dikatakan, bukan disembunyikan, kalau tidak nol.
 */
export function unknownApiFields(fields: readonly string[]): string[] {
  return [...new Set(fields)].filter((field) => !FIELD_SET.has(field)).sort();
}

/** Berapa kolom dari `group` yang ada di `selected`. */
export function countSelectedInGroup(
  group: ApiFieldGroup,
  selected: ReadonlySet<string>,
): number {
  let jumlah = 0;
  for (const field of group.fields) if (selected.has(field)) jumlah += 1;
  return jumlah;
}
