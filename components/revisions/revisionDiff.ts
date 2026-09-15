/**
 * Turning a `revisions` row into something staf HC can actually read.
 *
 * `revisions.before` / `revisions.after` are whole-row jsonb snapshots, which
 * means a raw diff reads like this:
 *
 *     org_unit_id: "3f2a…" → "9b1c…"
 *     updated_at:  "2026-09-14T11:02:03.114Z" → "2026-09-14T11:44:51.009Z"
 *
 * Neither line tells an HC staffer anything. Everything in this file exists to
 * turn that into:
 *
 *     Unit Organisasi: Divisi QHSSE (DIV-QHSSE) → Divisi QHSSE Korporat (DIV-QHSSEK)
 *
 * Three jobs, all of them pure so they can be reasoned about (and reused by
 * both `RevisionPanel` and the Log Perubahan page):
 *
 *   1. **Which columns actually moved** — `diffRevision()`. Showing all 30
 *      columns of a Karyawan buries the one that changed; `created_at` and
 *      `updated_at` are the row's own bookkeeping and are never shown.
 *   2. **What each column is called in Indonesian** — `COLUMN_LABELS`, worded
 *      exactly as the zod schemas in `lib/validation/` word them, so the same
 *      column is not "Nama" on the form and "full_name" in the log.
 *   3. **What a value means** — `formatValue()`. A uuid becomes the name of the
 *      Unit Organisasi / Jabatan / Lookup it points at (via a label map the
 *      caller resolves with `resolveRevisionLabels`), a date becomes
 *      "14 Sep 2026", `null` becomes "(kosong)", and `api_keys.key_hash` is
 *      never rendered at all.
 *
 * No React, no database, no `Date.now()`: the only impure thing a caller needs
 * is the uuid → label map, and that is passed in.
 */
import {
  emptyReferenceIds,
  isEmptyReferenceIds,
  REFERENCE_ENTITIES,
  type ReferenceEntity,
  type ReferenceIds,
  type ReferenceLabels,
} from "@/lib/revisions/references";
import {
  columnsOf,
  isLoggedTable,
  LOGGED_TABLE_LABELS,
  NON_RESTORABLE_COLUMNS,
  PK_COLUMN_BY_TABLE,
  type LoggedTable,
} from "@/lib/revisions/tables";
import type { Json, Revision } from "@/lib/types/db";
import { ORG_UNIT_TYPE_LABELS, ROLE_LABELS, STATUS_LABELS } from "@/lib/i18n/terms";
import {
  isLookupType,
  LOOKUP_TYPE_LABELS,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
  type LookupType,
} from "@/lib/validation/lookupTypes";
import { isUuid } from "@/lib/validation/uuid";

/** Shown wherever a column holds no value. Not "—": this is a diff cell. */
export const KOSONG = "(kosong)";

/** Shown instead of a value that must never reach the screen. */
export const DISEMBUNYIKAN = "(disembunyikan)";

/** Shown when a uuid could not be resolved to a name (see `formatValue`). */
export const TIDAK_DIKENAL = "(tidak dikenal)";

/** Jakarta time, always — the reader is in Jakarta and so is the office. */
const TIME_ZONE = "Asia/Jakarta";

// ---------------------------------------------------------------------------
// References: which columns hold a uuid, and what it points at
// ---------------------------------------------------------------------------

/**
 * The reference vocabulary (`ReferenceEntity`, `ReferenceIds`,
 * `ReferenceLabels`, the empty/merge helpers) lives in
 * `lib/revisions/references.ts`, so `lib/db/labels.ts` can read the same shape
 * without importing from `components/`. Re-exported here so `RevisionCard`,
 * `useReferenceLabels` and the Log Perubahan page keep one import path.
 */
export { emptyReferenceIds, isEmptyReferenceIds, REFERENCE_ENTITIES };
export type { ReferenceEntity, ReferenceIds, ReferenceLabels };

/** The `employees` lookup columns, derived from the frozen tipe → kolom map. */
const EMPLOYEE_LOOKUP_COLUMN_TO_TYPE: Record<string, LookupType> =
  Object.fromEntries(
    Object.entries(LOOKUP_TYPE_TO_EMPLOYEE_COLUMN).map(([tipe, column]) => [
      column,
      tipe as LookupType,
    ]),
  );

/**
 * Every FK column of every logged table, and the table it points at.
 *
 * Mirrors the foreign keys in `supabase/migrations/0001_init.sql`. A column
 * missing here is rendered as plain text, which is the safe failure: a uuid on
 * screen is ugly, a wrong name is a lie.
 */
export const REFERENCE_COLUMNS: Record<
  LoggedTable,
  Readonly<Record<string, ReferenceEntity>>
> = {
  employees: {
    org_unit_id: "org_units",
    jabatan_id: "jabatan",
    ...Object.fromEntries(
      Object.keys(EMPLOYEE_LOOKUP_COLUMN_TO_TYPE).map((column) => [
        column,
        "lookups" as ReferenceEntity,
      ]),
    ),
  },
  employee_private: {},
  org_units: { parent_id: "org_units", merged_into_id: "org_units" },
  jabatan: { merged_into_id: "jabatan" },
  lookups: { merged_into_id: "lookups" },
  api_keys: {},
  profiles: {},
};

/**
 * The table a Revisi's own `row_id` points at, when the row itself needs a
 * name from elsewhere.
 *
 * Only `employee_private`: its `row_id` is an `employees.id`, and "Data Pribadi
 * Sensitif — 8f1c…" is not a heading anybody can use.
 */
const ROW_REFERENCE: Partial<Record<LoggedTable, ReferenceEntity>> = {
  employee_private: "employees",
};

/** The parts of a Revisi this module reads. */
export type RevisionLike = Pick<
  Revision,
  "table_name" | "row_id" | "before" | "after" | "actor_id"
>;

/**
 * Collect every uuid these Revisi will want a name for.
 *
 * Both snapshots are scanned, because a diff shows both sides: an edit that
 * moved someone between two Unit Organisasi needs both names. `actor_id` is
 * collected too — "siapa" is half of what PRD #13 promises.
 */
export function collectReferenceIds(
  revisions: readonly RevisionLike[],
): ReferenceIds {
  const sets: Record<ReferenceEntity, Set<string>> = {
    org_units: new Set(),
    jabatan: new Set(),
    lookups: new Set(),
    employees: new Set(),
    profiles: new Set(),
  };

  for (const revision of revisions) {
    if (isUuid(revision.actor_id)) sets.profiles.add(revision.actor_id);

    const table = revision.table_name;
    if (!isLoggedTable(table)) continue;

    const rowEntity = ROW_REFERENCE[table];
    if (rowEntity && isUuid(revision.row_id)) sets[rowEntity].add(revision.row_id);

    const columns = REFERENCE_COLUMNS[table];
    for (const snapshot of [revision.before, revision.after]) {
      const row = asObject(snapshot);
      if (!row) continue;
      for (const [column, entity] of Object.entries(columns)) {
        const value = row[column];
        if (isUuid(value)) sets[entity].add(value);
      }
    }
  }

  const ids = emptyReferenceIds();
  for (const entity of REFERENCE_ENTITIES) {
    ids[entity] = [...sets[entity]].sort();
  }
  return ids;
}

/** Merge two id sets — the Log Perubahan collects Batch actors separately. */
export function mergeReferenceIds(
  a: ReferenceIds,
  b: ReferenceIds,
): ReferenceIds {
  const ids = emptyReferenceIds();
  for (const entity of REFERENCE_ENTITIES) {
    ids[entity] = [...new Set([...a[entity], ...b[entity]])].sort();
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Column labels
// ---------------------------------------------------------------------------

/**
 * Indonesian names for every column of the seven logged tables.
 *
 * Worded exactly as `lib/validation/**` words the same field on the form, so a
 * column does not change its name on the way into the log. A column missing
 * here falls back to a humanised version of its `snake_case` name — readable,
 * and obviously a fallback.
 */
const COLUMN_LABELS: Record<LoggedTable, Readonly<Record<string, string>>> = {
  employees: {
    personnel_number: "Personnel Number",
    nip: "NIP",
    full_name: "Nama",
    org_unit_id: "Unit Organisasi",
    jabatan_id: "Jabatan",
    ...Object.fromEntries(
      Object.entries(EMPLOYEE_LOOKUP_COLUMN_TO_TYPE).map(([column, tipe]) => [
        column,
        LOOKUP_TYPE_LABELS[tipe],
      ]),
    ),
    keterangan_pj_plt: "Keterangan PJ/PLT",
    keterangan_rangkap_1: "Keterangan Rangkap 1",
    keterangan_rangkap_2: "Keterangan Rangkap 2",
    keterangan: "Keterangan",
    jurusan: "Jurusan",
    original_start_date: "Original Start Date",
    tanggal_diangkat: "Tanggal Diangkat",
    tanggal_promosi_pg: "Tanggal Promosi PG",
    tanggal_promosi_jg: "Tanggal Promosi JG",
    tanggal_keluar: "Tanggal Keluar",
    nomor_surat_pg: "Nomor Surat PG",
    nomor_surat_jg: "Nomor Surat JG",
    status: "Status Karyawan",
  },
  employee_private: {
    date_of_birth: "Tanggal Lahir",
    place_of_birth: "Tempat Lahir",
    religion: "Agama",
    marital_status: "Status Pernikahan",
  },
  org_units: {
    kode: "Kode Unit Organisasi",
    nama: "Nama Unit Organisasi",
    tipe: "Tipe",
    parent_id: "Induk",
    status: "Status",
    merged_into_id: "Digabungkan ke",
  },
  jabatan: {
    kode: "Kode Jabatan",
    nama: "Nama Jabatan",
    status: "Status",
    merged_into_id: "Digabungkan ke",
  },
  lookups: {
    tipe: "Tipe",
    kode: "Kode Lookup",
    label: "Label",
    urutan: "Urutan",
    status: "Status",
    merged_into_id: "Digabungkan ke",
  },
  api_keys: {
    nama_konsumen: "Nama Konsumen",
    key_prefix: "Awalan Key",
    key_hash: "Hash Key",
    allowed_fields: "Kolom yang Diizinkan",
    status: "Status",
    last_used_at: "Terakhir Dipakai",
  },
  profiles: {
    email: "Email",
    role: "Role",
  },
};

function humanise(column: string): string {
  return column
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

export function columnLabel(table: LoggedTable, column: string): string {
  return COLUMN_LABELS[table][column] ?? humanise(column);
}

// ---------------------------------------------------------------------------
// Value kinds and formatting
// ---------------------------------------------------------------------------

export type ValueKind =
  /** A uuid pointing at another row — rendered as that row's name. */
  | "reference"
  /** A `date` column: "14 Sep 2026". */
  | "date"
  /** A `timestamptz` column: "14 Sep 2026, 21.33 WIB". */
  | "timestamp"
  /** `aktif` / `nonaktif`. */
  | "status"
  /** `profiles.role`. */
  | "role"
  /** `org_units.tipe`. */
  | "tipe_unit"
  /** `lookups.tipe`. */
  | "tipe_lookup"
  /** `api_keys.allowed_fields` — a text[]. */
  | "list"
  /** Never rendered: `api_keys.key_hash`. */
  | "rahasia"
  | "text";

const DATE_COLUMNS = new Set(["date_of_birth"]);
const TIMESTAMP_COLUMNS = new Set(["last_used_at", "created_at", "updated_at"]);

export function valueKind(table: LoggedTable, column: string): ValueKind {
  if (table === "api_keys" && column === "key_hash") return "rahasia";
  if (table === "api_keys" && column === "allowed_fields") return "list";
  if (table === "profiles" && column === "role") return "role";
  if (table === "org_units" && column === "tipe") return "tipe_unit";
  if (table === "lookups" && column === "tipe") return "tipe_lookup";
  if (column === "status") return "status";
  if (REFERENCE_COLUMNS[table][column]) return "reference";
  if (TIMESTAMP_COLUMNS.has(column)) return "timestamp";
  if (
    DATE_COLUMNS.has(column) ||
    column.startsWith("tanggal_") ||
    column.endsWith("_date")
  ) {
    return "date";
  }
  return "text";
}

const BULAN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/**
 * "2026-09-14" → "14 Sep 2026".
 *
 * A `date` column carries no time and no zone, so it is split by hand rather
 * than parsed into a `Date` — `new Date("2026-09-14")` is midnight UTC, which
 * in Jakarta is already the 14th at 07:00 but in New York is still the 13th.
 * A birthday must not move.
 */
export function formatTanggal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const bulan = BULAN[Number(month) - 1] ?? month;
  return `${Number(day)} ${bulan} ${year}`;
}

/**
 * An ISO timestamp → "14 Sep 2026, 21.33 WIB".
 *
 * Two things are pinned on purpose, because these timestamps are rendered by
 * Client Components that are also server-rendered:
 *
 *   * **the zone**, so a Jakarta office and a server anywhere agree on the
 *     date, and React does not report a hydration mismatch;
 *   * **the month name**, taken from `BULAN` rather than from ICU. Node's ICU
 *     data and the browser's are independent, and Indonesian August has
 *     shipped as both "Agt" and "Agu" — which is the same hydration mismatch by
 *     another route. So the formatter is asked for a *numeric* month and the
 *     name is looked up here.
 */
export function formatWaktu(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const bulan = BULAN[Number(get("month")) - 1] ?? get("month");
  return `${Number(get("day"))} ${bulan} ${get("year")}, ${get("hour")}.${get("minute")} WIB`;
}

function asObject(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

/** One value, as it should appear on screen. Never returns an empty string. */
export function formatValue(
  kind: ValueKind,
  value: Json | undefined,
  labels: ReferenceLabels,
): string {
  if (kind === "rahasia") return DISEMBUNYIKAN;
  if (value === null || value === undefined || value === "") return KOSONG;

  switch (kind) {
    case "reference":
      return typeof value === "string" ? (labels[value] ?? TIDAK_DIKENAL) : String(value);
    case "date":
      return typeof value === "string" ? formatTanggal(value) : String(value);
    case "timestamp":
      return typeof value === "string" ? formatWaktu(value) : String(value);
    case "status":
      return value === "aktif" || value === "nonaktif"
        ? STATUS_LABELS[value]
        : String(value);
    case "role":
      return value === "admin" || value === "viewer" ? ROLE_LABELS[value] : String(value);
    case "tipe_unit":
      return typeof value === "string" && value in ORG_UNIT_TYPE_LABELS
        ? ORG_UNIT_TYPE_LABELS[value as keyof typeof ORG_UNIT_TYPE_LABELS]
        : String(value);
    case "tipe_lookup":
      return isLookupType(value) ? LOOKUP_TYPE_LABELS[value] : String(value);
    case "list":
      if (Array.isArray(value)) {
        return value.length === 0 ? KOSONG : value.map((item) => String(item)).join(", ");
      }
      return String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

// ---------------------------------------------------------------------------
// The diff itself
// ---------------------------------------------------------------------------

export type DiffField = {
  column: string;
  label: string;
  kind: ValueKind;
  /** Absent for an `insert` Revisi: there was no previous value. */
  before: Json | undefined;
  after: Json | undefined;
};

function sameValue(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) {
    // `null` and "column absent from the snapshot" mean the same thing here.
    return (a ?? null) === (b ?? null);
  }
  if (typeof a !== "object" && typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The columns that actually moved, in catalog order.
 *
 * * an `update` shows only columns whose value differs;
 * * an `insert` shows the columns the new row was created with, skipping the
 *   empty ones — a new Karyawan has thirty columns and usually a dozen values;
 * * the primary key never appears (it is the row, not a change), and neither
 *   do `created_at` / `updated_at`, which move on every write and say nothing.
 *
 * Columns present in the snapshot but no longer in the schema are listed last,
 * under their raw name: they cannot be restored (ADR-003), but hiding them
 * would make an old Revisi look like it changed nothing.
 */
export function diffRevision(
  table: LoggedTable,
  before: Json | null,
  after: Json | null,
): DiffField[] {
  const beforeRow = asObject(before);
  const afterRow = asObject(after);
  const pk: string = PK_COLUMN_BY_TABLE[table];
  const hidden = new Set<string>([pk, ...NON_RESTORABLE_COLUMNS]);

  const known = columnsOf(table);
  const extras = [
    ...new Set([
      ...Object.keys(beforeRow ?? {}),
      ...Object.keys(afterRow ?? {}),
    ]),
  ]
    .filter((column) => !known.includes(column))
    .sort();

  const fields: DiffField[] = [];
  for (const column of [...known, ...extras]) {
    if (hidden.has(column)) continue;

    const beforeValue = beforeRow ? beforeRow[column] : undefined;
    const afterValue = afterRow ? afterRow[column] : undefined;

    if (beforeRow === null) {
      // insert — show what the row was created with.
      if (afterValue === null || afterValue === undefined || afterValue === "") continue;
    } else if (sameValue(beforeValue, afterValue)) {
      continue;
    }

    fields.push({
      column,
      label: columnLabel(table, column),
      kind: valueKind(table, column),
      before: beforeRow === null ? undefined : beforeValue,
      after: afterValue,
    });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Naming the row a Revisi describes
// ---------------------------------------------------------------------------

function text(row: Record<string, Json | undefined> | null, column: string): string | null {
  const value = row?.[column];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The row a Revisi is about, named the way its own page names it.
 *
 * Read from the snapshot rather than the database: the snapshot is what the
 * row looked like at the time, it is already loaded, and it still works for a
 * row the reader cannot read today.
 */
export function revisionRowTitle(
  revision: RevisionLike,
  labels: ReferenceLabels,
): string {
  const table = revision.table_name;
  if (!isLoggedTable(table)) return `${table} · ${shortId(revision.row_id)}`;

  const row = asObject(revision.after) ?? asObject(revision.before);

  switch (table) {
    case "employees": {
      const nama = text(row, "full_name");
      const pernr = text(row, "personnel_number");
      if (nama && pernr) return `${nama} · ${pernr}`;
      return nama ?? pernr ?? shortId(revision.row_id);
    }
    case "employee_private":
      return labels[revision.row_id] ?? shortId(revision.row_id);
    case "org_units":
    case "jabatan": {
      const nama = text(row, "nama");
      const kode = text(row, "kode");
      if (nama && kode) return `${nama} (${kode})`;
      return nama ?? kode ?? shortId(revision.row_id);
    }
    case "lookups": {
      const label = text(row, "label");
      const tipe = text(row, "tipe");
      const tipeLabel = tipe && isLookupType(tipe) ? LOOKUP_TYPE_LABELS[tipe] : tipe;
      if (label && tipeLabel) return `${label} · ${tipeLabel}`;
      return label ?? shortId(revision.row_id);
    }
    case "api_keys":
      return text(row, "nama_konsumen") ?? shortId(revision.row_id);
    case "profiles":
      return text(row, "email") ?? shortId(revision.row_id);
  }
}

/** Table name in CONTEXT.md vocabulary, e.g. "Unit Organisasi". */
export function tableLabel(tableName: string): string {
  return isLoggedTable(tableName) ? LOGGED_TABLE_LABELS[tableName] : tableName;
}

/** First segment of a uuid — enough to tell two rows apart, short enough to read. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Who did it.
 *
 * `profiles` is readable only by admins and by its owner (RLS), so a viewer
 * cannot resolve a colleague's email — they get "Pengguna 3f2a1b8c…", which is
 * honest, stable, and still tells two actors apart. `null` means the write came
 * from the Seed script, which runs without a session.
 */
export function actorLabel(
  actorId: string | null,
  labels: ReferenceLabels,
): string {
  if (!actorId) return "Sistem";
  return labels[actorId] ?? `Pengguna ${shortId(actorId)}`;
}
