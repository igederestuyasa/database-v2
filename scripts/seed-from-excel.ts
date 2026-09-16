/**
 * scripts/seed-from-excel.ts — Seed awal dari Excel (PRD #1, ARCHITECTURE.md §4E).
 *
 * Runs ONCE, ever. After it the workbook is retired and this application is the
 * source of truth (PRD §3). There is no second import, no periodic sync, and
 * batch-add via Excel after the Seed is an explicit non-goal (PRD §5).
 *
 * ONE SEED = ONE TRANSACTION = ONE BATCH
 * ---------------------------------------------------------------------------
 * The writing is done by `lib/revisions/seedBatch.ts`, which holds a direct
 * `pg` connection and opens a real transaction — not supabase-js. Through
 * PostgREST every write is its own request and therefore its own transaction,
 * so ~1.475 Karyawan would land as ~1.475 separate Batch rows and "kembalikan
 * Seed ini" would undo exactly one person (ADR-006, PRD #16). On one direct
 * connection `app.batch_id` survives every insert, the whole import is one
 * Batch of jenis `seed`, and a single failing row rolls back the entire Seed —
 * including the `batches` row — instead of leaving half a company behind.
 *
 * This script therefore does the I/O and nothing clever. Every decision that
 * could be quietly wrong lives in `lib/seed/excelMapping.ts`, which is pure
 * and unit-tested: a column mapped to the wrong field throws nothing, looks
 * fine, and lands on 1.475 people.
 *
 * DIRTY DATA IS THE POINT
 * ---------------------------------------------------------------------------
 * Unit Organisasi, Jabatan and Lookup are created from the unique values
 * exactly as written, trimmed and nothing else. "Divisi QHSSE" and
 * "DIVISI QHSSE" become two rows on purpose; the "Perlu Dibereskan" page and
 * Merge are where they collapse, as one revertible admin decision (ADR-002,
 * PRD #11/#12). This script never normalises, de-duplicates or corrects.
 *
 * SECURITY NOTE ON `xlsx`
 * ---------------------------------------------------------------------------
 * `xlsx@0.18.5` carries known advisories (prototype pollution, ReDoS). That is
 * acceptable HERE and only here: a one-shot local script, run by an admin, on a
 * file that admin supplies. This module must never become reachable from a
 * request path — nothing under `app/` may import it, and `lib/revisions/
 * seedBatch.ts` is script-only for the same reason.
 *
 * Usage:
 *   npx tsx scripts/seed-from-excel.ts <file.xlsx> --dry-run
 *   npx tsx scripts/seed-from-excel.ts <file.xlsx>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "pg";
import * as XLSX from "xlsx";

import {
  SEED_CONNECTION_ENV_VARS,
  SeedBatchError,
  runSeedBatch,
} from "../lib/revisions/seedBatch";
import {
  HEADER_ROW,
  SHEET_NAME,
  errorsOf,
  planSeed,
  warningsOf,
  type PlannedEmployee,
  type SeedIssue,
  type SeedPlan,
} from "../lib/seed/excelMapping";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Options = {
  file: string;
  dryRun: boolean;
  sheet: string;
  headerRow: number;
  keterangan: string | null;
  connectionString?: string;
  force: boolean;
};

const HELP = [
  "Seed awal data Karyawan dari Excel (PRD fitur 1). Dijalankan SEKALI.",
  "",
  "  npx tsx scripts/seed-from-excel.ts <file.xlsx> [opsi]",
  "",
  "Opsi:",
  "  --dry-run           Laporkan apa yang AKAN dibuat, tanpa menulis apa pun.",
  `  --sheet <nama>      Nama sheet (default: "${SHEET_NAME}").`,
  `  --header-row <n>    Baris header, 1-based (default: ${HEADER_ROW}).`,
  "  --keterangan <teks> Keterangan Batch yang muncul di halaman Log Perubahan.",
  "  --connection <url>  Connection string Postgres langsung (override env).",
  "  --force             Tetap jalan walaupun tabel Karyawan sudah berisi.",
  "  -h, --help          Tampilkan bantuan ini.",
  "",
  "Koneksi diambil dari environment variable, urut:",
  `  ${SEED_CONNECTION_ENV_VARS.join(", ")}`,
  "",
  "Seluruh Seed masuk SATU Batch jenis 'seed'. Kalau satu baris gagal, tidak ada",
  "satu pun yang tertulis. Kalau hasilnya salah, buka halaman Log Perubahan dan",
  "kembalikan Batch itu utuh.",
  "",
].join("\n");

export function parseArgs(argv: readonly string[]): Options | { help: true } {
  const options: Options = {
    file: "",
    dryRun: false,
    sheet: SHEET_NAME,
    headerRow: HEADER_ROW,
    keterangan: null,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--sheet") {
      options.sheet = requireValue(argv, ++i, "--sheet");
      continue;
    }
    if (arg === "--header-row") {
      const raw = requireValue(argv, ++i, "--header-row");
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--header-row harus bilangan bulat >= 1");
      }
      options.headerRow = parsed;
      continue;
    }
    if (arg === "--keterangan") {
      options.keterangan = requireValue(argv, ++i, "--keterangan");
      continue;
    }
    if (arg === "--connection") {
      options.connectionString = requireValue(argv, ++i, "--connection");
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Opsi tidak dikenal: ${arg}`);
    if (options.file !== "") {
      throw new Error("Hanya satu berkas Excel yang bisa diseed sekaligus.");
    }
    options.file = arg;
  }

  if (options.file === "") throw new Error("Berkas Excel belum disebutkan.");
  return options;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} butuh sebuah nilai.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Reading the workbook
// ---------------------------------------------------------------------------

export type SheetRead = {
  rows: unknown[][];
  date1904: boolean;
  sheetNames: readonly string[];
};

/**
 * The chosen sheet as an array of arrays, blank rows kept.
 *
 * `blankrows: true` matters: it keeps every array index equal to the row
 * number a person sees in Excel, so "baris 731" in the report is the row they
 * can actually go and look at.
 *
 * `cellDates` is left off deliberately, so date cells arrive as Excel serials
 * and `parseDateCell()` converts them with integer arithmetic — no `Date`, no
 * local timezone, no chance of the Seed shifting everyone's birthday by a day
 * depending on where it was run from.
 */
export function readSheet(file: string, sheetName: string): SheetRead {
  const workbook = XLSX.read(readFileSync(file), {
    type: "buffer",
    cellDates: false,
  });
  const sheetNames = workbook.SheetNames ?? [];
  const sheet = workbook.Sheets?.[sheetName];
  if (!sheet) {
    throw new Error(
      `Sheet "${sheetName}" tidak ada di berkas itu. Sheet yang tersedia: ${
        sheetNames.length > 0 ? sheetNames.map((n) => `"${n}"`).join(", ") : "(tidak ada)"
      }. Pakai --sheet untuk memilih.`,
    );
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  return {
    rows,
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
    sheetNames,
  };
}

// ---------------------------------------------------------------------------
// The report — read by staf HC, so Indonesian and concrete
// ---------------------------------------------------------------------------

function countBy<T, K extends string>(items: readonly T[], key: (item: T) => K): string {
  const counts = new Map<K, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
}

function formatIssue(issue: SeedIssue): string {
  const where = issue.baris !== undefined ? `baris ${issue.baris}` : "berkas";
  return `  [${issue.kode}] ${where}: ${issue.pesan}`;
}

export function formatReport(
  plan: SeedPlan,
  context: { file: string; sheet: string; headerRow: number; date1904: boolean },
): string {
  const { headerPlan, stats } = plan;
  const errors = errorsOf(plan);
  const warnings = warningsOf(plan);

  const lines: string[] = [
    "== Seed awal dari Excel ==",
    `Berkas       : ${context.file}`,
    `Sheet        : ${context.sheet} (header baris ${context.headerRow}${
      context.date1904 ? ", sistem tanggal 1904" : ""
    })`,
    `Baris data   : ${stats.barisDibaca} dibaca, ${stats.barisKosong} kosong dilewati`,
    "",
    "Kolom",
    `  Dipetakan        : ${headerPlan.columns.length}`,
    `  Diabaikan (rumus): ${headerPlan.ignored.length}${
      headerPlan.ignored.length > 0 ? ` — ${headerPlan.ignored.join(", ")}` : ""
    }`,
    `  Tidak dikenal    : ${headerPlan.unknown.length}${
      headerPlan.unknown.length > 0 ? ` — ${headerPlan.unknown.join(", ")}` : ""
    }`,
    "",
    "Akan dibuat",
    `  Unit Organisasi  : ${plan.orgUnits.length}${
      plan.orgUnits.length > 0 ? ` (${countBy(plan.orgUnits, (u) => u.tipe)})` : ""
    }`,
    `  Jabatan          : ${plan.jabatan.length}`,
    `  Lookup           : ${plan.lookups.length}${
      plan.lookups.length > 0 ? ` (${countBy(plan.lookups, (l) => l.tipe)})` : ""
    }`,
    `  Karyawan         : ${plan.employees.length} (${
      plan.employees.filter((e) => e.status === "nonaktif").length
    } nonaktif)`,
    `  Data Pribadi Sensitif terisi: ${stats.karyawanDenganDataPribadi}`,
  ];

  if (warnings.length > 0) {
    lines.push("", `Peringatan (${warnings.length}) — data tetap masuk, dibereskan lewat halaman Perlu Dibereskan:`);
    for (const issue of warnings.slice(0, 40)) lines.push(formatIssue(issue));
    if (warnings.length > 40) lines.push(`  … dan ${warnings.length - 40} peringatan lain`);
  }

  if (errors.length > 0) {
    lines.push("", `GAGAL — ${errors.length} masalah yang harus dibereskan di Excel dulu:`);
    for (const issue of errors.slice(0, 40)) lines.push(formatIssue(issue));
    if (errors.length > 40) lines.push(`  … dan ${errors.length - 40} masalah lain`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Multi-row INSERT in chunks.
 *
 * One statement per ~200 rows instead of one per row: on a direct connection to
 * Supabase every round trip is real latency, and ~1.475 Karyawan one at a time
 * is minutes of it. The `log_revision` trigger is FOR EACH ROW, so the Revisi
 * are identical either way — one per row, all inside the one Seed Batch.
 */
async function insertChunked<T>(
  client: Client,
  table: string,
  columns: readonly string[],
  rows: readonly T[],
  toValues: (row: T) => readonly unknown[],
  returning: string,
  chunkSize = 200,
): Promise<Array<Record<string, string>>> {
  const out: Array<Record<string, string>> = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const values = toValues(row);
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql =
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")} returning ${returning}`;
    const result = await client.query<Record<string, string>>(sql, params);
    out.push(...result.rows);
  }
  return out;
}

const EMPLOYEE_COLUMNS = [
  "personnel_number",
  "nip",
  "full_name",
  "status",
  "org_unit_id",
  "jabatan_id",
  "gender_id",
  "work_contract_id",
  "person_grade_id",
  "job_grade_id",
  "legal_entity_id",
  "klasifikasi_rekrutmen_id",
  "teknik_non_teknik_id",
  "bod_range_id",
  "band_jabatan_id",
  "kategori_penempatan_id",
  "kategori_fungsi_id",
  "keterangan_pj_plt",
  "keterangan_rangkap_1",
  "keterangan_rangkap_2",
  "keterangan",
  "jurusan",
  "nomor_surat_pg",
  "nomor_surat_jg",
  "original_start_date",
  "tanggal_diangkat",
  "tanggal_promosi_pg",
  "tanggal_promosi_jg",
  "tanggal_keluar",
] as const;

export type SeedCounts = {
  lookups: number;
  jabatan: number;
  orgUnits: number;
  employees: number;
  dataPribadi: number;
  revisions: number;
};

/**
 * Write the whole plan on an already-open transaction.
 *
 * Order is forced by the foreign keys: Lookup, Jabatan and Unit Organisasi
 * first (parents before children — `planSeed()` emits them that way), Karyawan
 * last. `employee_private` rows are NOT inserted: a trigger creates one empty
 * row per Karyawan (PRD #22, ARCHITECTURE.md §3), so the Seed updates them.
 */
export async function writeSeed(
  client: Client,
  plan: SeedPlan,
  options: { force: boolean },
): Promise<SeedCounts> {
  const existing = await client.query<{ n: string }>(
    "select count(*)::text as n from public.employees",
  );
  if (Number(existing.rows[0]?.n ?? 0) > 0 && !options.force) {
    throw new SeedBatchError(
      `Tabel Karyawan sudah berisi ${existing.rows[0]?.n} baris. Seed hanya dijalankan sekali (PRD §3). ` +
        "Kalau Seed sebelumnya salah, kembalikan Batch-nya dari halaman Log Perubahan; " +
        "pakai --force hanya kalau memang sengaja menambah di atas data yang ada.",
    );
  }

  // Watermark for the self-check at the end: every Revisi written from here on
  // must belong to exactly one Batch — this Seed's.
  const before = await client.query<{ id: string }>(
    "select coalesce(max(id), 0)::text as id from public.revisions",
  );
  const revisionWatermark = before.rows[0]?.id ?? "0";

  // --- Lookup -------------------------------------------------------------
  const lookupIds = new Map<string, string>();
  const lookupRows = await insertChunked(
    client,
    "public.lookups",
    ["tipe", "kode", "label", "urutan"],
    plan.lookups,
    (row) => [row.tipe, row.kode, row.label, row.urutan],
    "id, tipe, kode",
  );
  const lookupByKode = new Map(
    lookupRows.map((row) => [`${row.tipe}\u0000${row.kode}`, row.id]),
  );
  for (const row of plan.lookups) {
    const id = lookupByKode.get(`${row.tipe}\u0000${row.kode}`);
    if (id) lookupIds.set(row.key, id);
  }

  // --- Jabatan ------------------------------------------------------------
  const jabatanRows = await insertChunked(
    client,
    "public.jabatan",
    ["kode", "nama"],
    plan.jabatan,
    (row) => [row.kode, row.nama],
    "id, kode",
  );
  const jabatanByKode = new Map(jabatanRows.map((row) => [row.kode, row.id]));
  const jabatanIds = new Map<string, string>();
  for (const row of plan.jabatan) {
    const id = jabatanByKode.get(row.kode);
    if (id) jabatanIds.set(row.key, id);
  }

  // --- Unit Organisasi ----------------------------------------------------
  // One at a time: a child's parent_id is the id the previous insert just
  // returned. `planSeed()` guarantees parents come first.
  const orgIds = new Map<string, string>();
  for (const unit of plan.orgUnits) {
    const parentId = unit.parentKey === null ? null : (orgIds.get(unit.parentKey) ?? null);
    const inserted = await client.query<{ id: string }>(
      "insert into public.org_units (kode, nama, tipe, parent_id) values ($1, $2, $3, $4) returning id",
      [unit.kode, unit.nama, unit.tipe, parentId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new SeedBatchError(`Gagal membuat Unit Organisasi "${unit.nama}".`);
    orgIds.set(unit.key, id);
  }

  // --- Karyawan -----------------------------------------------------------
  const employeeValues = (employee: PlannedEmployee): readonly unknown[] => [
    employee.personnel_number,
    employee.nip,
    employee.full_name,
    employee.status,
    employee.orgUnitKey === null ? null : (orgIds.get(employee.orgUnitKey) ?? null),
    employee.jabatanKey === null ? null : (jabatanIds.get(employee.jabatanKey) ?? null),
    lookupIdFor(employee, "gender"),
    lookupIdFor(employee, "work_contract"),
    lookupIdFor(employee, "person_grade"),
    lookupIdFor(employee, "job_grade"),
    lookupIdFor(employee, "legal_entity"),
    lookupIdFor(employee, "klasifikasi_rekrutmen"),
    lookupIdFor(employee, "teknik_non_teknik"),
    lookupIdFor(employee, "bod_range"),
    lookupIdFor(employee, "band_jabatan"),
    lookupIdFor(employee, "kategori_penempatan"),
    lookupIdFor(employee, "kategori_fungsi"),
    employee.text.keterangan_pj_plt ?? null,
    employee.text.keterangan_rangkap_1 ?? null,
    employee.text.keterangan_rangkap_2 ?? null,
    employee.text.keterangan ?? null,
    employee.text.jurusan ?? null,
    employee.text.nomor_surat_pg ?? null,
    employee.text.nomor_surat_jg ?? null,
    employee.dates.original_start_date ?? null,
    employee.dates.tanggal_diangkat ?? null,
    employee.dates.tanggal_promosi_pg ?? null,
    employee.dates.tanggal_promosi_jg ?? null,
    employee.dates.tanggal_keluar ?? null,
  ];

  function lookupIdFor(
    employee: PlannedEmployee,
    tipe: keyof PlannedEmployee["lookupKeys"],
  ): string | null {
    const key = employee.lookupKeys[tipe];
    return key === undefined ? null : (lookupIds.get(key) ?? null);
  }

  const employeeRows = await insertChunked(
    client,
    "public.employees",
    [...EMPLOYEE_COLUMNS],
    plan.employees,
    employeeValues,
    "id, personnel_number",
  );
  const employeeIds = new Map(
    employeeRows.map((row) => [row.personnel_number, row.id]),
  );

  // --- Data Pribadi Sensitif ---------------------------------------------
  // The rows already exist: `employees_autocreate_private` made one empty row
  // per Karyawan. Never INSERT them here (and never DELETE anything, ever).
  const withPrivate = plan.employees.filter((employee) =>
    Object.values(employee.private).some((value) => value !== null),
  );
  let dataPribadi = 0;
  for (let start = 0; start < withPrivate.length; start += 200) {
    const chunk = withPrivate.slice(start, start + 200);
    const params: unknown[] = [];
    const tuples = chunk.map((employee) => {
      const id = employeeIds.get(employee.personnel_number);
      if (!id) {
        throw new SeedBatchError(
          `Karyawan ${employee.personnel_number} tidak punya id setelah insert.`,
        );
      }
      params.push(
        id,
        employee.private.date_of_birth,
        employee.private.place_of_birth,
        employee.private.religion,
        employee.private.marital_status,
      );
      const n = params.length;
      return `($${n - 4}::uuid, $${n - 3}::date, $${n - 2}::text, $${n - 1}::text, $${n}::text)`;
    });
    const result = await client.query(
      `update public.employee_private ep
          set date_of_birth  = v.date_of_birth,
              place_of_birth = v.place_of_birth,
              religion       = v.religion,
              marital_status = v.marital_status
         from (values ${tuples.join(", ")})
              as v (employee_id, date_of_birth, place_of_birth, religion, marital_status)
        where ep.employee_id = v.employee_id`,
      params,
    );
    dataPribadi += result.rowCount ?? 0;
  }

  // --- Self-check ---------------------------------------------------------
  // The promise of this whole unit is "one Seed = one Batch". Prove it before
  // committing: if anything wrote outside this Batch, roll the Seed back.
  const audit = await client.query<{ batches: string; revisions: string }>(
    `select count(distinct r.batch_id)::text as batches,
            count(*)::text                   as revisions
       from public.revisions r
      where r.id > $1::bigint`,
    [revisionWatermark],
  );
  const batches = Number(audit.rows[0]?.batches ?? 0);
  if (batches !== 1) {
    throw new SeedBatchError(
      `Seed menyentuh ${batches} Batch, seharusnya tepat 1. Tidak ada yang disimpan.`,
    );
  }

  return {
    lookups: plan.lookups.length,
    jabatan: plan.jabatan.length,
    orgUnits: plan.orgUnits.length,
    employees: plan.employees.length,
    dataPribadi,
    revisions: Number(audit.rows[0]?.revisions ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Read `.env.local` — the file `.env.example` tells the admin to put
 * `HC_SEED_DB_URL` in.
 *
 * Next.js loads `.env.local` by itself; plain Node does not. Without this, the
 * one instruction the admin was given would silently not apply to the Seed, and
 * they would be told "koneksi belum diatur" while looking straight at the
 * variable they just filled in. Values already in the environment win (Node's
 * own rule for env files), and a missing or unreadable file is not an error —
 * a shell variable and `--connection` are both still valid ways in, and
 * `seedBatch.ts` says what to set if none of them worked.
 */
export function loadEnvLocal(cwd: string = process.cwd()): void {
  const alreadySet = SEED_CONNECTION_ENV_VARS.some(
    (name) => (process.env[name] ?? "").trim() !== "",
  );
  if (alreadySet) return;
  try {
    process.loadEnvFile(path.join(cwd, ".env.local"));
  } catch {
    // No .env.local here, and that is not this script's business to complain about.
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    const parsed = parseArgs(argv);
    if ("help" in parsed) {
      process.stdout.write(HELP);
      return 0;
    }
    options = parsed;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }

  let sheet: SheetRead;
  try {
    sheet = readSheet(options.file, options.sheet);
  } catch (error) {
    process.stderr.write(`Gagal membaca berkas: ${(error as Error).message}\n`);
    return 1;
  }

  const plan = planSeed(sheet.rows, {
    headerRowNumber: options.headerRow,
    date1904: sheet.date1904,
  });

  process.stdout.write(
    `${formatReport(plan, {
      file: options.file,
      sheet: options.sheet,
      headerRow: options.headerRow,
      date1904: sheet.date1904,
    })}\n`,
  );

  const errors = errorsOf(plan);
  if (errors.length > 0) {
    process.stdout.write(
      "\nTidak ada yang ditulis ke database. Perbaiki Excel-nya lalu jalankan --dry-run lagi.\n",
    );
    return 1;
  }

  if (options.dryRun) {
    process.stdout.write(
      "\nDRY RUN — tidak ada satu baris pun yang ditulis ke database.\n",
    );
    return 0;
  }

  const keterangan =
    options.keterangan ?? `Seed awal dari ${path.basename(options.file)}`;

  if (options.connectionString === undefined) loadEnvLocal();

  try {
    const { batchId, result } = await runSeedBatch(
      { keterangan, connectionString: options.connectionString },
      async ({ client }) => writeSeed(client, plan, { force: options.force }),
    );
    process.stdout.write(
      [
        "",
        "Seed berhasil. Semuanya masuk SATU Batch:",
        `  Batch id        : ${batchId}`,
        `  Keterangan      : ${keterangan}`,
        `  Lookup          : ${result.lookups}`,
        `  Jabatan         : ${result.jabatan}`,
        `  Unit Organisasi : ${result.orgUnits}`,
        `  Karyawan        : ${result.employees}`,
        `  Data Pribadi    : ${result.dataPribadi} baris diisi`,
        `  Revisi tercatat : ${result.revisions}`,
        "",
        "Kalau hasilnya salah: buka halaman Log Perubahan, cari Batch di atas, dan",
        "kembalikan Batch itu utuh (PRD #16). Excel ini sekarang pensiun — semua",
        "perubahan berikutnya dilakukan lewat aplikasi.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    process.stderr.write(
      [
        "",
        `Seed GAGAL: ${message}`,
        "",
        "Transaksi sudah di-rollback: tidak ada satu baris pun yang tertulis,",
        "termasuk baris Batch-nya. Database persis seperti sebelum perintah ini.",
        "",
      ].join("\n"),
    );
    return 1;
  }
}

const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
