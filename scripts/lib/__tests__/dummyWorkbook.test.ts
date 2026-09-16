/**
 * The mapping against a real .xlsx file, not against hand-written arrays.
 *
 * `excelMapping.test.ts` proves the rules. This file proves the rules survive a
 * round trip through SheetJS: workbook written to disk, read back the way
 * `scripts/seed-from-excel.ts` reads it, and planned. That is where the
 * surprises live — blank rows collapsing, the header row moving, a number cell
 * coming back as a string, the duplicated headers being folded into one by a
 * reader that keys rows by header name.
 *
 * The workbook is the synthetic one from `scripts/make-dummy-xlsx.ts`. The real
 * "Demografi Karyawan - Posisi" file is ~1.500 people's personal data and never
 * enters this repository (CLAUDE.md, PRD §8).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { HEADER_ROW, SHEET_NAME, errorsOf, planSeed } from "../../../lib/seed/excelMapping";
import { buildSeedPayload, seedPayloadSchema } from "../../../lib/seed/payload";
import { ringkasSeedPlan } from "../../../lib/seed/ringkasan";
import {
  DUMMY_FORMULA_HEADERS,
  DUMMY_HEADERS,
  buildDummyRows,
  buildDummyWorkbook,
} from "../../make-dummy-xlsx";
import {
  formatReport,
  loadEnvLocal,
  parseArgs,
  readSheet,
} from "../../seed-from-excel";

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "hc-core-seed-test-"));
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function writeWorkbook(name: string, rows?: number): string {
  const file = path.join(tmpDir, name);
  const buffer = XLSX.write(buildDummyWorkbook(rows === undefined ? {} : { rows }), {
    type: "buffer",
    bookType: "xlsx",
  });
  writeFileSync(file, buffer as Buffer);
  return file;
}

const FILE = writeWorkbook("demografi-dummy.xlsx");
const READ = readSheet(FILE, SHEET_NAME);
const PLAN = planSeed(READ.rows, { date1904: READ.date1904 });

describe("workbook dummy", () => {
  it("memakai nama sheet dan baris header yang didokumentasikan", () => {
    expect(READ.sheetNames).toEqual([SHEET_NAME]);
    expect(READ.rows[HEADER_ROW - 1]).toEqual([...DUMMY_HEADERS]);
  });

  it("deterministik: seed yang sama menghasilkan isi yang sama", () => {
    expect(buildDummyRows({ seed: 7, rows: 5 })).toEqual(
      buildDummyRows({ seed: 7, rows: 5 }),
    );
  });

  it("seed berbeda menghasilkan isi berbeda", () => {
    expect(buildDummyRows({ seed: 7, rows: 20 })).not.toEqual(
      buildDummyRows({ seed: 8, rows: 20 }),
    );
  });

  it("menghormati jumlah baris yang diminta", () => {
    const plan = planSeed(readSheet(writeWorkbook("kecil.xlsx", 12), SHEET_NAME).rows);
    expect(plan.employees).toHaveLength(12);
  });

  it("tidak memuat data Karyawan sungguhan — semua nama karangan", () => {
    const belakang = ["Contoh", "Misal", "Percobaan", "Sampel", "Uji", "Tiruan", "Fiktif", "Dummy"];
    for (const employee of PLAN.employees) {
      expect(belakang.some((akhiran) => employee.full_name.endsWith(akhiran))).toBe(true);
      expect(Number(employee.personnel_number)).toBeGreaterThanOrEqual(90_000_000);
    }
  });
});

describe("membaca workbook nyata", () => {
  it("menolak nama sheet yang salah dengan menyebut sheet yang ada", () => {
    expect(() => readSheet(FILE, "Sheet1")).toThrow(/Demografi Karyawan - Posisi/);
  });

  it("mempertahankan baris kosong supaya nomor baris tetap cocok dengan Excel", () => {
    expect(PLAN.employees[0].baris).toBe(HEADER_ROW + 1);
    expect(PLAN.employees.at(-1)?.baris).toBe(HEADER_ROW + PLAN.employees.length);
  });

  it("melewati baris kosong di akhir berkas", () => {
    expect(PLAN.stats.barisKosong).toBeGreaterThanOrEqual(2);
    expect(PLAN.employees).toHaveLength(60);
  });

  it("tidak menemukan satu pun error — workbook ini memang bisa diseed", () => {
    expect(errorsOf(PLAN)).toEqual([]);
  });
});

describe("kolom", () => {
  it("mengabaikan tepat 12 kolom rumus", () => {
    expect([...PLAN.headerPlan.ignored].sort()).toEqual([...DUMMY_FORMULA_HEADERS].sort());
  });

  it("melaporkan kolom yang tidak dikenal, dan cuma itu", () => {
    expect(PLAN.headerPlan.unknown).toEqual(["Catatan HC"]);
  });

  it("memetakan semua kolom sisanya", () => {
    const dipetakan = PLAN.headerPlan.columns.length;
    expect(dipetakan + DUMMY_FORMULA_HEADERS.length + 1).toBe(DUMMY_HEADERS.length);
  });

  it("dua kolom No Surat jadi dua kolom berbeda", () => {
    const withSurat = PLAN.employees.filter(
      (e) => e.text.nomor_surat_pg !== undefined && e.text.nomor_surat_jg !== undefined,
    );
    expect(withSurat.length).toBe(PLAN.employees.length);
    for (const employee of withSurat) {
      expect(employee.text.nomor_surat_pg).toMatch(/^SK-PG\//);
      expect(employee.text.nomor_surat_jg).toMatch(/^SK-JG\//);
    }
  });

  it("dua kolom Keterangan Rangkap jadi dua kolom berbeda", () => {
    const rangkap = PLAN.employees.filter(
      (e) => e.text.keterangan_rangkap_1 !== undefined,
    );
    expect(rangkap.length).toBeGreaterThan(0);
    for (const employee of rangkap) {
      expect(employee.text.keterangan_rangkap_1).toContain("Ketua");
      expect(employee.text.keterangan_rangkap_2).toContain("Sekretaris");
    }
  });

  it("nilai #N/A dari kolom VLOOKUP jadi kosong, bukan teks '#N/A'", () => {
    const jurusan = PLAN.employees.map((e) => e.text.jurusan);
    expect(jurusan).toContain(undefined);
    expect(jurusan).not.toContain("#N/A");
    expect(PLAN.lookups.filter((l) => l.label === "#N/A")).toEqual([]);
  });
});

describe("tanggal dari sel serial maupun sel teks", () => {
  it("keduanya menghasilkan tanggal yang sah", () => {
    for (const employee of PLAN.employees) {
      for (const value of Object.values(employee.dates)) {
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (employee.private.date_of_birth !== null) {
        expect(employee.private.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("baris bernomor genap (sel serial) dan ganjil (sel teks) sama-sama terisi", () => {
    // Baris data pertama memakai serial, yang kedua memakai teks dd/mm/yyyy.
    expect(PLAN.employees[0].dates.original_start_date).toBeDefined();
    expect(PLAN.employees[1].dates.original_start_date).toBeDefined();
  });

  it("tanggal lahir masuk ke Data Pribadi Sensitif, bukan ke employees", () => {
    expect(PLAN.stats.karyawanDenganDataPribadi).toBe(60);
    for (const employee of PLAN.employees) {
      expect(employee.private.date_of_birth).not.toBeNull();
      expect(employee.private.religion).not.toBeNull();
    }
  });
});

describe("kotoran yang memang harus mendarat (ADR-002, PRD #11)", () => {
  it("tiga ejaan QHSSE jadi dua Unit Organisasi — yang beda cuma spasi ujung ikut dipangkas", () => {
    const qhsse = PLAN.orgUnits.filter((u) => u.nama.toUpperCase().includes("QHSSE"));
    const nama = new Set(qhsse.map((u) => u.nama));
    expect(nama.has("Divisi QHSSE")).toBe(true);
    expect(nama.has("DIVISI QHSSE")).toBe(true);
    expect([...nama].some((n) => n.endsWith(" "))).toBe(false);
  });

  it('"dan" dan "&" tetap dua Unit Organisasi', () => {
    const nama = PLAN.orgUnits.map((u) => u.nama);
    expect(nama).toContain("Divisi Keuangan dan Akuntansi");
    expect(nama).toContain("Divisi Keuangan & Akuntansi");
  });

  it("varian kapitalisasi Jabatan tetap dua baris", () => {
    const nama = PLAN.jabatan.map((j) => j.nama);
    expect(nama).toContain("Staf Muda");
    expect(nama).toContain("staf muda");
  });

  it("varian label Lookup tetap terpisah", () => {
    const gender = PLAN.lookups.filter((l) => l.tipe === "gender").map((l) => l.label);
    expect(gender).toContain("Laki-laki");
    expect(gender).toContain("Laki-Laki");
  });

  it("kode Data Referensi tetap unik walau namanya cuma beda kapitalisasi", () => {
    const orgKode = PLAN.orgUnits.map((u) => u.kode);
    expect(new Set(orgKode).size).toBe(orgKode.length);
    const jabatanKode = PLAN.jabatan.map((j) => j.kode);
    expect(new Set(jabatanKode).size).toBe(jabatanKode.length);
    const lookupKode = PLAN.lookups.map((l) => `${l.tipe}/${l.kode}`);
    expect(new Set(lookupKode).size).toBe(lookupKode.length);
  });

  it("ada Unit Organisasi bertipe proyek", () => {
    expect(PLAN.orgUnits.filter((u) => u.tipe === "proyek").length).toBeGreaterThan(0);
  });

  it("ada Karyawan tanpa Unit Organisasi dan tanpa Jabatan", () => {
    expect(PLAN.employees.some((e) => e.orgUnitKey === null)).toBe(true);
    expect(PLAN.employees.some((e) => e.jabatanKey === null)).toBe(true);
  });

  it("tidak ada Sub Bagian yang namanya persis sama dengan induknya", () => {
    const byKey = new Map(PLAN.orgUnits.map((u) => [u.key, u]));
    for (const unit of PLAN.orgUnits) {
      if (unit.parentKey === null) continue;
      expect(unit.nama).not.toBe(byKey.get(unit.parentKey)?.nama);
    }
  });

  it("Sub Bagian yang beda kapitalisasi dari induknya tetap dibuat", () => {
    const byKey = new Map(PLAN.orgUnits.map((u) => [u.key, u]));
    const kembar = PLAN.orgUnits.filter(
      (u) =>
        u.parentKey !== null &&
        u.nama.toLowerCase() === byKey.get(u.parentKey)?.nama.toLowerCase(),
    );
    expect(kembar.length).toBeGreaterThan(0);
  });

  it("peringatannya bisa dibaca dan tidak ada yang menghentikan Seed", () => {
    const kodes = new Set(PLAN.issues.map((i) => i.kode));
    expect(kodes.has("karyawan_tanpa_unit")).toBe(true);
    expect(kodes.has("karyawan_tanpa_jabatan")).toBe(true);
    expect(kodes.has("kolom_tidak_dikenal")).toBe(true);
    expect(PLAN.issues.every((i) => i.level === "peringatan")).toBe(true);
  });

  it("ada Karyawan nonaktif dan ada yang keluar tapi masih aktif", () => {
    expect(PLAN.employees.some((e) => e.status === "nonaktif")).toBe(true);
    expect(PLAN.issues.some((i) => i.kode === "keluar_tapi_aktif")).toBe(true);
  });
});

describe("laporan dry run", () => {
  const report = formatReport(PLAN, {
    file: FILE,
    sheet: SHEET_NAME,
    headerRow: HEADER_ROW,
    date1904: false,
  });

  it("menyebut jumlah yang akan dibuat", () => {
    expect(report).toContain(`Karyawan         : ${PLAN.employees.length}`);
    expect(report).toContain(`Jabatan          : ${PLAN.jabatan.length}`);
  });

  it("menyebut kolom rumus yang diabaikan dan kolom tak dikenal", () => {
    expect(report).toContain("Diabaikan (rumus): 12");
    expect(report).toContain("Catatan HC");
  });

  it("merinci tipe Unit Organisasi yang akan dibuat", () => {
    expect(report).toMatch(/Unit Organisasi\s+: \d+ \(.*proyek \d+.*\)/);
  });

  it("tidak menulis 'GAGAL' untuk workbook yang bersih dari error", () => {
    expect(report).not.toContain("GAGAL");
  });
});

describe("payload untuk seed_from_payload (PRD #23)", () => {
  const payload = buildSeedPayload(PLAN);

  it("lolos skema server apa adanya, tanpa karakter NUL", () => {
    expect(seedPayloadSchema.safeParse(payload).success).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("\\u0000");
  });

  it("membawa jumlah baris yang sama dengan rencananya", () => {
    expect(payload.org_units).toHaveLength(PLAN.orgUnits.length);
    expect(payload.jabatan).toHaveLength(PLAN.jabatan.length);
    expect(payload.lookups).toHaveLength(PLAN.lookups.length);
    expect(payload.employees).toHaveLength(PLAN.employees.length);
  });

  it("untuk 1.500 baris tetap di bawah 2 MB — batas Server Action 4 MB (ADR-008)", () => {
    const besar = planSeed(buildDummyRows({ rows: 1500 }));
    expect(errorsOf(besar)).toEqual([]);
    const bytes = Buffer.byteLength(JSON.stringify(buildSeedPayload(besar)), "utf8");
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it("ringkasan halaman web menyebut angka yang sama dengan laporan CLI", () => {
    const r = ringkasSeedPlan(PLAN);
    const report = formatReport(PLAN, {
      file: FILE,
      sheet: SHEET_NAME,
      headerRow: HEADER_ROW,
      date1904: false,
    });
    expect(report).toContain(
      `Karyawan         : ${r.akanDibuat.karyawan.total} (${r.akanDibuat.karyawan.nonaktif} nonaktif)`,
    );
    expect(report).toContain(`Unit Organisasi  : ${r.akanDibuat.unitOrganisasi.total} (`);
    expect(report).toContain(`Lookup           : ${r.akanDibuat.lookup.total} (`);
    expect(report).toContain(`Diabaikan (rumus): ${r.kolom.diabaikan.length}`);
    expect(report).toContain(`Tidak dikenal    : ${r.kolom.tidakDikenal.length}`);
    expect(report).toContain(`Peringatan (${r.peringatan.length})`);
    expect(r.bisaDijalankan).toBe(true);
  });
});

describe("koneksi dari .env.local", () => {
  const VARS = ["HC_SEED_DB_URL", "SUPABASE_DB_URL", "DATABASE_URL", "HC_LOCAL_DB_URL"];

  function withCleanEnv<T>(fn: () => T): T {
    const saved = VARS.map((name) => [name, process.env[name]] as const);
    for (const name of VARS) delete process.env[name];
    try {
      return fn();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it("membaca .env.local kalau environment belum punya koneksi", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hc-core-env-"));
    writeFileSync(path.join(dir, ".env.local"), "HC_SEED_DB_URL=postgresql://contoh/db\n");
    withCleanEnv(() => {
      loadEnvLocal(dir);
      expect(process.env.HC_SEED_DB_URL).toBe("postgresql://contoh/db");
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("tidak menimpa koneksi yang sudah diatur di environment", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hc-core-env-"));
    writeFileSync(path.join(dir, ".env.local"), "HC_SEED_DB_URL=postgresql://berkas/db\n");
    withCleanEnv(() => {
      process.env.HC_SEED_DB_URL = "postgresql://shell/db";
      loadEnvLocal(dir);
      expect(process.env.HC_SEED_DB_URL).toBe("postgresql://shell/db");
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("tidak melempar kalau .env.local tidak ada", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hc-core-env-"));
    withCleanEnv(() => {
      expect(() => loadEnvLocal(dir)).not.toThrow();
      expect(process.env.HC_SEED_DB_URL).toBeUndefined();
    });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("argumen baris perintah", () => {
  it("butuh nama berkas", () => {
    expect(() => parseArgs([])).toThrow(/Berkas Excel belum disebutkan/);
  });

  it("default-nya menulis, bukan dry run", () => {
    const options = parseArgs(["a.xlsx"]);
    expect(options).toMatchObject({ file: "a.xlsx", dryRun: false, force: false });
  });

  it("mengerti --dry-run, --sheet, --header-row, --keterangan, --force", () => {
    expect(
      parseArgs([
        "a.xlsx",
        "--dry-run",
        "--sheet",
        "Lain",
        "--header-row",
        "2",
        "--keterangan",
        "Seed percobaan",
        "--force",
      ]),
    ).toMatchObject({
      file: "a.xlsx",
      dryRun: true,
      sheet: "Lain",
      headerRow: 2,
      keterangan: "Seed percobaan",
      force: true,
    });
  });

  it("menolak opsi yang tidak dikenal", () => {
    expect(() => parseArgs(["a.xlsx", "--hapus-semua"])).toThrow(/tidak dikenal/);
  });

  it("menolak dua berkas sekaligus", () => {
    expect(() => parseArgs(["a.xlsx", "b.xlsx"])).toThrow(/satu berkas/);
  });

  it("menolak --header-row yang bukan bilangan bulat positif", () => {
    expect(() => parseArgs(["a.xlsx", "--header-row", "0"])).toThrow();
    expect(() => parseArgs(["a.xlsx", "--header-row", "dua"])).toThrow();
  });

  it("--help dikenali", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
  });
});
