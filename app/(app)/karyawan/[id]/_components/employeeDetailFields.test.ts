/**
 * What the Karyawan detail page SAYS, pinned.
 *
 * `employeeDetailFields.ts` is pure — no JSX, no hooks, no database — and it
 * decides every label and every value on the page, so this is where the page's
 * promises are checked:
 *
 *   * no uuid ever reaches the screen (PRD #6 reads names, not ids);
 *   * a derived column is marked as derived and computed, never stored;
 *   * `*_bulan` is the RESIDUAL months (0–11), so eleven months never prints
 *     as "kurang dari 1 bulan" and 40 months never prints as "40 bulan"
 *     (ADR-005 §10);
 *   * Data Pribadi Sensitif renders the same for "belum diisi" as for a viewer
 *     whose row RLS removed — the caller decides whether to draw it at all.
 *
 * COLLECTED BY `npm test`. `vitest.config.ts` gathers `*.test.ts` from `app/**`
 * as well as `lib/**`, `components/**`, `scripts/**` and `tests/**`, so a test
 * written next to its `page.tsx` runs with the rest (CLAUDE.md).
 *
 * DUMMY DATA ONLY — invented names and Personnel Numbers (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";

import { KOSONG } from "@/lib/derived";
import type { EmployeePrivate, VEmployee } from "@/lib/types/db";

import {
  buildEmployeeSections,
  buildPrivateFields,
  labelStatus,
  labelTipeUnit,
  rantaiUnit,
  semuaKosong,
  type DetailField,
} from "./employeeDetailFields";

/** The fixed "today" every expectation below is computed against. */
const ASOF = "2026-09-14";

const WAKTU = "2026-01-02T03:04:05.000Z";

const UUID = {
  karyawan: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  unit: "11111111-1111-4111-8111-000000000009",
  jabatan: "22222222-2222-4222-8222-000000000001",
  lookup: "33333333-3333-4333-8333-000000000001",
};

/** A `v_employees` row with every column null unless named. */
function karyawan(overrides: Partial<VEmployee> = {}): VEmployee {
  const base = {
    id: UUID.karyawan,
    personnel_number: "TEST-0001",
    nip: null,
    full_name: "Budi Contoh",
    status: "aktif",
    org_unit_id: null,
    org_unit_kode: null,
    org_unit_nama: null,
    org_unit_tipe: null,
    direktorat_nama: null,
    divisi_nama: null,
    departemen_nama: null,
    bagian_nama: null,
    sub_bagian_nama: null,
    proyek_nama: null,
    jabatan_id: null,
    jabatan_kode: null,
    jabatan_nama: null,
    keterangan_pj_plt: null,
    keterangan_rangkap_1: null,
    keterangan_rangkap_2: null,
    keterangan: null,
    jurusan: null,
    original_start_date: null,
    tanggal_diangkat: null,
    tanggal_promosi_pg: null,
    nomor_surat_pg: null,
    tanggal_promosi_jg: null,
    nomor_surat_jg: null,
    tanggal_keluar: null,
    masa_kerja_tahun: null,
    masa_kerja_bulan: null,
    masa_sejak_diangkat_tahun: null,
    masa_sejak_diangkat_bulan: null,
    masa_pg_tahun: null,
    masa_jg_tahun: null,
    created_at: WAKTU,
    updated_at: WAKTU,
  } as VEmployee;

  // The eleven Lookup triples, all empty, added without naming them twice.
  const kosong: Record<string, null> = {};
  for (const tipe of [
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
  ]) {
    kosong[`${tipe}_id`] = null;
    kosong[`${tipe}_kode`] = null;
    kosong[`${tipe}_label`] = null;
  }

  return { ...base, ...kosong, ...overrides } as VEmployee;
}

function semuaField(employee: VEmployee, asOf = ASOF): DetailField[] {
  return buildEmployeeSections(employee, asOf).flatMap((section) => [
    ...section.fields,
  ]);
}

function nilai(fields: readonly DetailField[], label: string): string {
  const found = fields.find((field) => field.label === label);
  if (!found) throw new Error(`Tidak ada field berlabel "${label}"`);
  return found.value;
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("buildEmployeeSections", () => {
  it("menampilkan Email Kantor, dan menyebut bahwa ia keluar lewat API", () => {
    const fields = semuaField(karyawan({ email_kantor: "budi.contoh@contoh.test" }));
    expect(nilai(fields, "Email Kantor")).toBe("budi.contoh@contoh.test");

    // Penandanya bukan hiasan: satu-satunya email lain di aplikasi ini adalah
    // akun login (`profiles.email`), dan halaman yang tidak mengatakan yang
    // mana ini mengundang tepat kebingungan itu.
    const email = fields.find((field) => field.label === "Email Kantor");
    expect(email?.info).toMatch(/API/);
  });

  it("Email Kantor yang kosong jadi tanda kosong, bukan string kosong", () => {
    expect(nilai(semuaField(karyawan()), "Email Kantor")).toBe(KOSONG);
  });

  it("menampilkan nama Data Referensi, bukan uuid", () => {
    const fields = semuaField(
      karyawan({
        org_unit_id: UUID.unit,
        org_unit_kode: "SUB-CONTOH",
        org_unit_nama: "Sub Bagian Contoh",
        org_unit_tipe: "sub_bagian",
        jabatan_id: UUID.jabatan,
        jabatan_kode: "JBT-001",
        jabatan_nama: "Manager Proyek Contoh",
        job_grade_id: UUID.lookup,
        job_grade_kode: "JG-12",
        job_grade_label: "Pratama II - 12",
      }),
    );

    expect(nilai(fields, "Unit Organisasi")).toBe("Sub Bagian Contoh");
    expect(nilai(fields, "Jabatan")).toBe("Manager Proyek Contoh");
    expect(nilai(fields, "Job Grade")).toBe("Pratama II - 12");

    const semuaTeks = fields
      .flatMap((field) => [field.label, field.value, field.catatan ?? ""])
      .join(" | ");
    expect(semuaTeks).not.toMatch(UUID_RE);
  });

  /**
   * Halaman ini TIDAK memuat kode Data Referensi.
   *
   * Kode-nya diturunkan dari labelnya, jadi "Kode FEMALE" di bawah "Female"
   * hanya mengeja ulang baris di atasnya — tiga belas baris abu-abu yang tidak
   * menjawab apa pun tentang orang ini. Kodenya tetap ada di halaman detail
   * Data Referensi-nya sendiri, tempat ia memang identitas barangnya.
   *
   * Tingkat unit tetap ditulis, dan itu bukan pengecualian yang tidak
   * konsisten: "Sub Bagian" tidak bisa dibaca dari nama unitnya sendiri.
   */
  it("menulis tingkat Unit Organisasi, tanpa kodenya", () => {
    const fields = semuaField(
      karyawan({
        org_unit_nama: "Sub Bagian Contoh",
        org_unit_kode: "SUB-CONTOH",
        org_unit_tipe: "sub_bagian",
      }),
    );
    const unit = fields.find((field) => field.label === "Unit Organisasi");
    expect(unit?.catatan).toBe("Sub Bagian");
  });

  it("tidak menempelkan kode pada Jabatan maupun Lookup", () => {
    const fields = semuaField(
      karyawan({
        jabatan_nama: "Manager",
        jabatan_kode: "JB-MANAGER",
        gender_label: "Female",
        gender_kode: "FEMALE",
      }),
    );
    const jabatan = fields.find((field) => field.label === "Jabatan");
    const gender = fields.find((field) => field.label === "Jenis Kelamin");
    expect(jabatan?.value).toBe("Manager");
    expect(jabatan?.catatan).toBeUndefined();
    expect(gender?.value).toBe("Female");
    expect(gender?.catatan).toBeUndefined();
  });

  it("tidak menempelkan kode pada kolom yang kosong", () => {
    const fields = semuaField(karyawan());
    const unit = fields.find((field) => field.label === "Unit Organisasi");
    expect(unit?.value).toBe(KOSONG);
    expect(unit?.catatan).toBeUndefined();
  });

  it("menandai setiap kolom turunan sebagai dihitung otomatis (PRD #6)", () => {
    const fields = semuaField(karyawan());
    const turunan = fields.filter((field) => field.turunan).map((f) => f.label);
    expect(turunan).toEqual([
      // Jenjang hierarki: diturunkan dari Unit Organisasi yang ditunjuk
      // Karyawan, bukan diisi di barisnya. Ditandai supaya halaman ini tidak
      // memajang enam kolom yang terlihat bisa diisi sementara form Ubah
      // hanya punya satu.
      "Direktorat",
      "Divisi",
      "Departemen",
      "Bagian",
      "Sub Bagian",
      "Proyek",
      // Dihitung dari tanggal.
      "Masa Kerja",
      "Masa Sejak Diangkat",
      "Masa Sejak Promosi PG",
      "Masa Sejak Promosi JG",
    ]);
  });

  /**
   * Kalimat penandanya harus cocok dengan sebabnya. "Dihitung dari tanggal"
   * benar untuk Masa Kerja dan salah untuk Direktorat — dan justru kalimat
   * itulah yang dibaca orang yang bertanya "kenapa Departemen tidak ada
   * isiannya?".
   */
  it("menjelaskan turunan hierarki dengan sebabnya sendiri, bukan kalimat tanggal", () => {
    const fields = semuaField(karyawan());
    const direktorat = fields.find((field) => field.label === "Direktorat");
    expect(typeof direktorat?.turunan).toBe("string");
    expect(String(direktorat?.turunan)).toMatch(/hierarki/i);
    expect(String(direktorat?.turunan)).toMatch(/Struktur Organisasi/);
    expect(String(direktorat?.turunan)).not.toMatch(/tanggal/i);

    // Yang dihitung dari tanggal tetap memakai kalimat bawaannya.
    expect(fields.find((field) => field.label === "Masa Kerja")?.turunan).toBe(true);
  });

  it("memakai sisa bulan, bukan total bulan (ADR-005 §10)", () => {
    // 2023-05-14 → 2026-09-14 adalah 3 tahun 4 bulan, bukan 40 bulan.
    const fields = semuaField(karyawan({ original_start_date: "2023-05-14" }));
    expect(nilai(fields, "Masa Kerja")).toBe("3 tahun 4 bulan");
  });

  it("tidak membaca masa_kerja_* dari view (dua jam, satu kartu)", () => {
    // Nilai view sengaja dibuat salah: kalau halaman membacanya, test ini
    // yang gagal, bukan pengguna yang bingung.
    const fields = semuaField(
      karyawan({
        original_start_date: "2023-05-14",
        masa_kerja_tahun: 99,
        masa_kerja_bulan: 99,
      }),
    );
    expect(nilai(fields, "Masa Kerja")).toBe("3 tahun 4 bulan");
  });

  it("menampilkan bulan untuk promosi yang belum genap setahun", () => {
    // Inti masalahnya: view hanya punya masa_pg_tahun = 0 untuk kasus ini.
    const fields = semuaField(
      karyawan({ tanggal_promosi_pg: "2025-11-14", masa_pg_tahun: 0 }),
    );
    expect(nilai(fields, "Masa Sejak Promosi PG")).toBe("10 bulan");
  });

  it("menyebut 'belum mulai' untuk tanggal di masa depan (data seed kotor)", () => {
    const fields = semuaField(karyawan({ original_start_date: "2027-01-01" }));
    expect(nilai(fields, "Masa Kerja")).toBe("belum mulai");
  });

  it("memakai satu 'hari ini' untuk semua masa di kartu", () => {
    const fields = semuaField(
      karyawan({
        original_start_date: "2021-09-14",
        tanggal_diangkat: "2021-09-14",
        tanggal_promosi_pg: "2021-09-14",
        tanggal_promosi_jg: "2021-09-14",
      }),
    );
    const masa = [
      "Masa Kerja",
      "Masa Sejak Diangkat",
      "Masa Sejak Promosi PG",
      "Masa Sejak Promosi JG",
    ].map((label) => nilai(fields, label));
    expect(new Set(masa).size).toBe(1);
    expect(masa[0]).toBe("5 tahun");
  });

  it("memisahkan kolom Excel berheader kembar", () => {
    const fields = semuaField(
      karyawan({
        keterangan_rangkap_1: "Rangkap Satu",
        keterangan_rangkap_2: "Rangkap Dua",
        tanggal_promosi_pg: "2024-01-01",
        nomor_surat_pg: "SK/PG/001",
        tanggal_promosi_jg: "2024-02-01",
        nomor_surat_jg: "SK/JG/002",
      }),
    );
    expect(nilai(fields, "Keterangan Rangkap 1")).toBe("Rangkap Satu");
    expect(nilai(fields, "Keterangan Rangkap 2")).toBe("Rangkap Dua");
    expect(
      fields.find((field) => field.label === "Tanggal Promosi PG")?.catatan,
    ).toBe("Nomor Surat PG: SK/PG/001");
    expect(
      fields.find((field) => field.label === "Tanggal Promosi JG")?.catatan,
    ).toBe("Nomor Surat JG: SK/JG/002");
  });

  it("menampilkan tanggal dalam bahasa Indonesia tanpa menggeser harinya", () => {
    const fields = semuaField(karyawan({ tanggal_keluar: "2026-03-31" }));
    expect(nilai(fields, "Tanggal Keluar")).toBe("31 Mar 2026");
  });

  it("menyebutkan Karyawan nonaktif yang tanggal keluarnya kosong", () => {
    const fields = semuaField(karyawan({ status: "nonaktif" }));
    const keluar = fields.find((field) => field.label === "Tanggal Keluar");
    expect(keluar?.value).toBe(KOSONG);
    expect(keluar?.catatan).toContain("belum diisi");
  });

  it("tidak pernah mengembalikan nilai kosong berupa string kosong", () => {
    const fields = semuaField(karyawan({ full_name: "   " }));
    expect(fields.every((field) => field.value.trim().length > 0)).toBe(true);
  });

  it("memberi label unik di dalam satu seksi (label dipakai sebagai key React)", () => {
    for (const section of buildEmployeeSections(karyawan(), ASOF)) {
      const labels = section.fields.map((field) => field.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("rantaiUnit", () => {
  it("merangkai jenjang dari atas ke bawah tanpa lubang", () => {
    expect(
      rantaiUnit(
        karyawan({
          direktorat_nama: "Direktorat Contoh",
          divisi_nama: "Divisi Contoh",
          sub_bagian_nama: "Sub Bagian Contoh",
        }),
      ),
    ).toBe("Direktorat Contoh › Divisi Contoh › Sub Bagian Contoh");
  });

  it("memberi tanda kosong untuk Karyawan tanpa Unit Organisasi (Temuan)", () => {
    expect(rantaiUnit(karyawan())).toBe(KOSONG);
  });
});

describe("labelStatus & labelTipeUnit", () => {
  it("memakai istilah CONTEXT.md", () => {
    expect(labelStatus("nonaktif")).toBe("Nonaktif");
    expect(labelStatus("aktif")).toBe("Aktif");
    expect(labelTipeUnit("sub_bagian")).toBe("Sub Bagian");
    expect(labelTipeUnit(null)).toBe(KOSONG);
  });
});

describe("buildPrivateFields (PRD #22)", () => {
  const isi: EmployeePrivate = {
    employee_id: UUID.karyawan,
    date_of_birth: "1980-02-29",
    place_of_birth: "Kota Contoh",
    religion: "Islam",
    marital_status: "Menikah",
    created_at: WAKTU,
    updated_at: WAKTU,
  };

  it("menghitung usia dari tanggal lahir", () => {
    const fields = buildPrivateFields(isi, ASOF);
    expect(nilai(fields, "Tanggal Lahir")).toBe("29 Feb 1980");
    expect(nilai(fields, "Usia")).toBe("46 tahun");
    expect(fields.find((field) => field.label === "Usia")?.turunan).toBe(true);
  });

  it("menampilkan kolom kosong sebagai tanda kosong, bukan error", () => {
    const fields = buildPrivateFields(null, ASOF);
    expect(semuaKosong(fields)).toBe(true);
    expect(nilai(fields, "Agama")).toBe(KOSONG);
  });

  it("membedakan baris terisi dari baris kosong", () => {
    expect(semuaKosong(buildPrivateFields(isi, ASOF))).toBe(false);
  });
});
