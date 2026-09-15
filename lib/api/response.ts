/**
 * The success and error envelopes of `/api/v1`.
 *
 * FROZEN CONTRACT (Wave 1) — API-CONTRACT.md §Konvensi Umum:
 *
 *     { "data": [...] | {...}, "meta": { "page": 1, "per_page": 100, "total": 1475 } }
 *     { "error": { "code": "…", "message": "…", "details": { … } } }
 *
 * `meta` appears on list endpoints only. `per_page` is snake_case in the JSON
 * even though the code around it is camelCase — the wire format is the
 * contract, and a Konsumen is already reading it.
 *
 * Plain `Response.json()` rather than `NextResponse`: these helpers are used by
 * Route Handlers but are pure enough to unit-test without a Next runtime.
 */
import { logError } from "@/lib/log";

import { toApiError, type ApiErrorBody } from "./errors";

/** Pagination block, exactly as it appears on the wire. */
export type PaginationMeta = {
  page: number;
  per_page: number;
  total: number;
};

export type ApiListBody<T> = {
  data: T[];
  meta: PaginationMeta;
};

export type ApiItemBody<T> = {
  data: T;
};

export type ApiBody<T> = ApiListBody<T> | ApiItemBody<T> | ApiErrorBody;

/** Defaults from API-CONTRACT.md §Pagination. */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 100;
export const MAX_PER_PAGE = 500;

/**
 * Live data only — no caching layer may hold an answer that includes a
 * Konsumen's whitelist (ADR-005 §6 is the same rule for pages).
 */
const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
};

export function buildMeta(input: {
  page: number;
  perPage: number;
  total: number;
}): PaginationMeta {
  return {
    page: input.page,
    per_page: input.perPage,
    total: input.total,
  };
}

/** `{ "data": { … } }` — a single row (GET /employees/{personnel_number}). */
export function jsonItem<T>(
  data: T,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return Response.json({ data } satisfies ApiItemBody<T>, {
    status: init?.status ?? 200,
    headers: { ...BASE_HEADERS, ...init?.headers },
  });
}

/** `{ "data": [ … ], "meta": { … } }` — a list endpoint. */
export function jsonList<T>(
  rows: T[],
  meta: PaginationMeta,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return Response.json({ data: rows, meta } satisfies ApiListBody<T>, {
    status: init?.status ?? 200,
    headers: { ...BASE_HEADERS, ...init?.headers },
  });
}

/**
 * `{ "data": [ … ] }` — a list with no pagination.
 *
 * Used by /org-units, /jabatan and /lookups, which return whole reference
 * lists: "meta hanya ada pada endpoint daftar [berhalaman]".
 */
export function jsonCollection<T>(
  rows: T[],
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return Response.json({ data: rows } satisfies ApiItemBody<T[]>, {
    status: init?.status ?? 200,
    headers: { ...BASE_HEADERS, ...init?.headers },
  });
}

/**
 * Turn anything thrown into the error envelope, with the right status.
 *
 * Unexpected errors are logged here and answered with a generic 500, so a
 * PostgREST message or a stack trace can never reach a Konsumen.
 */
export function jsonError(error: unknown): Response {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    logError("api/v1", apiError.cause ?? error, { code: apiError.code });
  }
  return Response.json(apiError.toBody(), {
    status: apiError.status,
    headers: { ...BASE_HEADERS, ...apiError.headers },
  });
}
