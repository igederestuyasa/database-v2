/**
 * scripts/make-dummy-xlsx.ts — a synthetic "Demografi Karyawan - Posisi".
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The real workbook is not in this environment and must never be: it is ~1.500
 * people's personal data under UU PDP (PRD §8), and CLAUDE.md forbids real
 * employee data in the repo, in fixtures and in tests. But a Seed that has
 * never been run is not a Seed that works. So this script builds a workbook
 * that matches the documented layout — same sheet name, same header row, same
 * duplicated headers, same formula columns — filled with invented people, and
 * `scripts/seed-from-excel.ts` is then exercised end to end against it.
 *
 * DUMMY DATA ONLY. Every name here is a joke name ("Budi Contoh"), every
 * Personnel Number is in a 9xxxxxxx range no real payroll uses, and every unit
 * and jabatan is invented. Nothing in this file came from PT Hutama Karya.
 *
 * DELIBERATELY DIRTY
 * ---------------------------------------------------------------------------
 * The output is *messy on purpose*, in the exact ways the source file is known
 * to be messy (PRD #11): "Divisi QHSSE" / "DIVISI QHSSE" / "Divisi QHSSE ",
 * "dan" against "&", doubled spaces, a Sub Bagian equal to its Bagian, a Sub
 * Bagian that differs from its Bagian only in case, a Karyawan with no unit, a
 * Karyawan with no Jabatan, `#N/A` in the two VLOOKUP columns, dates written
 * both as Excel serials and as `dd/mm/yyyy` text, blank trailing rows, and one
 * column nobody recognises. A clean fixture would prove nothing: the Seed's job
 * is to let the dirt land so the "Perlu Dibereskan" page has something real to
 * find (ADR-002).
 *
 * Deterministic: same `--seed`, same workbook, byte for byte.
 *
 * Usage:
 *   npx tsx scripts/make-dummy-xlsx.ts [--out <file.xlsx>] [--rows <n>] [--seed <n>]
 */
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";

import { HEADER_ROW, SHEET_NAME } from "./lib/excelMapping";

/**
 * The header row, in sheet order, exactly as the layout is documented.
 *
 * Note the two repeated headers — `No Surat` twice and `Keterangan Rangkap`
 * twice. They are the point of several tests: the first is PG / slot 1, the
 * second is JG / slot 2, and they must never be merged (CLAUDE.md).
 */
export const DUMMY_HEADERS: readonly string[] = [
  "No", // formula
  "Personnel Number",
  "NIP",
  "Nama",
  "Business Unit",
  "Divisi",
  "Bagian",
  "Sub Bagian",
  "Jabatan",
  "Masa Jabatan", // formula
  "Band Jabatan",
  "Kategori Penempatan",
  "Kategori Fungsi",
  "Gender",
  "Tempat Lahir",
  "Tanggal Lahir",
  "Age", // formula
  "Range", // formula
  "Gen", // formula
  "Agama",
  "Status Pernikahan",
  "Work Contract",
  "Legal Entity",
  "Klasifikasi Rekrutmen",
  "Original Start Date",
  "Masa Kerja", // formula
  "Tanggal Diangkat",
  "Masa Sejak Diangkat", // formula
  "Person Grade",
  "Tanggal Promosi PG",
  "Masa PG", // formula
  "No Surat", // -> nomor_surat_pg
  "Keterangan Naik PG", // formula
  "Job Grade",
  "Tanggal Promosi JG",
  "Masa JG", // formula
  "No Surat", // -> nomor_surat_jg
  "Keterangan Naik JG", // formula
  "PG-JG", // formula
  "BoD Range",
  "Jurusan", // VLOOKUP in the source file
  "Teknik/Non Teknik", // VLOOKUP in the source file
  "Keterangan PJ/PLT",
  "Keterangan Rangkap", // -> keterangan_rangkap_1
  "Keterangan Rangkap", // -> keterangan_rangkap_2
  "Keterangan",
  "Tanggal Keluar",
  "Status",
  "Catatan HC", // nothing maps this — the Seed must report it, not guess
];

/** The 12 derived columns the Seed ignores (CLAUDE.md). */
export const DUMMY_FORMULA_HEADERS: readonly string[] = [
  "No",
  "Masa Jabatan",
  "Age",
  "Range",
  "Gen",
  "Masa Kerja",
  "Masa Sejak Diangkat",
  "Masa PG",
  "Keterangan Naik PG",
  "Masa JG",
  "Keterangan Naik JG",
  "PG-JG",
];

// ---------------------------------------------------------------------------
// Invented people
// ---------------------------------------------------------------------------

const NAMA_DEPAN = [
  "Budi", "Siti", "Agus", "Dewi", "Rahmat", "Putri", "Joko", "Ayu",
  "Bayu", "Intan", "Hendra", "Lestari", "Fajar", "Maya", "Rizky", "Nadia",
];

const NAMA_BELAKANG = [
  "Contoh", "Misal", "Percobaan", "Sampel", "Uji", "Tiruan", "Fiktif", "Dummy",
];

const TEMPAT_LAHIR = [
  "Kota Contoh", "Kota Misal", "Kabupaten Sampel", "Kota Uji", "Kota Tiruan",
];

/**
 * Units, written the way a spreadsheet maintained by hand is written.
 *
 * The three QHSSE spellings and the two "Keuangan dan/& Akuntansi" spellings
 * are the pair PRD #11 names by example and ROADMAP Fase 3 demos.
 */
const DIVISI_VARIAN = [
  "Divisi QHSSE",
  "DIVISI QHSSE",
  "Divisi QHSSE ", // trailing space — trim makes this the first one again
  "Divisi Keuangan dan Akuntansi",
  "Divisi Keuangan & Akuntansi",
  "Divisi Human Capital",
];

const BAGIAN_VARIAN = [
  "Bagian Akuntansi",
  "Bagian  Akuntansi", // doubled space
  "Bagian Pengembangan SDM",
  "Proyek Tol Contoh Seksi 1", // -> tipe 'proyek'
  "Proyek Gedung Misal", // -> tipe 'proyek'
  "Bagian K3L",
];

const JABATAN_VARIAN = [
  "Staf Muda",
  "staf muda", // case variant
  "Staf  Madya", // doubled space
  "Manajer Bagian",
  "Kepala Proyek",
  "Analis Utama",
];

const BUSINESS_UNIT = ["Direktorat Operasi Contoh", "Direktorat Keuangan Misal"];

const LOOKUP_VARIAN: Record<string, readonly string[]> = {
  gender: ["Laki-laki", "Laki-Laki", "Perempuan"],
  band_jabatan: ["Band IV", "band iv", "Band V"],
  kategori_penempatan: ["Kantor Pusat", "Proyek"],
  kategori_fungsi: ["Operasi", "Penunjang"],
  work_contract: ["Tetap", "TETAP", "PKWT"],
  legal_entity: ["PT Contoh Karya", "PT Contoh Karya "],
  klasifikasi_rekrutmen: ["Fresh Graduate", "Professional Hire"],
  person_grade: ["Pratama III - 13", "Pratama II - 12", "Madya I - 9"],
  job_grade: ["JG 13", "JG 12", "JG 9"],
  bod_range: ["BoD - 2", "BoD - 3"],
};

const AGAMA = ["Islam", "Kristen", "Katolik", "Hindu", "Buddha"];
const STATUS_NIKAH = ["Menikah", "Belum Menikah", "menikah"];
const JURUSAN = ["Teknik Sipil", "Akuntansi", "#N/A", "Manajemen"];
const TEKNIK = ["Teknik", "Non Teknik", "#N/A"];

/** Deterministic PRNG (mulberry32) — no dependency, same seed same file. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

/** Days from 1899-12-30, i.e. the Excel serial of a calendar date. */
function serialOf(year: number, month: number, day: number): number {
  const utc = Date.UTC(year, month - 1, day);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((utc - epoch) / 86_400_000);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `dd/mm/yyyy`, the way a date typed into a text cell arrives. */
function dayFirstText(year: number, month: number, day: number): string {
  return `${pad(day, 2)}/${pad(month, 2)}/${year}`;
}

export type DummyWorkbookOptions = {
  /** Karyawan rows to invent. Default 60. */
  rows?: number;
  /** PRNG seed. Same seed, same workbook. Default 20260915. */
  seed?: number;
};

/**
 * The sheet as an array of arrays: three title rows, the header on row 4, then
 * the data — the shape `planSeed()` consumes.
 */
export function buildDummyRows(options: DummyWorkbookOptions = {}): unknown[][] {
  const rowCount = options.rows ?? 60;
  const random = makeRandom(options.seed ?? 20_260_915);

  const rows: unknown[][] = [
    ["PT CONTOH KARYA (PERSERO)"],
    ["Demografi Karyawan - Posisi (DATA DUMMY, BUKAN DATA SUNGGUHAN)"],
    [],
  ];
  while (rows.length < HEADER_ROW - 1) rows.push([]);
  rows.push([...DUMMY_HEADERS]);

  for (let i = 0; i < rowCount; i += 1) {
    const nomor = i + 1;
    const personnelNumber = 90_000_001 + i;
    const nama = `${pick(random, NAMA_DEPAN)} ${pick(random, NAMA_BELAKANG)}`;

    const businessUnit = pick(random, BUSINESS_UNIT);
    const divisi = pick(random, DIVISI_VARIAN);
    let bagian: string | null = pick(random, BAGIAN_VARIAN);
    let subBagian: string | null = null;

    // Every fourth row gets a Sub Bagian. Two shapes on purpose:
    //   * identical to its Bagian  -> planSeed must NOT create a child node;
    //   * the same but upper-cased -> a node IS created, and the Bereskan page
    //     reports it (PRD #11). The Seed does not decide that one.
    if (i % 4 === 0) subBagian = `Sub ${bagian}`;
    if (i % 12 === 0) subBagian = bagian;
    if (i % 20 === 7) subBagian = bagian.toUpperCase();

    // One row without a Bagian, one without any unit at all, one without a
    // Jabatan: all three are Temuan the Bereskan page must have to find.
    if (i === 3) {
      bagian = null;
      subBagian = null;
    }
    const tanpaUnit = i === 5;
    const tanpaJabatan = i === 6;

    const lahir = { y: 1968 + (i % 32), m: 1 + (i % 12), d: 1 + (i % 28) };
    const masuk = { y: 1995 + (i % 28), m: 1 + ((i * 5) % 12), d: 1 + ((i * 7) % 28) };
    const diangkat = { y: masuk.y + 1, m: masuk.m, d: masuk.d };
    const promosiPg = { y: 2018 + (i % 7), m: 1 + ((i * 3) % 12), d: 1 + (i % 28) };
    const promosiJg = { y: 2019 + (i % 6), m: 1 + ((i * 2) % 12), d: 1 + ((i + 3) % 28) };

    // Half the date cells are real date cells (serial numbers), half were
    // typed into text-formatted cells. Both shapes exist in the source file and
    // both must survive the mapping.
    const asText = i % 2 === 1;
    const tanggal = (p: { y: number; m: number; d: number }): number | string =>
      asText ? dayFirstText(p.y, p.m, p.d) : serialOf(p.y, p.m, p.d);

    const keluar = i % 17 === 4 ? { y: 2025, m: 6, d: 30 } : null;
    // One of the leavers is marked nonaktif; the other keeps a blank Status, so
    // the Seed reports "punya Tanggal Keluar tapi aktif" instead of guessing.
    const status = keluar && i % 34 === 4 ? "Nonaktif" : "";

    const row: unknown[] = [
      nomor, // No (formula)
      personnelNumber,
      `D${pad(100_000 + i, 6)}`,
      nama,
      tanpaUnit ? "" : businessUnit,
      tanpaUnit ? "" : divisi,
      tanpaUnit ? "" : (bagian ?? ""),
      tanpaUnit ? "" : (subBagian ?? ""),
      tanpaJabatan ? "" : pick(random, JABATAN_VARIAN),
      `${i % 9} tahun`, // Masa Jabatan (formula)
      pick(random, LOOKUP_VARIAN.band_jabatan),
      pick(random, LOOKUP_VARIAN.kategori_penempatan),
      pick(random, LOOKUP_VARIAN.kategori_fungsi),
      pick(random, LOOKUP_VARIAN.gender),
      pick(random, TEMPAT_LAHIR),
      tanggal(lahir),
      2026 - lahir.y, // Age (formula)
      "31-40", // Range (formula)
      "Milenial", // Gen (formula)
      pick(random, AGAMA),
      pick(random, STATUS_NIKAH),
      pick(random, LOOKUP_VARIAN.work_contract),
      pick(random, LOOKUP_VARIAN.legal_entity),
      pick(random, LOOKUP_VARIAN.klasifikasi_rekrutmen),
      tanggal(masuk),
      `${2026 - masuk.y} tahun`, // Masa Kerja (formula)
      tanggal(diangkat),
      `${2026 - diangkat.y} tahun`, // Masa Sejak Diangkat (formula)
      pick(random, LOOKUP_VARIAN.person_grade),
      tanggal(promosiPg),
      `${2026 - promosiPg.y} tahun`, // Masa PG (formula)
      `SK-PG/${pad(nomor, 4)}/2024`,
      "Memenuhi Syarat", // Keterangan Naik PG (formula)
      pick(random, LOOKUP_VARIAN.job_grade),
      tanggal(promosiJg),
      `${2026 - promosiJg.y} tahun`, // Masa JG (formula)
      `SK-JG/${pad(nomor, 4)}/2024`,
      "Belum", // Keterangan Naik JG (formula)
      "0", // PG-JG (formula)
      pick(random, LOOKUP_VARIAN.bod_range),
      pick(random, JURUSAN), // VLOOKUP — sometimes #N/A
      pick(random, TEKNIK), // VLOOKUP — sometimes #N/A
      i % 11 === 2 ? "PLT Manajer Bagian" : "",
      i % 13 === 3 ? "Rangkap Ketua Tim Contoh" : "",
      i % 13 === 3 ? "Rangkap Sekretaris Tim Misal" : "",
      i % 7 === 1 ? "Catatan bebas dari Excel" : "",
      keluar ? tanggal(keluar) : "",
      status,
      i % 9 === 5 ? "kolom yang tidak dikenal mapping" : "",
    ];

    rows.push(row);
  }

  // Trailing blank rows: a hand-maintained sheet almost always has them, and a
  // Seed that turns them into Karyawan without a name is a Seed that failed.
  rows.push([]);
  rows.push(["", "", "", "", ""]);

  return rows;
}

/** The same rows as a one-sheet workbook named exactly like the real one. */
export function buildDummyWorkbook(
  options: DummyWorkbookOptions = {},
): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet(buildDummyRows(options));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return workbook;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_OUT = path.join(os.tmpdir(), "hc-core-dummy-demografi.xlsx");

function main(argv: readonly string[]): number {
  let out = DEFAULT_OUT;
  let rows = 60;
  let seed = 20_260_915;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Membuat workbook DUMMY dengan tata letak 'Demografi Karyawan - Posisi'.",
          "",
          "  npx tsx scripts/make-dummy-xlsx.ts [--out <file.xlsx>] [--rows <n>] [--seed <n>]",
          "",
          `  --out   berkas tujuan (default: ${DEFAULT_OUT})`,
          "  --rows  jumlah baris Karyawan dummy (default: 60)",
          "  --seed  angka acak, sama seed = sama isi (default: 20260915)",
          "",
          "Isinya data karangan, bukan data Karyawan sungguhan.",
          "",
        ].join("\n"),
      );
      return 0;
    }
    if (arg === "--out") {
      out = argv[++i] ?? out;
      continue;
    }
    if (arg === "--rows") {
      rows = Number(argv[++i]);
      continue;
    }
    if (arg === "--seed") {
      seed = Number(argv[++i]);
      continue;
    }
    process.stderr.write(`Argumen tidak dikenal: ${arg}\n`);
    return 2;
  }

  if (!Number.isInteger(rows) || rows < 1) {
    process.stderr.write("--rows harus bilangan bulat >= 1\n");
    return 2;
  }
  if (!Number.isFinite(seed)) {
    process.stderr.write("--seed harus angka\n");
    return 2;
  }

  const workbook = buildDummyWorkbook({ rows, seed });
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  writeFileSync(out, buffer as Buffer);

  process.stdout.write(
    [
      `Workbook dummy dibuat: ${out}`,
      `  sheet        : ${SHEET_NAME}`,
      `  baris header : ${HEADER_ROW}`,
      `  baris data   : ${rows} (+2 baris kosong di akhir, disengaja)`,
      "",
      "Coba dulu tanpa menulis apa pun:",
      `  npx tsx scripts/seed-from-excel.ts ${out} --dry-run`,
      "",
    ].join("\n"),
  );
  return 0;
}

const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
