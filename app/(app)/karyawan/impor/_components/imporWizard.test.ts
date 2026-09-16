import { describe, expect, it } from "vitest";

import { planSeed, SHEET_NAME } from "@/lib/seed/excelMapping";
import { ringkasSeedPlan } from "@/lib/seed/ringkasan";

import {
  MAKS_UKURAN_FILE,
  barisHasil,
  hitungKecocokan,
  barisRingkasan,
  bolehJalankan,
  keteranganDefault,
  periksaFile,
  pilihSheet,
} from "./imporWizard";

describe("periksaFile", () => {
  it("menerima .xlsx dan .xlsm, menolak yang lain", () => {
    expect(periksaFile("Demografi.xlsx", 1000)).toBeNull();
    expect(periksaFile("DEMOGRAFI.XLSM", 1000)).toBeNull();
    expect(periksaFile("demografi.csv", 1000)).toMatch(/harus berformat Excel/);
    expect(periksaFile("demografi.xls", 1000)).toMatch(/harus berformat Excel/);
  });

  it("menolak file yang terlalu besar dan menyebut ukurannya", () => {
    expect(periksaFile("a.xlsx", MAKS_UKURAN_FILE)).toBeNull();
    expect(periksaFile("a.xlsx", MAKS_UKURAN_FILE + 1)).toMatch(
      /terlalu besar/,
    );
  });
});

describe("pilihSheet", () => {
  it("memilih sheet yang didokumentasikan kalau ada", () => {
    expect(pilihSheet(["Lain", SHEET_NAME])).toEqual({
      nama: SHEET_NAME,
      catatan: null,
    });
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
  it("keterangan bawaan menyebut nama filenya", () => {
    expect(keteranganDefault("demografi.xlsx")).toBe(
      "Impor dari demografi.xlsx",
    );
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

  it("barisHasil menaruh ketiga angka Karyawan lebih dulu", () => {
    const baris = barisHasil({
      batchId: "b1",
      karyawanBaru: 4,
      karyawanDiperbarui: 2,
      karyawanTetap: 30,
      lookupsBaru: 2,
      jabatanBaru: 1,
      orgUnitsBaru: 3,
      dataPribadi: 1,
      revisions: 11,
    });
    expect(baris.slice(0, 3).map((b) => b.label)).toEqual([
      "Karyawan baru",
      "Karyawan diperbarui",
      "Karyawan tidak berubah",
    ]);
    expect(baris.slice(0, 3).map((b) => b.nilai)).toEqual(["4", "2", "30"]);
    expect(baris.at(-1)).toEqual({ label: "Batch id", nilai: "b1" });
  });
});

describe("hitungKecocokan", () => {
  const plan = planSeed([
    ["Judul"],
    [],
    [],
    ["Personnel Number", "Nama"],
    ["1", "Satu"],
    ["2", "Dua"],
    ["3", "Tiga"],
  ]);

  it("memisahkan yang sudah terdaftar dari yang benar-benar baru", () => {
    expect(hitungKecocokan(plan, new Set(["2"]))).toEqual({
      baru: 2,
      sudahAda: 1,
    });
  });

  it("database kosong berarti semuanya baru", () => {
    expect(hitungKecocokan(plan, new Set())).toEqual({ baru: 3, sudahAda: 0 });
  });

  it("Personnel Number yang ada di database tapi tidak di file tidak dihitung", () => {
    // Impor tidak pernah menyentuh orang yang tidak ada di filenya; angka di
    // pratinjau harus mencerminkan itu, bukan ukuran database.
    expect(hitungKecocokan(plan, new Set(["1", "2", "3", "999"]))).toEqual({
      baru: 0,
      sudahAda: 3,
    });
  });
});

describe("bolehJalankan", () => {
  it("hanya kalau tidak ada error, sudah dicentang, dan tidak sedang jalan", () => {
    expect(
      bolehJalankan({ bisaDijalankan: true, paham: true, sedangJalan: false }),
    ).toBe(true);
    expect(
      bolehJalankan({ bisaDijalankan: false, paham: true, sedangJalan: false }),
    ).toBe(false);
    expect(
      bolehJalankan({ bisaDijalankan: true, paham: false, sedangJalan: false }),
    ).toBe(false);
    expect(
      bolehJalankan({ bisaDijalankan: true, paham: true, sedangJalan: true }),
    ).toBe(false);
  });
});
