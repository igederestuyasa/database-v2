import { describe, expect, it } from "vitest";

import { planSeed, SHEET_NAME } from "@/lib/seed/excelMapping";
import { ringkasSeedPlan } from "@/lib/seed/ringkasan";

import {
  MAKS_UKURAN_FILE,
  barisHasil,
  barisRingkasan,
  bolehJalankan,
  keteranganDefault,
  periksaFile,
  pilihSheet,
} from "./seedWizard";

describe("periksaFile", () => {
  it("menerima .xlsx dan .xlsm, menolak yang lain", () => {
    expect(periksaFile("Demografi.xlsx", 1000)).toBeNull();
    expect(periksaFile("DEMOGRAFI.XLSM", 1000)).toBeNull();
    expect(periksaFile("demografi.csv", 1000)).toMatch(/harus berformat Excel/);
    expect(periksaFile("demografi.xls", 1000)).toMatch(/harus berformat Excel/);
  });

  it("menolak file yang terlalu besar dan menyebut ukurannya", () => {
    expect(periksaFile("a.xlsx", MAKS_UKURAN_FILE)).toBeNull();
    expect(periksaFile("a.xlsx", MAKS_UKURAN_FILE + 1)).toMatch(/terlalu besar/);
  });
});

describe("pilihSheet", () => {
  it("memilih sheet yang didokumentasikan kalau ada", () => {
    expect(pilihSheet(["Lain", SHEET_NAME])).toEqual({ nama: SHEET_NAME, catatan: null });
  });

  it("memakai satu-satunya sheet dengan catatan", () => {
    const hasil = pilihSheet(["Sheet1"]);
    expect(hasil.nama).toBe("Sheet1");
    expect(hasil.catatan).toMatch(/satu-satunya sheet "Sheet1"/);
  });

  it("menyerahkan pilihan ke admin kalau ada beberapa sheet tanpa yang utama", () => {
    const hasil = pilihSheet(["A", "B"]);
    expect(hasil.nama).toBeNull();
    expect(hasil.catatan).toMatch(/Pilih sheet/);
    expect(pilihSheet([]).catatan).toMatch(/tidak punya sheet/);
  });
});

describe("teks", () => {
  it("keterangan bawaan sama dengan CLI", () => {
    expect(keteranganDefault("demografi.xlsx")).toBe("Seed awal dari demografi.xlsx");
  });

  it("barisRingkasan mengikuti urutan dan kata laporan CLI", () => {
    const plan = planSeed([
      ["Judul"],
      [],
      [],
      ["Personnel Number", "Nama", "Business Unit", "Gender", "Age", "Catatan"],
      ["1", "Satu", "BU", "L", 30, "x"],
    ]);
    const baris = barisRingkasan(ringkasSeedPlan(plan));
    expect(baris.map((b) => b.label)).toEqual([
      "Baris data",
      "Kolom dipetakan",
      "Kolom diabaikan (rumus)",
      "Kolom tidak dikenal",
      "Unit Organisasi",
      "Jabatan",
      "Lookup",
      "Karyawan",
      "Data Pribadi Sensitif terisi",
    ]);
    expect(baris[0].nilai).toBe("1 dibaca, 0 kosong dilewati");
    expect(baris[2].nilai).toBe("1: Age");
    expect(baris[3].nilai).toBe("1: Catatan");
    expect(baris[4].nilai).toBe("1 (direktorat 1)");
    expect(baris[6].nilai).toBe("1 (gender 1)");
    expect(baris[7].nilai).toBe("1 (0 nonaktif)");
  });

  it("barisHasil menulis tujuh baris ringkasan akhir", () => {
    const baris = barisHasil({
      batchId: "b1",
      lookups: 2,
      jabatan: 1,
      orgUnits: 3,
      employees: 4,
      dataPribadi: 1,
      revisions: 11,
    });
    expect(baris).toHaveLength(7);
    expect(baris[0]).toEqual({ label: "Batch id", nilai: "b1" });
    expect(baris[5].nilai).toBe("1 baris diisi");
  });
});

describe("bolehJalankan", () => {
  it("hanya kalau tidak ada error, sudah dicentang, dan tidak sedang jalan", () => {
    expect(bolehJalankan({ bisaDijalankan: true, paham: true, sedangJalan: false })).toBe(true);
    expect(bolehJalankan({ bisaDijalankan: false, paham: true, sedangJalan: false })).toBe(false);
    expect(bolehJalankan({ bisaDijalankan: true, paham: false, sedangJalan: false })).toBe(false);
    expect(bolehJalankan({ bisaDijalankan: true, paham: true, sedangJalan: true })).toBe(false);
  });
});
