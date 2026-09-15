/**
 * `fields` — which columns of `v_employees_api` one Konsumen may read.
 *
 * This module is the whole access-control story of `/api/v1/employees`.
 * The routes query with the **service-role client**, which bypasses RLS
 * (ADR-004, `lib/supabase/admin.ts`), so nothing downstream will stop a column
 * from leaving the building: what `resolveEmployeeFields()` returns is exactly
 * what a Konsumen gets. ARCHITECTURE.md §7 names this file as one of only
 * three whose bugs are expensive precisely because they are silent — hence
 * `fields.test.ts` next door, and hence the rules below being spelled out
 * rather than inferred from the code.
 *
 * The rules, straight out of API-CONTRACT.md §Konvensi Umum:
 *
 *   1. `fields=a,b,c`. Mandatory on `/employees`; optional on
 *      `/employees/{personnel_number}`, where omitting it means "every column
 *      this key is allowed".
 *   2. A column must be in `v_employees_api` **and** in the key's
 *      `allowed_fields`.
 *   3. Rejection is **all-or-nothing**: one bad column fails the whole request
 *      and names the offenders. A partial row is never returned — a Konsumen
 *      that silently receives four of the five columns it asked for writes
 *      four columns into its own copy and never notices.
 *
 * The universe is `API_EMPLOYEE_FIELDS`, generated from the database itself,
 * and `tests/apiColumns.test.ts` already asserts it matches API-CONTRACT.md.
 * Data Pribadi Sensitif (`date_of_birth`, `place_of_birth`, `religion`,
 * `marital_status`, `usia`) is absent from that view by construction, so those
 * names fail here as UNKNOWN_FIELD — they are not "forbidden", they simply do
 * not exist on this side of the wall (PRD #22).
 */
import { API_EMPLOYEE_FIELDS } from "@/lib/schema/columns.generated";

import { apiError } from "./errors";

/**
 * Every column a Konsumen may ever ask for, in the order `v_employees_api`
 * declares them. Order matters: it is the shape of the default response on
 * `/employees/{personnel_number}`, and a stable shape is part of the contract.
 */
export const EMPLOYEE_FIELDS: readonly string[] = API_EMPLOYEE_FIELDS;

const EMPLOYEE_FIELD_SET: ReadonlySet<string> = new Set(EMPLOYEE_FIELDS);

/** Is this the name of a column `v_employees_api` actually has? */
export function isEmployeeField(name: string): boolean {
  return EMPLOYEE_FIELD_SET.has(name);
}

/**
 * Split a raw `fields=a,b,c` value into column names.
 *
 * Trims each entry, drops the empties (so `a,,b` and a trailing comma are not
 * errors) and removes duplicates while keeping first-seen order. Returns `[]`
 * for `null`, `undefined` and a value that is all separators — "kosong" in the
 * sense API-CONTRACT.md means it.
 *
 * Deliberately does **not** lowercase: `Full_Name` is not a column of
 * `v_employees_api`, and answering UNKNOWN_FIELD is more honest than guessing.
 */
export function parseFieldList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * One key's whitelist, narrowed to columns that exist, in view order.
 *
 * `api_keys.allowed_fields` is validated on the way in
 * (`lib/validation/apiKey.ts`), but it is a plain `text[]` in the database and
 * this module is the last line of defence: a name that is not a column of
 * `v_employees_api` is dropped here rather than being pasted into a select
 * list. Sorting into view order (instead of whatever order the admin ticked
 * the boxes in) is what makes the default response shape stable.
 */
export function allowedEmployeeFields(
  allowed: readonly string[] | null | undefined,
): string[] {
  if (!allowed || allowed.length === 0) return [];
  const wanted = new Set(allowed);
  return EMPLOYEE_FIELDS.filter((field) => wanted.has(field));
}

export type ResolveEmployeeFieldsInput = {
  /** The raw `fields` query parameter, exactly as it arrived. */
  requested: string | null | undefined;
  /** `api_keys.allowed_fields` for the authenticated key. */
  allowed: readonly string[] | null | undefined;
  /**
   * `true` on `/employees` (API-CONTRACT.md: "Wajib pada `/employees`"),
   * `false` on `/employees/{personnel_number}`, where the default is the whole
   * whitelist.
   */
  required?: boolean;
};

/**
 * The columns to select, or an `ApiError` naming what was wrong.
 *
 * Order of checks is deliberate and part of the contract's wording:
 *
 *   * empty + required        → `400 FIELDS_REQUIRED`
 *   * not a column at all     → `400 UNKNOWN_FIELD`  (checked first: a typo is
 *                               the likelier cause, and telling the caller
 *                               "not allowed" for a column that does not exist
 *                               would send them to ask an admin for it)
 *   * a column, but not this
 *     key's column            → `403 FIELD_NOT_ALLOWED`
 *
 * A request mixing both kinds gets the 400, with every unknown column listed.
 * Whichever error fires, `details.fields` carries the offending names — that is
 * the Fase 4 exit criterion ("minta kolom kelima → 403 dengan nama kolomnya").
 *
 * The returned list keeps the order the caller asked in, minus duplicates.
 */
export function resolveEmployeeFields(input: ResolveEmployeeFieldsInput): string[] {
  const requested = parseFieldList(input.requested);
  const whitelist = allowedEmployeeFields(input.allowed);

  if (requested.length === 0) {
    if (input.required) throw apiError.fieldsRequired();
    if (whitelist.length === 0) {
      // Not a 400: the caller asked correctly and the answer is that this key
      // may read nothing. Same code as any other refused column, with an empty
      // list, because there is no column to name.
      throw apiError.fieldNotAllowed(
        [],
        "API Key ini tidak punya satu pun kolom yang diizinkan. Minta admin menambah kolom di halaman API Keys.",
      );
    }
    return whitelist;
  }

  const unknown = requested.filter((field) => !isEmployeeField(field));
  if (unknown.length > 0) throw apiError.unknownField(unknown);

  const granted = new Set(whitelist);
  const refused = requested.filter((field) => !granted.has(field));
  if (refused.length > 0) throw apiError.fieldNotAllowed(refused);

  return requested;
}

/**
 * A PostgREST `select()` argument.
 *
 * Every name has already been proved to be a column of `v_employees_api` by
 * `resolveEmployeeFields()`, so nothing a Konsumen typed reaches the query
 * string unchecked — no quoting, no escaping, no injection surface.
 */
export function buildSelect(fields: readonly string[]): string {
  if (fields.length === 0) {
    // Unreachable through the routes; a bug here would otherwise become
    // `select("")`, which PostgREST reads as "every column".
    throw apiError.internal(new Error("buildSelect() dipanggil tanpa kolom."));
  }
  return fields.join(", ");
}

/** One row, reduced to exactly the requested columns, in the requested order. */
export function projectRow(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = row[field];
    // `undefined` would vanish from the JSON and quietly change the response
    // shape for that one row; a Konsumen mapping rows into columns needs every
    // key it asked for to be present.
    out[field] = value === undefined ? null : value;
  }
  return out;
}

/**
 * The same projection over a page of rows.
 *
 * The select list already limits what comes back, so this is belt and braces —
 * but it is cheap, and it is what guarantees the response can never carry a
 * column the key was not granted, whatever the database returns.
 */
export function projectRows(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
): Record<string, unknown>[] {
  return rows.map((row) => projectRow(row, fields));
}
