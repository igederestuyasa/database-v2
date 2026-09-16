/**
 * The seven tables whose every INSERT/UPDATE becomes a Revisi.
 *
 * FROZEN CONTRACT (Wave 1). This list mirrors the `log_revision` trigger
 * wiring in `supabase/migrations/0001_init.sql` §7 — six data tables **plus
 * `profiles`**, because promoting an account from viewer to admin is the
 * single most audit-worthy change in an HR system (ADR-005 §12, PRD #13).
 *
 * Do not confuse it with the list of DELETE-guarded tables, which is the same
 * list minus `profiles`: `profiles` rows hang off `auth.users` with
 * ON DELETE CASCADE and Supabase Auth owns that lifecycle. The two lists
 * differ by exactly one table on purpose.
 */
import { RELATION_COLUMNS } from "@/lib/schema/columns.generated";

export const LOGGED_TABLES = [
  "employees",
  "employee_private",
  "org_units",
  "jabatan",
  "lookups",
  "api_keys",
  "profiles",
] as const;

export type LoggedTable = (typeof LOGGED_TABLES)[number];

/** Tables a DELETE is refused on by trigger — the seven, minus `profiles`. */
export const DELETE_GUARDED_TABLES = [
  "employees",
  "employee_private",
  "org_units",
  "jabatan",
  "lookups",
  "api_keys",
] as const;

/**
 * `batches.jenis` — byte-identical to the CHECK constraint in 0001_init.sql
 * and to the keys of `BATCH_TYPE_LABELS` in `lib/i18n/terms.ts`.
 * `lib/validation/constraints.test.ts` fails if any of the three drift.
 */
export const BATCH_JENIS = [
  "edit",
  "create",
  "deactivate",
  "merge",
  "rename",
  "seed",
  "impor",
  "revert",
] as const;

export type BatchJenis = (typeof BATCH_JENIS)[number];

/** `revisions.action` — an insert or an update; there is no delete (ADR-003). */
export const REVISION_ACTIONS = ["insert", "update"] as const;

export type RevisionAction = (typeof REVISION_ACTIONS)[number];

/** Narrowing guard for `revisions.table_name`, which is plain `text`. */
export function isLoggedTable(value: unknown): value is LoggedTable {
  return (
    typeof value === "string" &&
    (LOGGED_TABLES as readonly string[]).includes(value)
  );
}

/**
 * Primary key column per logged table.
 *
 * Every table is keyed by `id` except `employee_private`, which is keyed by
 * `employee_id` — exactly the `coalesce(after->>'id', after->>'employee_id')`
 * the `log_revision` trigger uses to fill `revisions.row_id`.
 */
export const PK_COLUMN_BY_TABLE = {
  employees: "id",
  employee_private: "employee_id",
  org_units: "id",
  jabatan: "id",
  lookups: "id",
  api_keys: "id",
  profiles: "id",
} as const satisfies Record<LoggedTable, "id" | "employee_id">;

export type PkColumn = (typeof PK_COLUMN_BY_TABLE)[LoggedTable];

/**
 * Tables that can be deactivated instead of deleted.
 *
 * Reverting an `insert` sets `status = 'nonaktif'` rather than deleting the
 * row (ARCHITECTURE.md §4C). `employee_private` and `profiles` have no
 * `status` column, so that revert has nothing to write — `planRevert()`
 * reports it as skipped instead of inventing one.
 */
export const TABLES_WITH_STATUS = [
  "employees",
  "org_units",
  "jabatan",
  "lookups",
  "api_keys",
] as const satisfies readonly LoggedTable[];

export function hasStatusColumn(table: LoggedTable): boolean {
  return (TABLES_WITH_STATUS as readonly string[]).includes(table);
}

/** Indonesian names for the Log Perubahan page, in CONTEXT.md vocabulary. */
export const LOGGED_TABLE_LABELS: Record<LoggedTable, string> = {
  employees: "Karyawan",
  employee_private: "Data Pribadi Sensitif",
  org_units: "Unit Organisasi",
  jabatan: "Jabatan",
  lookups: "Lookup",
  api_keys: "API Key",
  profiles: "Pengguna",
};

/**
 * Columns a Revisi must never try to write back.
 *
 * `created_at` is the row's own history and `updated_at` is maintained by the
 * `set_updated_at` trigger; writing either from a `before` snapshot would
 * falsify it. Primary keys are excluded per table by `PK_COLUMN_BY_TABLE`.
 */
export const NON_RESTORABLE_COLUMNS = ["created_at", "updated_at"] as const;

/** Real column list for a logged table, straight from the generated catalog. */
export function columnsOf(table: LoggedTable): readonly string[] {
  return RELATION_COLUMNS[table];
}
