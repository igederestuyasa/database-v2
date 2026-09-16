import { describe, expect, it } from "vitest";

import { planSeed } from "./excelMapping";
import { baristIssue, hitungPerTipe, ringkasSeedPlan } from "./ringkasan";

function sheet(headers: readonly unknown[], ...rows: readonly unknown[][]): unknown[][] {
  return [["Judul"], [], [], [...headers], ...rows.map((row) => [...row])];
}

const HEADERS = [
  "Personnel Number",
  "Nama",
  "Status",
  "Business Unit",
  "Divisi",
  "Jabatan",
  "Gender",
  "Age",
  "Catatan HC",
  "Tanggal Lahir",
] as const;

const PLAN = planSeed(
  sheet(
    HEADERS,
    ["1", "Satu", "aktif", "BU", "Divisi A", "Staf", "L", 30, "x", "1990-01-01"],
    ["2", "Dua", "nonaktif", "BU", "Divisi A", null, "P", 41, null, null],
    [],
    ["3", "Tiga", "aktif", null, null, "Staf", "L", 25, null, null],
  ),
);

describe("ringkasSeedPlan", () => {
  const r = ringkasSeedPlan(PLAN);

  it("menghitung baris, kolom, dan yang akan dibuat seperti laporan CLI", () => {
    expect(r.baris).toEqual({ dibaca: 4, kosong: 1 });
    expect(r.kolom.dipetakan).toBe(8);
    expect(r.kolom.diabaikan).toEqual(["Age"]);
    expect(r.kolom.tidakDikenal).toEqual(["Catatan HC"]);
    expect(r.akanDibuat.unitOrganisasi).toEqual({
      total: 2,
      perTipe: [
        { tipe: "direktorat", jumlah: 1 },
        { tipe: "divisi", jumlah: 1 },
      ],
    });
    expect(r.akanDibuat.jabatan).toBe(1);
    expect(r.akanDibuat.lookup).toEqual({ total: 2, perTipe: [{ tipe: "gender", jumlah: 2 }] });
    expect(r.akanDibuat.karyawan).toEqual({ total: 3, nonaktif: 1 });
    expect(r.akanDibuat.dataPribadi).toBe(1);
  });

  it("memisahkan peringatan dari error dan menyatakan bisa dijalankan", () => {
    expect(r.error).toEqual([]);
    expect(r.bisaDijalankan).toBe(true);
    const kode = r.peringatan.map((issue) => issue.kode);
    expect(kode).toContain("kolom_tidak_dikenal");
    expect(kode).toContain("karyawan_tanpa_unit");
    expect(kode).toContain("karyawan_tanpa_jabatan");
  });

  it("tidak bisa dijalankan ketika ada error", () => {
    const tanpaNama = ringkasSeedPlan(planSeed(sheet(["Personnel Number"], ["1"])));
    expect(tanpaNama.error.map((issue) => issue.kode)).toContain("kolom_wajib_hilang");
    expect(tanpaNama.bisaDijalankan).toBe(false);
  });
});

describe("helper", () => {
  it("hitungPerTipe menjaga urutan kemunculan pertama", () => {
    expect(hitungPerTipe(["b", "a", "b"], (x) => x)).toEqual([
      { tipe: "b", jumlah: 2 },
      { tipe: "a", jumlah: 1 },
    ]);
  });

  it("baristIssue menulis baris atau berkas persis seperti CLI", () => {
    expect(baristIssue({ level: "peringatan", kode: "k", pesan: "p", baris: 7 })).toBe("[k] baris 7: p");
    expect(baristIssue({ level: "error", kode: "k", pesan: "p" })).toBe("[k] berkas: p");
  });
});
