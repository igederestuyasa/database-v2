/**
 * Shared plumbing for `lib/db/**` — the read layer.
 *
 * FROZEN CONTRACT (Wave 1). Feature units import from here; they do not edit
 * it. Every module in `lib/db/` follows the same three rules:
 *
 *   1. **Reads only.** Writes go through a Server Action in `lib/actions/`
 *      wrapped in `withBatch()` (ARCHITECTURE.md §6).
 *   2. **The caller supplies the client.** Every function takes a `DbClient`
 *      as its first argument, so a Server Component, a Server Action and a
 *      script can all reuse the same query without this layer reaching for
 *      `next/headers` or the service role on its own.
 *   3. **Viewer-safe relations only.** Karyawan reads go to `v_employees`,
 *      never `v_employees_private`: that view INNER JOINs `employee_private`,
 *      so RLS gives a viewer **zero rows**, not NULL columns (ADR-005 §10).
 *      Data Pribadi Sensitif is read separately, see
 *      `getEmployeePrivate()` in `lib/db/employees.ts`.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/db";

/** Any Supabase client typed against our schema (browser, server or admin). */
export type DbClient = SupabaseClient<Database>;

/** `status` filter shared by every entity. `semua` means "do not filter". */
export type StatusFilter = "aktif" | "nonaktif" | "semua";

/** Sort direction, matching PostgREST's `order(..., { ascending })`. */
export type SortDirection = "asc" | "desc";

export type PageParams = {
  /** 1-based. Values below 1 are clamped to 1. */
  page?: number;
  /** Clamped to `[1, MAX_PER_PAGE]`. */
  perPage?: number;
};

/** One page of rows plus everything a pager needs to render itself. */
export type Paged<T> = {
  rows: T[];
  page: number;
  perPage: number;
  /** Total matching rows, from PostgREST's exact count. */
  total: number;
  /** `ceil(total / perPage)`, at least 1 so "Halaman 1 dari 1" reads right. */
  pageCount: number;
};

export const DEFAULT_PER_PAGE = 50;

/** Same ceiling as the public API (API-CONTRACT.md §Pagination). */
export const MAX_PER_PAGE = 500;

/** Error thrown by every `lib/db` function when PostgREST returns an error. */
export class DbError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(context: string, cause: PostgrestError) {
    super(`${context}: ${cause.message}`);
    this.name = "DbError";
    this.code = cause.code;
    this.details = cause.details ?? undefined;
    this.hint = cause.hint ?? undefined;
    this.cause = cause;
  }
}

/** Clamp page params and turn them into an inclusive PostgREST range. */
export function resolvePage(params: PageParams | undefined): {
  page: number;
  perPage: number;
  from: number;
  to: number;
} {
  const page = Math.max(1, Math.floor(params?.page ?? 1) || 1);
  const requested = Math.floor(params?.perPage ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE;
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested));
  const from = (page - 1) * perPage;
  return { page, perPage, from, to: from + perPage - 1 };
}

/** Assemble a `Paged<T>` from a PostgREST result. */
export function toPaged<T>(
  rows: T[] | null,
  count: number | null,
  page: number,
  perPage: number,
): Paged<T> {
  const total = count ?? rows?.length ?? 0;
  return {
    rows: rows ?? [],
    page,
    perPage,
    total,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Throw on error, otherwise hand back the rows (never null). */
export function unwrapRows<T>(
  context: string,
  result: { data: T[] | null; error: PostgrestError | null },
): T[] {
  if (result.error) throw new DbError(context, result.error);
  return result.data ?? [];
}

/**
 * Throw on error, otherwise hand back the single row or `null`.
 *
 * Use with `.maybeSingle()`. PostgREST's "no rows" is not an error here: a
 * missing Karyawan is a 404 for the page to render, not an exception.
 */
export function unwrapMaybe<T>(
  context: string,
  result: { data: T | null; error: PostgrestError | null },
): T | null {
  if (result.error) throw new DbError(context, result.error);
  return result.data ?? null;
}

/**
 * Quote a user-supplied value for use inside a PostgREST `or(...)` filter.
 *
 * `.or()` takes a raw filter string, so an unquoted value containing `,`,
 * `(` or `)` silently changes the shape of the query. Double-quoting with
 * backslash escapes is what PostgREST expects.
 */
export function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Escape the LIKE wildcards in a user-supplied value.
 *
 * `%` and `_` are wildcards to `ilike`, so an admin searching Master Data for
 * `100%` would otherwise match every label containing "100", and a kode like
 * `DIV_HC` would match `DIV-HC` too. Postgres's default LIKE escape character
 * is a backslash, and `quoteOrValue` escapes the backslash itself on the way
 * out — so escape wildcards BEFORE quoting, never after.
 */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** `ilike` pattern for a "contains" search, for `.ilike(column, pattern)`. */
export function likePattern(term: string): string {
  return `%${escapeLikeWildcards(term.trim())}%`;
}

/** The same pattern, quoted for use inside an `or(...)` filter string. */
export function containsPattern(term: string): string {
  return quoteOrValue(likePattern(term));
}

/** Normalise a free-text search box value; empty/blank means "no search". */
export function normalizeSearch(search: string | null | undefined): string | null {
  const trimmed = (search ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
