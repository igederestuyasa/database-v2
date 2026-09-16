/**
 * lib/seed/excelMapping.ts — the Excel half of the Seed (PRD #1).
 *
 * PURE ON PURPOSE. Workbook rows in, typed records out. No `pg`, no
 * supabase-js, no `xlsx`, no filesystem, no clock. `scripts/seed-from-excel.ts`
 * does the I/O; everything that can be *wrong* lives here, where
 * `lib/seed/excelMapping.test.ts` can look at it. The CLI in `scripts/` and the
 * Seed page in the browser both import it; neither may add I/O here.
 *
 * That split is the whole point of the unit. The Seed runs once, against a
 * workbook this repository has never seen, and writes ~1.475 Karyawan. A column
 * mapped to the wrong field does not throw and does not look wrong on screen —
 * it lands on 1.475 people and is found months later. So the mapping is a
 * table, the table is tested, and anything the table cannot explain is
 * *reported*, never guessed.
 *
 * WHAT THIS MODULE REFUSES TO DO
 * ---------------------------------------------------------------------------
 * It does not clean. Data Referensi is created from the unique values **exactly
 * as they appear**, trimmed and nothing else (ARCHITECTURE.md §4E, ADR-002).
 * "Divisi QHSSE", "DIVISI QHSSE" and "Divisi QHSSE " become three rows on
 * purpose: the Seed's job is to get the company into the database, and the
 * "Perlu Dibereskan" page plus Merge is where the variants collapse (PRD
 * #11/#12). Every de-duplication done here is a Temuan staf HC never gets to
 * see — and a Merge they can no longer revert.
 *
 * It also does not invent. A header it does not recognise is reported as
 * unknown and dropped; a date it cannot read is an error that stops the Seed
 * rather than a silent NULL on someone's record.
 *
 * SHAPE OF THE INPUT
 * ---------------------------------------------------------------------------
 * Rows arrive as `unknown[][]` — the sheet as an array of arrays, exactly what
 * `XLSX.utils.sheet_to_json(ws, { header: 1 })` produces, **including** the
 * three title rows above the header. Arrays, not objects keyed by header:
 * `Keterangan Rangkap` and `No Surat` each appear TWICE in the source workbook
 * and the two occurrences are different fields (`keterangan_rangkap_1/_2`,
 * `nomor_surat_pg/_jg`, CLAUDE.md). An object keyed by header silently keeps
 * one of each. Positions keep both.
 */
import {
  LOOKUP_TYPES,
  type LookupType,
} from "../validation/lookupTypes";

/** The only sheet the Seed reads (PRD #1, ARCHITECTURE.md §4E). */
export const SHEET_NAME = "Demografi Karyawan - Posisi";

/** 1-based row holding the column headers; rows 1-3 are the report title. */
export const HEADER_ROW = 4;

// ---------------------------------------------------------------------------
// 1. Header canonicalisation
// ---------------------------------------------------------------------------

/**
 * Fold a header cell down to the key used for lookups in this module.
 *
 * NFKC, lowercase, every punctuation mark to a space, runs of whitespace
 * collapsed. So `"Teknik/Non Teknik"`, `"TEKNIK / NON TEKNIK"` and
 * `"teknik-non teknik"` all become `"teknik non teknik"`.
 *
 * This folds HEADERS only. Cell values are never folded — see the module
 * header.
 */
export function canonicalHeader(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The ~12 formula columns, ignored on sight (CLAUDE.md, ARCHITECTURE.md §4E).
 *
 * They are derived from columns the Seed *does* import, and derived values are
 * never stored (`lib/derived/`, the views). Importing them would freeze today's
 * arithmetic into the database and put two answers on the same question.
 *
 * Exact canonical matches. `"no"` is the row counter, and is exact so that
 * `"no surat pg"` is untouched; `"range"` is the age bucket, and is exact so
 * that `"bod range"` is untouched.
 */
export const IGNORED_FORMULA_HEADERS: readonly string[] = [
  "no",
  "age",
  "range",
  "gen",
  "pg jg",
];

/** Prefixes covering the rest: every "Masa …" and "Keterangan Naik …". */
export const IGNORED_FORMULA_PREFIXES: readonly string[] = [
  "masa",
  "keterangan naik",
];

/** True when this header is one of the derived columns the Seed skips. */
export function isIgnoredFormulaHeader(canonical: string): boolean {
  if (IGNORED_FORMULA_HEADERS.includes(canonical)) return true;
  return IGNORED_FORMULA_PREFIXES.some(
    (prefix) => canonical === prefix || canonical.startsWith(`${prefix} `),
  );
}

// ---------------------------------------------------------------------------
// 2. What a column can become
// ---------------------------------------------------------------------------

/** `employees` columns that take the cell text verbatim. */
export type EmployeeTextField =
  | "personnel_number"
  | "nip"
  | "full_name"
  | "keterangan_pj_plt"
  | "keterangan_rangkap_1"
  | "keterangan_rangkap_2"
  | "keterangan"
  | "jurusan"
  | "nomor_surat_pg"
  | "nomor_surat_jg";

/** `employees` columns of type `date`. */
export type EmployeeDateField =
  | "original_start_date"
  | "tanggal_diangkat"
  | "tanggal_promosi_pg"
  | "tanggal_promosi_jg"
  | "tanggal_keluar";

/** `employee_private` columns — Data Pribadi Sensitif (PRD #22). */
export type PrivateTextField = "place_of_birth" | "religion" | "marital_status";

/** The four levels the source workbook spells out, top to bottom. */
export type OrgLevel = "business_unit" | "divisi" | "bagian" | "sub_bagian";

/** What one spreadsheet column turns into. */
export type ColumnTarget =
  | { kind: "text"; field: EmployeeTextField }
  | { kind: "date"; field: EmployeeDateField }
  | { kind: "status" }
  | { kind: "org"; level: OrgLevel }
  | { kind: "jabatan" }
  | { kind: "lookup"; tipe: LookupType }
  | { kind: "private_text"; field: PrivateTextField }
  | { kind: "private_date" };

/**
 * Header → field. The heart of the unit; every entry is covered by a test.
 *
 * Several spellings per field on purpose: the workbook has never been seen
 * from here, and a header that is merely spelled differently should map, not
 * stop the Seed. What is NOT here is guessing — an unrecognised header is
 * reported by name and its data is dropped, so the admin can add the spelling
 * and run the dry run again.
 */
export const HEADER_TARGETS: ReadonlyArray<
  readonly [headers: readonly string[], target: ColumnTarget]
> = [
  // --- identity -----------------------------------------------------------
  [
    ["personnel number", "personnel no", "nomor personnel", "no personnel"],
    { kind: "text", field: "personnel_number" },
  ],
  [["nip", "no nip"], { kind: "text", field: "nip" }],
  [
    ["nama", "nama karyawan", "nama lengkap", "full name", "employee name"],
    { kind: "text", field: "full_name" },
  ],
  [["status", "status karyawan"], { kind: "status" }],

  // --- hierarchy (ARCHITECTURE.md §4E: BU -> Divisi -> Bagian -> Sub Bagian)
  [
    ["business unit", "unit bisnis"],
    { kind: "org", level: "business_unit" },
  ],
  [["divisi", "division"], { kind: "org", level: "divisi" }],
  [["bagian"], { kind: "org", level: "bagian" }],
  [["sub bagian", "subbagian", "sub bag"], { kind: "org", level: "sub_bagian" }],
  [["jabatan", "nama jabatan"], { kind: "jabatan" }],

  // --- lookups (the 11 tipe of lib/validation/lookupTypes.ts) --------------
  [["gender", "jenis kelamin"], { kind: "lookup", tipe: "gender" }],
  [
    ["work contract", "kontrak kerja"],
    { kind: "lookup", tipe: "work_contract" },
  ],
  [["person grade", "pg"], { kind: "lookup", tipe: "person_grade" }],
  [["job grade", "jg"], { kind: "lookup", tipe: "job_grade" }],
  [["legal entity"], { kind: "lookup", tipe: "legal_entity" }],
  [
    ["klasifikasi rekrutmen", "klasifikasi rekruitmen"],
    { kind: "lookup", tipe: "klasifikasi_rekrutmen" },
  ],
  [
    ["teknik non teknik"],
    { kind: "lookup", tipe: "teknik_non_teknik" },
  ],
  [["bod range", "range bod"], { kind: "lookup", tipe: "bod_range" }],
  [["band jabatan", "band"], { kind: "lookup", tipe: "band_jabatan" }],
  [
    ["kategori penempatan"],
    { kind: "lookup", tipe: "kategori_penempatan" },
  ],
  [["kategori fungsi"], { kind: "lookup", tipe: "kategori_fungsi" }],

  // --- free text straight from the sheet ----------------------------------
  [
    ["keterangan pj plt", "pj plt"],
    { kind: "text", field: "keterangan_pj_plt" },
  ],
  [["keterangan"], { kind: "text", field: "keterangan" }],
  [["jurusan"], { kind: "text", field: "jurusan" }],

  // --- dates --------------------------------------------------------------
  [
    ["original start date", "tanggal masuk", "tmt masuk"],
    { kind: "date", field: "original_start_date" },
  ],
  [
    ["tanggal diangkat", "tgl diangkat", "tmt diangkat"],
    { kind: "date", field: "tanggal_diangkat" },
  ],
  [
    ["tanggal promosi pg", "tgl promosi pg", "tmt pg"],
    { kind: "date", field: "tanggal_promosi_pg" },
  ],
  [
    ["tanggal promosi jg", "tgl promosi jg", "tmt jg"],
    { kind: "date", field: "tanggal_promosi_jg" },
  ],
  [
    ["tanggal keluar", "tgl keluar"],
    { kind: "date", field: "tanggal_keluar" },
  ],

  // --- Data Pribadi Sensitif -> employee_private (PRD #22) ----------------
  [
    ["tanggal lahir", "tgl lahir", "date of birth", "dob"],
    { kind: "private_date" },
  ],
  [
    ["tempat lahir", "place of birth"],
    { kind: "private_text", field: "place_of_birth" },
  ],
  [["agama", "religion"], { kind: "private_text", field: "religion" }],
  [
    ["status pernikahan", "status perkawinan", "marital status"],
    { kind: "private_text", field: "marital_status" },
  ],
];

/**
 * The two headers the source workbook repeats (CLAUDE.md).
 *
 * `Keterangan Rangkap` twice and `No Surat` twice. They are NOT the same field
 * and must never be merged: the first occurrence is slot 1 / PG, the second is
 * slot 2 / JG, in sheet order. A workbook that spells them out
 * ("No Surat PG" / "No Surat JG") skips this path entirely — those spellings
 * are ordinary entries in `HEADER_TARGETS_EXPLICIT` below.
 */
export const DUPLICATE_HEADER_GROUPS: ReadonlyArray<{
  readonly headers: readonly string[];
  readonly slots: readonly EmployeeTextField[];
}> = [
  {
    headers: ["keterangan rangkap"],
    slots: ["keterangan_rangkap_1", "keterangan_rangkap_2"],
  },
  {
    headers: ["no surat", "nomor surat"],
    slots: ["nomor_surat_pg", "nomor_surat_jg"],
  },
];

/** Disambiguated spellings of the duplicated headers, if the file has them. */
const HEADER_TARGETS_EXPLICIT: ReadonlyArray<
  readonly [readonly string[], ColumnTarget]
> = [
  [
    ["keterangan rangkap 1", "keterangan rangkap i"],
    { kind: "text", field: "keterangan_rangkap_1" },
  ],
  [
    ["keterangan rangkap 2", "keterangan rangkap ii"],
    { kind: "text", field: "keterangan_rangkap_2" },
  ],
  [
    ["no surat pg", "nomor surat pg"],
    { kind: "text", field: "nomor_surat_pg" },
  ],
  [
    ["no surat jg", "nomor surat jg"],
    { kind: "text", field: "nomor_surat_jg" },
  ],
];

const TARGET_BY_HEADER: ReadonlyMap<string, ColumnTarget> = new Map(
  [...HEADER_TARGETS, ...HEADER_TARGETS_EXPLICIT].flatMap(
    ([headers, target]) =>
      headers.map((header) => [header, target] as const),
  ),
);

// ---------------------------------------------------------------------------
// 3. Issues — everything the Seed noticed and refuses to silently swallow
// ---------------------------------------------------------------------------

export type SeedIssueLevel = "error" | "peringatan";

/**
 * One thing worth telling the admin about, in Indonesian (the handover
 * audience reads this, not a developer).
 *
 * `error` stops the Seed. `peringatan` does not: dirty data is expected and
 * PRD #11 has a page for it.
 */
export type SeedIssue = {
  level: SeedIssueLevel;
  /** Machine-readable, for tests and for grouping in the report. */
  kode: string;
  pesan: string;
  /** 1-based sheet row, when the issue belongs to a row. */
  baris?: number;
  /** The header exactly as the sheet spells it. */
  kolom?: string;
};

// ---------------------------------------------------------------------------
// 4. The header plan
// ---------------------------------------------------------------------------

/** One resolved spreadsheet column. */
export type PlannedColumn = {
  /** 0-based position in the row array. */
  index: number;
  /** The header exactly as written in the sheet. */
  header: string;
  target: ColumnTarget;
};

export type HeaderPlan = {
  columns: readonly PlannedColumn[];
  /** Headers matched against the formula list and skipped, in sheet order. */
  ignored: readonly string[];
  /** Headers nothing in the table recognised. Their data is dropped. */
  unknown: readonly string[];
  issues: readonly SeedIssue[];
};

/** Without these two columns there is no Karyawan to insert. */
const REQUIRED_TEXT_FIELDS: readonly EmployeeTextField[] = [
  "personnel_number",
  "full_name",
];

/**
 * Resolve every header cell to a field, an ignored formula, or "unknown".
 *
 * Left to right, because that is what makes the repeated headers resolvable:
 * the first `No Surat` is PG, the second is JG.
 */
export function buildHeaderPlan(headerCells: readonly unknown[]): HeaderPlan {
  const columns: PlannedColumn[] = [];
  const ignored: string[] = [];
  const unknown: string[] = [];
  const issues: SeedIssue[] = [];

  /** How many slots of each duplicate group are already spoken for. */
  const duplicateUsage = new Map<number, number>();
  /** Fields already claimed, so a genuinely repeated column is reported. */
  const claimed = new Map<string, string>();

  headerCells.forEach((cell, index) => {
    const header = cell === null || cell === undefined ? "" : String(cell).trim();
    const canonical = canonicalHeader(cell);
    if (canonical === "") return; // empty spacer column

    if (isIgnoredFormulaHeader(canonical)) {
      ignored.push(header);
      return;
    }

    const duplicateGroup = DUPLICATE_HEADER_GROUPS.findIndex((group) =>
      group.headers.includes(canonical),
    );
    if (duplicateGroup >= 0) {
      const group = DUPLICATE_HEADER_GROUPS[duplicateGroup];
      // Skip slots an explicit spelling already took, so a sheet that writes
      // "No Surat PG" and then a bare "No Surat" fills PG and JG rather than
      // filling PG twice and leaving JG empty for everyone.
      let used = duplicateUsage.get(duplicateGroup) ?? 0;
      while (
        used < group.slots.length &&
        claimed.has(targetKey({ kind: "text", field: group.slots[used] }))
      ) {
        used += 1;
      }
      const field = group.slots[used];
      if (field === undefined) {
        issues.push({
          level: "peringatan",
          kode: "kolom_kembar_berlebih",
          kolom: header,
          // NOT filed under "tidak dikenal": the header IS recognised, there is
          // simply no third slot, and telling the admin to add a spelling would
          // send them somewhere that cannot help.
          pesan: `Kolom "${header}" muncul lebih dari ${group.slots.length} kali padahal cuma ${group.slots.length} tujuan yang ada (${group.slots.join(", ")}) — kolom ini diabaikan.`,
        });
        return;
      }
      duplicateUsage.set(duplicateGroup, used + 1);
      columns.push({ index, header, target: { kind: "text", field } });
      claimed.set(targetKey({ kind: "text", field }), header);
      return;
    }

    const target = TARGET_BY_HEADER.get(canonical);
    if (!target) {
      unknown.push(header);
      issues.push({
        level: "peringatan",
        kode: "kolom_tidak_dikenal",
        kolom: header,
        pesan: `Kolom "${header}" tidak dikenal dan tidak disimpan. Tambahkan ejaannya di scripts/lib/excelMapping.ts kalau kolom ini memang perlu masuk.`,
      });
      return;
    }

    const key = targetKey(target);
    const previous = claimed.get(key);
    if (previous !== undefined) {
      issues.push({
        level: "peringatan",
        kode: "kolom_ganda",
        kolom: header,
        pesan: `Kolom "${header}" memetakan ke tujuan yang sama dengan "${previous}" — yang terakhir dipakai.`,
      });
    }
    claimed.set(key, header);
    columns.push({ index, header, target });
  });

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!claimed.has(`text:${field}`)) {
      issues.push({
        level: "error",
        kode: "kolom_wajib_hilang",
        pesan: `Kolom wajib "${field}" tidak ada di baris header. Periksa nomor baris header (--header-row) dan nama sheet.`,
      });
    }
  }

  return { columns, ignored, unknown, issues };
}

/** Stable identity of a target, used to spot two columns claiming one field. */
function targetKey(target: ColumnTarget): string {
  switch (target.kind) {
    case "text":
      return `text:${target.field}`;
    case "date":
      return `date:${target.field}`;
    case "private_text":
      return `private:${target.field}`;
    case "private_date":
      return "private:date_of_birth";
    case "lookup":
      return `lookup:${target.tipe}`;
    case "org":
      return `org:${target.level}`;
    case "jabatan":
      return "jabatan";
    case "status":
      return "status";
  }
}

// ---------------------------------------------------------------------------
// 5. Cell values
// ---------------------------------------------------------------------------

/** Formula error literals. VLOOKUP columns are full of these (CLAUDE.md). */
const EXCEL_ERROR_VALUES = new Set([
  "#N/A",
  "#REF!",
  "#VALUE!",
  "#NAME?",
  "#DIV/0!",
  "#NULL!",
  "#NUM!",
  "#SPILL!",
  "#CALC!",
  "#GETTING_DATA",
]);

export function isExcelError(value: unknown): boolean {
  return typeof value === "string" && EXCEL_ERROR_VALUES.has(value.trim().toUpperCase());
}

/**
 * A cell as text: trimmed, and nothing else.
 *
 * Trim is the ONLY cleaning the Seed performs (ARCHITECTURE.md §4E). Empty,
 * whitespace-only and Excel error cells become `null`; numbers become their
 * plain decimal spelling, because a Personnel Number stored as a number must
 * not come back as `1.23457e+7`.
 */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Integers are the normal case (Personnel Number, NIP). `toFixed` keeps
    // large ones out of exponential notation.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoFromDateParts(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
  );
  const text = String(value).trim();
  if (text === "") return null;
  if (isExcelError(text)) return null;
  return text;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function isoFromDateParts(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Excel serial number → `YYYY-MM-DD`.
 *
 * TIMEZONE: none. An Excel date cell is a calendar date with no zone, and the
 * `date` columns in Postgres are the same, so the conversion is pure integer
 * arithmetic on the serial — no `Date`, no local time, no DST, no off-by-one
 * when the Seed is run from a machine east of UTC. The fractional part (time
 * of day) is discarded.
 *
 * THE 1900 BUG: the 1900 date system pretends 1900 was a leap year, so serial
 * 60 is a date that never existed and everything from 61 on is "days since
 * 1899-12-30". Serials 1-59 are "days since 1899-12-31". Serial 60 itself is
 * refused rather than silently shifted.
 *
 * The 1904 system (old Mac workbooks) counts from 1904-01-01 with no such bug;
 * pass `date1904` when `wb.Workbook.WBProps.date1904` is set.
 */
export function excelSerialToIsoDate(
  serial: number,
  date1904 = false,
): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (date1904) {
    if (whole < 0) return null;
    return isoFromEpochDays(whole + daysFromCivil(1904, 1, 1));
  }
  if (whole < 1) return null;
  if (whole === 60) return null; // 1900-02-29 — a date Excel invented
  const offset = whole < 60 ? daysFromCivil(1899, 12, 31) : daysFromCivil(1899, 12, 30);
  return isoFromEpochDays(whole + offset);
}

/** Days from 1970-01-01 to y-m-d (Howard Hinnant's civil_from_days, inverted). */
function daysFromCivil(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function isoFromEpochDays(z0: number): string {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return isoFromDateParts(m <= 2 ? y + 1 : y, m, d);
}

export type DateCellResult =
  | { ok: true; iso: string | null }
  | { ok: false; raw: string };

/**
 * The smallest number a date cell may hold before it is reported instead of
 * converted. 10000 is 1927-05-18.
 *
 * A four-digit number in a date column is a year somebody typed when only the
 * year was known ("1990"), and reading it as a serial would invent 1905-06-12
 * as that person's date of birth — in a column that goes into
 * `employee_private`. No date HC Core cares about (birth, hire, promotion, exit)
 * falls before 1927, so nothing real is lost and a lone year becomes the
 * `tanggal_tidak_terbaca` error it is.
 */
const MIN_PLAUSIBLE_SERIAL = 10_000;

/**
 * A date cell → `YYYY-MM-DD`, whichever way the cell was authored.
 *
 * Three shapes reach here, and which one depends on how somebody typed the
 * cell years ago, not on anything the Seed controls:
 *   * a number — the serial, the normal case for a real date cell;
 *   * a `Date` — when the reader was asked for `cellDates`;
 *   * a string — a date typed into a text-formatted cell.
 *
 * String dates are read as **day first** (`31/12/2019`, `31-12-2019`,
 * `31.12.2019`) plus ISO `2019-12-31`, because the source workbook is
 * Indonesian. `03/04/2019` is therefore 3 April, never 3 March. A string that
 * matches nothing returns `ok: false` and becomes an error — a date silently
 * turned into NULL is a fact about a person quietly deleted.
 */
export function parseDateCell(value: unknown, date1904 = false): DateCellResult {
  if (value === null || value === undefined) return { ok: true, iso: null };
  if (typeof value === "number") {
    // Serial 0 is what Excel stores when a date column is a formula pointing at
    // a blank cell (`=A1` on an empty A1). That is a blank, not 1899-12-30, and
    // the source workbook is full of formula columns — treating it as an error
    // would stop the whole Seed with a message the admin cannot act on.
    if (value === 0) return { ok: true, iso: null };
    if (value > 0 && value < MIN_PLAUSIBLE_SERIAL) return { ok: false, raw: String(value) };
    const iso = excelSerialToIsoDate(value, date1904);
    return iso ? { ok: true, iso } : { ok: false, raw: String(value) };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false, raw: "Invalid Date" };
    // SheetJS builds its `cellDates` values from the serial in UTC, so the UTC
    // parts are the calendar date the workbook meant.
    return {
      ok: true,
      iso: isoFromDateParts(
        value.getUTCFullYear(),
        value.getUTCMonth() + 1,
        value.getUTCDate(),
      ),
    };
  }

  const text = String(value).trim();
  if (text === "" || text === "0" || isExcelError(text)) return { ok: true, iso: null };

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return fromParts(+iso[1], +iso[2], +iso[3], text);

  const dayFirst = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dayFirst) return fromParts(+dayFirst[3], +dayFirst[2], +dayFirst[1], text);

  // A serial that arrived as text ("43678"), which happens after a CSV detour.
  if (/^\d+$/.test(text) && Number(text) >= MIN_PLAUSIBLE_SERIAL) {
    const fromSerial = excelSerialToIsoDate(Number(text), date1904);
    if (fromSerial) return { ok: true, iso: fromSerial };
  }

  return { ok: false, raw: text };
}

function fromParts(
  year: number,
  month: number,
  day: number,
  raw: string,
): DateCellResult {
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, raw };
  const iso = isoFromDateParts(year, month, day);
  // Round-trip guard: catches 31 February and friends.
  if (isoFromEpochDays(daysFromCivil(year, month, day)) !== iso) {
    return { ok: false, raw };
  }
  return { ok: true, iso };
}

// ---------------------------------------------------------------------------
// 6. Kode generation
// ---------------------------------------------------------------------------

/**
 * `kode` for a Data Referensi row, derived from its name.
 *
 * The workbook has no codes, and `org_units.kode` / `jabatan.kode` /
 * `lookups.kode` are NOT NULL and stable-forever, so the Seed has to mint them.
 * A slug of the name is chosen over a counter because staf HC read these in the
 * UI and in the API, and `DIV-QHSSE` is a thing a person can recognise while
 * `OU-000317` is not.
 *
 * Deliberately lossy — "Divisi QHSSE" and "DIVISI QHSSE" slug to the same
 * thing. That is NOT a merge: the caller's registry appends `-2`, so both rows
 * exist with both spellings intact in `nama`, and the Merge that joins them
 * stays the admin's decision (ADR-002).
 */
export function slugKode(value: string, maxLength = 40): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug === "" ? "X" : slug;
}

/** Hands out unique `kode` values within one namespace, in first-seen order. */
export class KodeRegistry {
  private readonly used = new Set<string>();

  constructor(private readonly prefix = "") {}

  /** `prefix + slug`, with `-2`, `-3` … appended until it is free. */
  next(value: string): string {
    const base = `${this.prefix}${slugKode(value)}`;
    if (!this.used.has(base)) {
      this.used.add(base);
      return base;
    }
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. The plan
// ---------------------------------------------------------------------------

/** One `org_units` row to create. */
export type PlannedOrgUnit = {
  /** Identity inside the plan: the full path, so two "Bagian Umum" stay two. */
  key: string;
  kode: string;
  /** The value from the sheet, trimmed and otherwise untouched. */
  nama: string;
  tipe: "direktorat" | "divisi" | "bagian" | "sub_bagian" | "proyek";
  parentKey: string | null;
};

/** One `jabatan` row to create. */
export type PlannedJabatan = { key: string; kode: string; nama: string };

/** One `lookups` row to create. */
export type PlannedLookup = {
  key: string;
  tipe: LookupType;
  kode: string;
  label: string;
  urutan: number;
};

/** One `employees` row (+ its `employee_private` update) to create. */
export type PlannedEmployee = {
  /** 1-based sheet row, for the report. */
  baris: number;
  personnel_number: string;
  nip: string | null;
  full_name: string;
  status: "aktif" | "nonaktif";
  /** Lowest Unit Organisasi in this row's chain (ARCHITECTURE.md §3). */
  orgUnitKey: string | null;
  jabatanKey: string | null;
  lookupKeys: Partial<Record<LookupType, string>>;
  text: Partial<Record<EmployeeTextField, string>>;
  dates: Partial<Record<EmployeeDateField, string>>;
  /** Data Pribadi Sensitif — updated into the trigger-created row (PRD #22). */
  private: {
    date_of_birth: string | null;
    place_of_birth: string | null;
    religion: string | null;
    marital_status: string | null;
  };
};

export type SeedPlan = {
  headerPlan: HeaderPlan;
  orgUnits: readonly PlannedOrgUnit[];
  jabatan: readonly PlannedJabatan[];
  lookups: readonly PlannedLookup[];
  employees: readonly PlannedEmployee[];
  issues: readonly SeedIssue[];
  stats: {
    /** Rows below the header, blank ones included. */
    barisDibaca: number;
    /** Rows that were entirely empty and skipped. */
    barisKosong: number;
    /** Karyawan with at least one Data Pribadi Sensitif value. */
    karyawanDenganDataPribadi: number;
  };
};

export type PlanSeedOptions = {
  /** 1-based, default `HEADER_ROW` (4). */
  headerRowNumber?: number;
  /** `wb.Workbook?.WBProps?.date1904`. */
  date1904?: boolean;
};

const ORG_LEVEL_ORDER: readonly OrgLevel[] = [
  "business_unit",
  "divisi",
  "bagian",
  "sub_bagian",
];

const ORG_LEVEL_TIPE: Record<OrgLevel, PlannedOrgUnit["tipe"]> = {
  business_unit: "direktorat",
  divisi: "divisi",
  bagian: "bagian",
  sub_bagian: "sub_bagian",
};

/** A Bagian whose name starts with "Proyek" is a proyek (ARCHITECTURE.md §4E). */
const PROYEK_PREFIX = /^proyek\b/i;

/**
 * The whole sheet → everything the Seed will write.
 *
 * `rows` is the sheet as an array of arrays, title rows included, so that every
 * issue can name the row number a person sees in Excel.
 */
export function planSeed(
  rows: readonly (readonly unknown[])[],
  options: PlanSeedOptions = {},
): SeedPlan {
  const headerRowNumber = options.headerRowNumber ?? HEADER_ROW;
  const date1904 = options.date1904 ?? false;

  const headerCells = rows[headerRowNumber - 1] ?? [];
  const headerPlan = buildHeaderPlan(headerCells);
  const issues: SeedIssue[] = [...headerPlan.issues];

  const orgUnits: PlannedOrgUnit[] = [];
  const orgByKey = new Map<string, PlannedOrgUnit>();
  const orgKodes = new KodeRegistry("OU-");

  const jabatan: PlannedJabatan[] = [];
  const jabatanByKey = new Map<string, PlannedJabatan>();
  const jabatanKodes = new KodeRegistry("JB-");

  const lookups: PlannedLookup[] = [];
  const lookupByKey = new Map<string, PlannedLookup>();
  const lookupKodes = new Map<LookupType, KodeRegistry>(
    LOOKUP_TYPES.map((tipe) => [tipe, new KodeRegistry()] as const),
  );
  const kodeRegistryFor = (tipe: LookupType): KodeRegistry => {
    const existing = lookupKodes.get(tipe);
    if (existing) return existing;
    const created = new KodeRegistry();
    lookupKodes.set(tipe, created);
    return created;
  };
  const lookupUrutan = new Map<LookupType, number>();

  const employees: PlannedEmployee[] = [];
  const seenPersonnelNumber = new Map<string, number>();
  const seenNip = new Map<string, number>();

  let barisDibaca = 0;
  let barisKosong = 0;
  let karyawanDenganDataPribadi = 0;

  const dataRows = rows.slice(headerRowNumber);

  dataRows.forEach((row, offset) => {
    const baris = headerRowNumber + 1 + offset;
    barisDibaca += 1;

    const values = new Map<PlannedColumn, string | null>();
    let anyValue = false;
    for (const column of headerPlan.columns) {
      const raw = row[column.index];
      const text = column.target.kind === "date" || column.target.kind === "private_date"
        ? rawForDate(raw)
        : cellText(raw);
      if (text !== null) anyValue = true;
      values.set(column, text);
    }

    if (!anyValue) {
      barisKosong += 1;
      return;
    }

    /**
     * The value for a target, when two columns claim the same one.
     *
     * The LAST non-empty column wins — the same rule the plain-text loop below
     * uses, and the one `kolom_ganda` promises the admin ("yang terakhir
     * dipakai"). Taking the first match regardless of emptiness would let a
     * blank "Status" column hide a filled "Status Karyawan" one and seed a
     * leaver as aktif, which is exactly the kind of silence this module exists
     * to avoid.
     */
    const textOf = (predicate: (t: ColumnTarget) => boolean): string | null => {
      let result: string | null = null;
      for (const column of headerPlan.columns) {
        if (!predicate(column.target)) continue;
        const value = values.get(column) ?? null;
        if (value !== null) result = value;
      }
      return result;
    };

    // --- identity ---------------------------------------------------------
    const personnelNumber = textOf(
      (t) => t.kind === "text" && t.field === "personnel_number",
    );
    const fullName = textOf((t) => t.kind === "text" && t.field === "full_name");

    if (personnelNumber === null) {
      issues.push({
        level: "error",
        baris,
        kode: "personnel_number_kosong",
        pesan: `Baris ${baris} tidak punya Personnel Number — baris ini tidak bisa diseed (Personnel Number adalah business key).`,
      });
      return;
    }
    if (fullName === null) {
      issues.push({
        level: "error",
        baris,
        kode: "nama_kosong",
        pesan: `Baris ${baris} (Personnel Number ${personnelNumber}) tidak punya Nama.`,
      });
      return;
    }

    const duplicatePn = seenPersonnelNumber.get(personnelNumber);
    if (duplicatePn !== undefined) {
      issues.push({
        level: "error",
        baris,
        kode: "personnel_number_ganda",
        pesan: `Personnel Number ${personnelNumber} muncul dua kali (baris ${duplicatePn} dan ${baris}). Kolom ini UNIQUE di database, jadi seluruh Seed akan gagal.`,
      });
      return;
    }
    seenPersonnelNumber.set(personnelNumber, baris);

    const nip = textOf((t) => t.kind === "text" && t.field === "nip");
    if (nip !== null) {
      const duplicateNip = seenNip.get(nip);
      if (duplicateNip !== undefined) {
        issues.push({
          level: "error",
          baris,
          kode: "nip_ganda",
          pesan: `NIP ${nip} muncul dua kali (baris ${duplicateNip} dan ${baris}). Kolom ini UNIQUE di database, jadi seluruh Seed akan gagal.`,
        });
        return;
      }
      seenNip.set(nip, baris);
    }

    // --- hierarchy --------------------------------------------------------
    const levelValues = new Map<OrgLevel, string>();
    for (const level of ORG_LEVEL_ORDER) {
      const value = textOf((t) => t.kind === "org" && t.level === level);
      if (value !== null) levelValues.set(level, value);
    }

    let parentKey: string | null = null;
    let lowestKey: string | null = null;
    for (const level of ORG_LEVEL_ORDER) {
      const nama = levelValues.get(level);
      if (nama === undefined) continue;

      // "If Sub Bagian equals Bagian, do not create a child node"
      // (ARCHITECTURE.md §4E). Compared exactly, trimmed: a case variant is a
      // real Temuan for the Bereskan page (PRD #11), not something the Seed
      // quietly decides.
      if (level === "sub_bagian" && levelValues.get("bagian") === nama) continue;

      const key: string = `${parentKey ?? ""}\u0000${level}\u0000${nama}`;
      let unit = orgByKey.get(key);
      if (!unit) {
        const tipe =
          level === "bagian" && PROYEK_PREFIX.test(nama)
            ? "proyek"
            : ORG_LEVEL_TIPE[level];
        unit = { key, kode: orgKodes.next(nama), nama, tipe, parentKey };
        orgByKey.set(key, unit);
        orgUnits.push(unit);
      }
      parentKey = key;
      lowestKey = key;
    }

    if (lowestKey === null) {
      issues.push({
        level: "peringatan",
        baris,
        kode: "karyawan_tanpa_unit",
        pesan: `Baris ${baris} (${personnelNumber}) tidak punya Unit Organisasi — muncul di halaman Perlu Dibereskan.`,
      });
    }

    // --- jabatan ----------------------------------------------------------
    const jabatanNama = textOf((t) => t.kind === "jabatan");
    let jabatanKey: string | null = null;
    if (jabatanNama !== null) {
      jabatanKey = jabatanNama;
      if (!jabatanByKey.has(jabatanKey)) {
        const row2: PlannedJabatan = {
          key: jabatanKey,
          kode: jabatanKodes.next(jabatanNama),
          nama: jabatanNama,
        };
        jabatanByKey.set(jabatanKey, row2);
        jabatan.push(row2);
      }
    } else {
      issues.push({
        level: "peringatan",
        baris,
        kode: "karyawan_tanpa_jabatan",
        pesan: `Baris ${baris} (${personnelNumber}) tidak punya Jabatan — muncul di halaman Perlu Dibereskan.`,
      });
    }

    // --- lookups ----------------------------------------------------------
    const lookupKeys: Partial<Record<LookupType, string>> = {};
    for (const column of headerPlan.columns) {
      if (column.target.kind !== "lookup") continue;
      const label = values.get(column) ?? null;
      if (label === null) continue;
      const tipe = column.target.tipe;
      const key = `${tipe}\u0000${label}`;
      if (!lookupByKey.has(key)) {
        const urutan = (lookupUrutan.get(tipe) ?? 0) + 1;
        lookupUrutan.set(tipe, urutan);
        const row2: PlannedLookup = {
          key,
          tipe,
          kode: kodeRegistryFor(tipe).next(label),
          label,
          urutan,
        };
        lookupByKey.set(key, row2);
        lookups.push(row2);
      }
      lookupKeys[tipe] = key;
    }

    // --- plain text -------------------------------------------------------
    const text: Partial<Record<EmployeeTextField, string>> = {};
    for (const column of headerPlan.columns) {
      if (column.target.kind !== "text") continue;
      if (column.target.field === "personnel_number") continue;
      if (column.target.field === "nip") continue;
      if (column.target.field === "full_name") continue;
      const value = values.get(column) ?? null;
      if (value !== null) text[column.target.field] = value;
    }

    // --- dates ------------------------------------------------------------
    const dates: Partial<Record<EmployeeDateField, string>> = {};
    let dateOfBirth: string | null = null;
    let dateFailed = false;
    for (const column of headerPlan.columns) {
      const target = column.target;
      if (target.kind !== "date" && target.kind !== "private_date") continue;
      const parsed = parseDateCell(row[column.index], date1904);
      if (!parsed.ok) {
        dateFailed = true;
        issues.push({
          level: "error",
          baris,
          kolom: column.header,
          kode: "tanggal_tidak_terbaca",
          pesan: `Baris ${baris} (${personnelNumber}), kolom "${column.header}": "${parsed.raw}" bukan tanggal yang bisa dibaca. Tanggal teks dibaca hari-dulu (31/12/2019) atau ISO (2019-12-31).`,
        });
        continue;
      }
      if (parsed.iso === null) continue;
      if (target.kind === "private_date") dateOfBirth = parsed.iso;
      else dates[target.field] = parsed.iso;
    }
    if (dateFailed) return;

    // --- Data Pribadi Sensitif -------------------------------------------
    const privateRow = {
      date_of_birth: dateOfBirth,
      place_of_birth: textOf(
        (t) => t.kind === "private_text" && t.field === "place_of_birth",
      ),
      religion: textOf((t) => t.kind === "private_text" && t.field === "religion"),
      marital_status: textOf(
        (t) => t.kind === "private_text" && t.field === "marital_status",
      ),
    };
    if (Object.values(privateRow).some((value) => value !== null)) {
      karyawanDenganDataPribadi += 1;
    }

    // --- status -----------------------------------------------------------
    const statusRaw = textOf((t) => t.kind === "status");
    let status: "aktif" | "nonaktif" = "aktif";
    if (statusRaw !== null) {
      const folded = statusRaw.toLowerCase();
      if (folded === "nonaktif" || folded === "non aktif" || folded === "non-aktif") {
        status = "nonaktif";
      } else if (folded !== "aktif") {
        issues.push({
          level: "peringatan",
          baris,
          kode: "status_tidak_dikenal",
          pesan: `Baris ${baris} (${personnelNumber}): status "${statusRaw}" tidak dikenal — diseed sebagai "aktif".`,
        });
      }
    }
    if (status === "aktif" && dates.tanggal_keluar !== undefined) {
      issues.push({
        level: "peringatan",
        baris,
        kode: "keluar_tapi_aktif",
        pesan: `Baris ${baris} (${personnelNumber}) punya Tanggal Keluar (${dates.tanggal_keluar}) tapi status "aktif" — diseed apa adanya, ubah lewat aplikasi kalau perlu.`,
      });
    }

    employees.push({
      baris,
      personnel_number: personnelNumber,
      nip,
      full_name: fullName,
      status,
      orgUnitKey: lowestKey,
      jabatanKey,
      lookupKeys,
      text,
      dates,
      private: privateRow,
    });
  });

  if (employees.length === 0) {
    issues.push({
      level: "error",
      kode: "tidak_ada_karyawan",
      pesan:
        "Tidak ada satu pun baris Karyawan yang bisa dibaca. Periksa nama sheet dan nomor baris header.",
    });
  }

  return {
    headerPlan,
    orgUnits,
    jabatan,
    lookups,
    employees,
    issues,
    stats: { barisDibaca, barisKosong, karyawanDenganDataPribadi },
  };
}

/**
 * Date columns keep their raw cell for `parseDateCell`, but the "is this row
 * empty?" test still needs to know whether something was there.
 */
function rawForDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  const text = String(raw).trim();
  if (text === "" || isExcelError(text)) return null;
  return text;
}

/** Only the blocking issues — the Seed refuses to write when this is non-empty. */
export function errorsOf(plan: SeedPlan): readonly SeedIssue[] {
  return plan.issues.filter((issue) => issue.level === "error");
}

/** Everything else: dirty data that is *meant* to land (ADR-002, PRD #11). */
export function warningsOf(plan: SeedPlan): readonly SeedIssue[] {
  return plan.issues.filter((issue) => issue.level === "peringatan");
}
