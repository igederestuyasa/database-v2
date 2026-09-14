/**
 * Table-driven tests for `lib/cleaning/normalize.ts`.
 *
 * ARCHITECTURE.md §7 lists this module as one of three worth testing, because
 * its bugs are silent: a fold that stops folding does not throw, it just stops
 * reporting Temuan, and "Perlu Dibereskan" quietly reads empty while the
 * database is still full of duplicate spellings.
 *
 * Tables, not prose, so that adding a case someone found in the real Excel is
 * one line rather than one more `it()`.
 *
 * DUMMY DATA ONLY — invented Unit Organisasi and Jabatan names (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";

import {
  explainSimilarity,
  foldName,
  isSimilarName,
  normalizeName,
  similarityKey,
  type NameDifference,
} from "./normalize";

describe("normalizeName", () => {
  const CASES: Array<[keterangan: string, masukan: string, hasil: string]> = [
    ["apa adanya", "Divisi Contoh", "divisi contoh"],
    ["huruf besar semua", "DIVISI CONTOH", "divisi contoh"],
    ["huruf kecil semua", "divisi contoh", "divisi contoh"],
    ["spasi ganda", "Divisi   Contoh", "divisi contoh"],
    ["spasi di ujung", "  Divisi Contoh  ", "divisi contoh"],
    ["tab dan baris baru", "Divisi\tContoh\nSatu", "divisi contoh satu"],
    ["no-break space", "Divisi Contoh", "divisi contoh"],
    ["zero-width space", "Divisi​Contoh", "divisicontoh"],
    ["ampersand", "Divisi K3 & Lingkungan", "divisi k3 dan lingkungan"],
    ["kata dan", "Divisi K3 dan Lingkungan", "divisi k3 dan lingkungan"],
    ["ampersand rapat", "R&D", "r dan d"],
    ["ampersand lebar", "Divisi K3 ＆ Lingkungan", "divisi k3 dan lingkungan"],
    ["tanda hubung", "Sub-Bagian Contoh", "sub bagian contoh"],
    ["titik di akhir", "Sub Bagian Contoh.", "sub bagian contoh"],
    ["kurung", "PT Contoh (Persero)", "pt contoh persero"],
    ["garis miring", "Bagian Contoh/Satu", "bagian contoh satu"],
    ["tanda kutip lengkung", "Bagian “Contoh”", "bagian contoh"],
    ["en dash", "Pratama III – 13", "pratama iii 13"],
    ["aksen", "Café Contoh", "cafe contoh"],
    ["aksen terurai (NFD)", "Café Contoh", "cafe contoh"],
    ["angka dipertahankan", "Proyek Contoh 2026", "proyek contoh 2026"],
    ["kosong", "", ""],
    ["hanya spasi", "   ", ""],
    ["hanya tanda baca", "---", ""],
  ];

  it.each(CASES)("%s", (_keterangan, masukan, hasil) => {
    expect(normalizeName(masukan)).toBe(hasil);
  });

  it.each([null, undefined])("aman untuk nilai kosong: %s", (masukan) => {
    expect(normalizeName(masukan)).toBe("");
  });

  it("idempoten — melipat hasil lipatan tidak mengubah apa pun", () => {
    for (const [, masukan] of CASES) {
      expect(normalizeName(normalizeName(masukan))).toBe(normalizeName(masukan));
    }
  });
});

describe("similarityKey", () => {
  const CASES: Array<[keterangan: string, masukan: string, hasil: string]> = [
    ["spasi dibuang", "Sub Bagian Contoh", "subbagiancontoh"],
    ["tanpa spasi", "SubBagianContoh", "subbagiancontoh"],
    ["campur", "SUB bagian  Contoh", "subbagiancontoh"],
    ["ampersand", "Divisi K3 & Lingkungan", "divisik3danlingkungan"],
    ["kosong", "   ", ""],
  ];

  it.each(CASES)("%s", (_keterangan, masukan, hasil) => {
    expect(similarityKey(masukan)).toBe(hasil);
  });
});

describe("isSimilarName", () => {
  const MIRIP: Array<[string, string]> = [
    // ROADMAP Fase 3 exit criterion, verbatim.
    ["Divisi QHSSE", "DIVISI QHSSE"],
    ["Divisi Contoh", "divisi contoh"],
    ["Divisi Contoh", "  Divisi   Contoh "],
    ["Divisi K3 & Lingkungan", "Divisi K3 dan Lingkungan"],
    ["Sub Bagian Contoh", "SubBagian Contoh"],
    ["Sub-Bagian Contoh", "Sub Bagian Contoh"],
    ["Bagian Contoh (Persero)", "Bagian Contoh Persero"],
    ["Café Contoh", "Cafe Contoh"],
  ];

  const BEDA: Array<[string, string]> = [
    // Typo, bukan varian penulisan: sengaja TIDAK dilaporkan (lihat header
    // normalize.ts — tidak ada fuzzy matching di HC Core).
    ["Divisi QHSSE", "Divisi QHSE"],
    ["Divisi Contoh", "Divisi Contoh Dua"],
    ["Bagian Contoh", "Bagian Conto"],
    ["Proyek Contoh 2026", "Proyek Contoh 2027"],
    // Nama kosong tidak pernah mirip dengan apa pun, termasuk kosong lain.
    ["", ""],
    ["   ", "-"],
  ];

  it.each(MIRIP)("mirip: %s ≈ %s", (a, b) => {
    expect(isSimilarName(a, b)).toBe(true);
    expect(isSimilarName(b, a)).toBe(true);
  });

  it.each(BEDA)("beda: %s ≠ %s", (a, b) => {
    expect(isSimilarName(a, b)).toBe(false);
    expect(isSimilarName(b, a)).toBe(false);
  });
});

describe("explainSimilarity", () => {
  const CASES: Array<[a: string, b: string, perbedaan: NameDifference[]]> = [
    ["Divisi QHSSE", "DIVISI QHSSE", ["kapitalisasi"]],
    ["Divisi Contoh", "Divisi contoh", ["kapitalisasi"]],
    ["Divisi Contoh", "Divisi  Contoh", ["spasi"]],
    ["Divisi Contoh", "Divisi Contoh ", ["spasi"]],
    ["Sub Bagian Contoh", "SubBagian Contoh", ["spasi"]],
    ["Sub-Bagian Contoh", "Sub Bagian Contoh", ["tanda_baca"]],
    ["Bagian Contoh.", "Bagian Contoh", ["tanda_baca"]],
    ["Divisi K3 & Lingkungan", "Divisi K3 dan Lingkungan", ["ampersand"]],
    ["Café Contoh", "Cafe Contoh", ["aksen"]],
    // Beberapa perbedaan sekaligus, dilaporkan urut.
    ["DIVISI-CONTOH", "Divisi Contoh", ["kapitalisasi", "tanda_baca"]],
    ["DIVISI K3 & LINGKUNGAN", "Divisi K3 dan Lingkungan", ["kapitalisasi", "ampersand"]],
    // Sama persis: tidak ada yang perlu dijelaskan.
    ["Divisi Contoh", "Divisi Contoh", []],
    // Tidak mirip sama sekali: bukan tugas fungsi ini (lihat isSimilarName).
    ["Divisi Contoh", "Jabatan Contoh", []],
    // Campuran yang tidak dimiliki satu dimensi pun: spasi di sekitar tanda
    // hubung yang ADA di kedua nama. Dibiarkan kosong, bukan ditebak.
    ["Pratama III - 13", "Pratama III-13", []],
  ];

  it.each(CASES)("%s vs %s", (a, b, perbedaan) => {
    expect(explainSimilarity(a, b)).toEqual(perbedaan);
  });

  it("simetris — urutan argumen tidak mengubah jawaban", () => {
    for (const [a, b, perbedaan] of CASES) {
      expect(explainSimilarity(b, a)).toEqual(perbedaan);
    }
  });

  it("tidak menuduh 'spasi' hanya karena '&' diganti ' dan '", () => {
    // "&" → " dan " menyisipkan spasi sendiri; kalau probe spasi memakai hasil
    // lipatan itu, SETIAP pasangan ampersand ikut dilaporkan beda spasi.
    expect(explainSimilarity("A & B", "A dan B")).toEqual(["ampersand"]);
  });

  it("tidak menuduh 'spasi' hanya karena tanda baca diganti spasi", () => {
    // Sama alasannya: "-" → " " juga menyisipkan spasi sendiri.
    expect(explainSimilarity("A-B", "A B")).toEqual(["tanda_baca"]);
    expect(explainSimilarity("K3/Lingkungan", "K3 Lingkungan")).toEqual([
      "tanda_baca",
    ]);
    expect(explainSimilarity("Proyek 1", "Proyek-1")).toEqual(["tanda_baca"]);
  });
});

describe("foldName", () => {
  it("mempertahankan spasi apa adanya pada mode keep", () => {
    expect(foldName("Divisi   Contoh ", { whitespace: "keep" })).toBe(
      "divisi   contoh ",
    );
  });

  it("mematikan satu lipatan saja, sisanya tetap jalan", () => {
    expect(foldName("DIVISI-CONTOH", { foldCase: false })).toBe("DIVISI CONTOH");
    expect(foldName("DIVISI-CONTOH", { ignorePunctuation: false })).toBe(
      "divisi-contoh",
    );
    expect(foldName("A & B", { unifyAmpersand: false })).toBe("a b");
    expect(foldName("Café", { stripAccents: false })).toBe("café");
  });
});
