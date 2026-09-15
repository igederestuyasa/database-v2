/**
 * Yang diputuskan Form Karyawan sebelum apa pun sampai ke database.
 *
 * Tidak ada jsdom dan tidak boleh menambah dependency (ADR-005 §1), jadi yang
 * diuji di sini adalah bagian murninya — dan justru bagian itulah yang salahnya
 * paling mahal, karena semuanya gagal dalam diam:
 *
 *   * satu kolom yang lupa dipetakan di `nilaiAwalEmployeeForm()` tampil
 *     kosong di layar, dan karena form mengirim seluruh isinya saat Simpan,
 *     kolom itu benar-benar dikosongkan di database;
 *   * `payloadTambahKaryawan()` yang lupa `status`/`tanggal_keluar` membuat
 *     Karyawan baru lahir dengan pasangan status yang tidak konsisten;
 *   * opsi nonaktif yang tetap bisa dipilih menempatkan orang baru ke unit
 *     yang sudah ditutup, dan halaman Perlu Dibereskan tidak menganggapnya
 *     Temuan karena referensinya memang ada;
 *   * `""` dari sebuah `<input>` yang tidak menjadi `null` menyimpan string
 *     kosong ke kolom yang seharusnya NULL.
 *
 * Fixture saja — tidak pernah data Karyawan sungguhan (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";

import { EMPLOYEES } from "@/fixtures";
import type { EntityOption } from "@/components/shared/entityOptions";
import { EMPLOYEES_COLUMNS } from "@/lib/schema/columns.generated";
import type { Employee } from "@/lib/types/db";
import {
  employeeCreateSchema,
  employeeDeactivateSchema,
  employeeReactivateSchema,
} from "@/lib/validation/employee";

import {
  EMPLOYEE_FORM_FIELDS,
  nilaiAwalEmployeeForm,
  payloadTambahKaryawan,
  pilihanYangBolehDipilih,
  type EmployeeFormValues,
} from "./EmployeeForm";

const LENGKAP: Employee = EMPLOYEES[0];
const KOSONGAN: Employee = EMPLOYEES[1];

describe("EMPLOYEE_FORM_FIELDS", () => {
  it("hanya berisi kolom yang benar-benar ada di tabel employees", () => {
    const columns = EMPLOYEES_COLUMNS as readonly string[];
    const asing = EMPLOYEE_FORM_FIELDS.filter((name) => !columns.includes(name));
    expect(asing).toEqual([]);
  });

  it("tidak memuat status maupun tanggal_keluar — keduanya milik dialog status", () => {
    const names = EMPLOYEE_FORM_FIELDS as readonly string[];
    expect(names).not.toContain("status");
    expect(names).not.toContain("tanggal_keluar");
  });

  it("tidak menggabungkan kolom yang header Excel-nya kembar", () => {
    const names = EMPLOYEE_FORM_FIELDS as readonly string[];
    // Empat kolom, empat isian: menggabungkan salah satu pasangan membuang data.
    expect(names).toContain("keterangan_rangkap_1");
    expect(names).toContain("keterangan_rangkap_2");
    expect(names).toContain("nomor_surat_pg");
    expect(names).toContain("nomor_surat_jg");
  });

  it("memetakan setiap kolom employees yang boleh diisi manusia", () => {
    // Kolom yang memang bukan urusan form: kunci teknis, jejak waktu, dan
    // pasangan status yang diatur EmployeeStatusDialog.
    const bukanUrusanForm = new Set([
      "id",
      "created_at",
      "updated_at",
      "status",
      "tanggal_keluar",
    ]);
    const tertinggal = (EMPLOYEES_COLUMNS as readonly string[]).filter(
      (column) =>
        !bukanUrusanForm.has(column) &&
        !(EMPLOYEE_FORM_FIELDS as readonly string[]).includes(column),
    );
    expect(tertinggal).toEqual([]);
  });
});

describe("nilaiAwalEmployeeForm", () => {
  it("memakai setiap nilai baris yang ada, tanpa ada yang tertinggal", () => {
    const values = nilaiAwalEmployeeForm(LENGKAP);
    for (const name of EMPLOYEE_FORM_FIELDS) {
      // Kolom yang lupa dipetakan akan berisi `""`/`null` di sini padahal
      // barisnya punya nilai — dan itulah kolom yang akan terhapus saat Simpan.
      expect(values[name] ?? "").toBe(LENGKAP[name] ?? "");
    }
    expect(values.personnel_number).toBe(LENGKAP.personnel_number);
    expect(values.nomor_surat_jg).toBe(LENGKAP.nomor_surat_jg);
    expect(values.org_unit_id).toBe(LENGKAP.org_unit_id);
  });

  it("mengubah NULL menjadi teks kosong untuk kolom teks dan tanggal", () => {
    const values = nilaiAwalEmployeeForm(KOSONGAN);
    expect(KOSONGAN.nip).toBeNull();
    expect(values.nip).toBe("");
    expect(values.tanggal_promosi_pg).toBe("");
    expect(values.keterangan_rangkap_2).toBe("");
  });

  it("membiarkan FK kosong tetap null, bukan teks kosong", () => {
    const values = nilaiAwalEmployeeForm(KOSONGAN);
    expect(KOSONGAN.org_unit_id).toBeNull();
    // EntityPicker bekerja dengan `string | null`; `""` akan tampil sebagai
    // pilihan yang tidak ada di daftar.
    expect(values.org_unit_id).toBeNull();
    expect(values.jabatan_id).toBeNull();
  });

  it("Karyawan baru mulai dengan semua kolom kosong", () => {
    const values = nilaiAwalEmployeeForm();
    for (const name of EMPLOYEE_FORM_FIELDS) {
      expect(values[name] === "" || values[name] === null).toBe(true);
    }
  });

  it("tidak membawa status atau tanggal keluar ke dalam form", () => {
    const values = nilaiAwalEmployeeForm(EMPLOYEES[2]);
    expect(EMPLOYEES[2].status).toBe("nonaktif");
    expect(EMPLOYEES[2].tanggal_keluar).not.toBeNull();
    expect(Object.keys(values)).not.toContain("status");
    expect(Object.keys(values)).not.toContain("tanggal_keluar");
  });
});

describe("payloadTambahKaryawan", () => {
  it("selalu menambahkan status aktif dan tanggal keluar kosong", () => {
    const payload = payloadTambahKaryawan(nilaiAwalEmployeeForm(LENGKAP));
    expect(payload.status).toBe("aktif");
    expect(payload.tanggal_keluar).toBeNull();
  });

  it("tidak mengubah satu pun isian yang datang dari layar", () => {
    const values = nilaiAwalEmployeeForm(LENGKAP);
    const payload = payloadTambahKaryawan(values);
    for (const name of EMPLOYEE_FORM_FIELDS) {
      expect(payload[name]).toEqual(values[name]);
    }
  });
});

describe("pilihanYangBolehDipilih", () => {
  const options: EntityOption[] = [
    { id: "a", label: "Aktif", status: "aktif" },
    { id: "n", label: "Sudah ditutup", status: "nonaktif" },
    { id: "t", label: "Tanpa status" },
  ];

  it("mematikan opsi nonaktif", () => {
    const hasil = pilihanYangBolehDipilih(options, null);
    expect(hasil.find((o) => o.id === "n")?.disabled).toBe(true);
  });

  it("membiarkan opsi nonaktif yang memang sedang terpakai tetap bisa dipilih", () => {
    // Data seed kotor: ada Karyawan yang menunjuk unit yang kemudian
    // dinonaktifkan. Kalau opsinya mati, nilainya tidak bisa dipertahankan.
    const hasil = pilihanYangBolehDipilih(options, "n");
    expect(hasil.find((o) => o.id === "n")?.disabled).toBeUndefined();
  });

  it("tidak menyentuh opsi aktif maupun yang tidak berstatus", () => {
    const hasil = pilihanYangBolehDipilih(options, null);
    expect(hasil.find((o) => o.id === "a")?.disabled).toBeUndefined();
    expect(hasil.find((o) => o.id === "t")?.disabled).toBeUndefined();
  });

  it("tidak pernah menghilangkan satu pun opsi", () => {
    expect(pilihanYangBolehDipilih(options, null)).toHaveLength(options.length);
  });
});

/**
 * Bagaimana isian layar berubah menjadi nilai yang ditulis.
 *
 * Schema-nya beku dan diuji sendiri; yang dipastikan di sini adalah bentuk
 * yang dikirim form ini benar-benar cocok dengannya — termasuk kasus yang
 * paling gampang salah: kotak yang dikosongkan orang harus menjadi `null`,
 * bukan `""`, karena `""` adalah nilai yang sah untuk kolom teks dan akan
 * tersimpan apa adanya.
 */
describe("isian layar → muatan Server Action", () => {
  const kosong = (): EmployeeFormValues => nilaiAwalEmployeeForm();

  it("kolom yang dikosongkan menjadi null, bukan teks kosong", () => {
    const parsed = employeeCreateSchema.parse(
      payloadTambahKaryawan({
        ...kosong(),
        personnel_number: "TEST-9001",
        full_name: "Contoh Kosong",
      }),
    );
    expect(parsed.nip).toBeNull();
    expect(parsed.jurusan).toBeNull();
    expect(parsed.original_start_date).toBeNull();
    expect(parsed.keterangan_rangkap_1).toBeNull();
    expect(parsed.nomor_surat_jg).toBeNull();
  });

  it("memangkas spasi, supaya satu nama tidak menjadi dua ejaan", () => {
    const parsed = employeeCreateSchema.parse(
      payloadTambahKaryawan({
        ...kosong(),
        personnel_number: "  TEST-9002  ",
        full_name: "  Contoh Spasi  ",
      }),
    );
    expect(parsed.personnel_number).toBe("TEST-9002");
    expect(parsed.full_name).toBe("Contoh Spasi");
  });

  it("menolak Personnel Number kosong — itu kunci bisnisnya", () => {
    const hasil = employeeCreateSchema.safeParse(
      payloadTambahKaryawan({ ...kosong(), full_name: "Tanpa Nomor" }),
    );
    expect(hasil.success).toBe(false);
  });

  it("menolak tanggal yang tidak mungkin ada di kalender", () => {
    // `<input type="date">` tidak bisa memproduksinya, tetapi nilai yang
    // ditempel bisa.
    const hasil = employeeCreateSchema.safeParse(
      payloadTambahKaryawan({
        ...kosong(),
        personnel_number: "TEST-9003",
        full_name: "Contoh Tanggal",
        original_start_date: "2025-02-30",
      }),
    );
    expect(hasil.success).toBe(false);
  });

  it("menolak nilai picker yang bukan uuid", () => {
    // Tidak bisa terjadi lewat EntityPicker — yang justru dijaga: nilai
    // referensi selalu id dari daftar, tidak pernah teks yang diketik.
    const hasil = employeeCreateSchema.safeParse(
      payloadTambahKaryawan({
        ...kosong(),
        personnel_number: "TEST-9004",
        full_name: "Contoh Picker",
        org_unit_id: "Divisi QHSSE",
      }),
    );
    expect(hasil.success).toBe(false);
  });
});

describe("muatan dialog status", () => {
  it("menonaktifkan wajib membawa tanggal keluar (PRD #5)", () => {
    expect(
      employeeDeactivateSchema.safeParse({
        id: LENGKAP.id,
        tanggal_keluar: "",
        keterangan: null,
      }).success,
    ).toBe(false);

    expect(
      employeeDeactivateSchema.safeParse({
        id: LENGKAP.id,
        tanggal_keluar: "2026-03-31",
        keterangan: null,
      }).success,
    ).toBe(true);
  });

  it("mengaktifkan kembali cukup dengan id-nya", () => {
    const hasil = employeeReactivateSchema.safeParse({
      id: LENGKAP.id,
      keterangan: LENGKAP.keterangan,
    });
    expect(hasil.success).toBe(true);
  });
});
