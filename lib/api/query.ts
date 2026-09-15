/**
 * Query-string parsing for `/api/v1` — every value a Konsumen can send.
 *
 * One rule runs through all of it: **a parameter is either understood or
 * refused.** Nothing is silently ignored and nothing is guessed. A Konsumen
 * that sends `status=aktiv` and receives every row would sync the wrong data
 * and never see an error; it receives `400 INVALID_QUERY` naming the parameter
 * instead.
 *
 * The one deliberate exception is `per_page`, which API-CONTRACT.md defines as
 * a range rather than a set: "default 100, max 500". A well-formed number
 * outside that range is clamped, not refused — asking for 10 000 rows is a
 * reasonable thing for a first-time integrator to try, and 500 rows is a
 * useful answer to it. A value that is not a whole number at all (`abc`,
 * `-1`, `1.5`) is still a 400: that is a bug in the caller, not an ambition.
 *
 * Every error here comes from the frozen vocabulary in `lib/api/errors.ts`;
 * this module never invents a code or a status.
 */
import type { StatusFilter } from "@/lib/db/shared";
import { LOOKUP_TYPES, type LookupType } from "@/lib/validation/lookupTypes";
import { ORG_UNIT_TYPES, type OrgUnitType } from "@/lib/validation/orgUnit";
import { isUuid } from "@/lib/validation/uuid";

import { ApiError, apiError } from "./errors";
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from "./response";

/** `status` values the API accepts, including "do not filter". */
export const STATUS_FILTERS: readonly StatusFilter[] = ["aktif", "nonaktif", "semua"];

const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * `YYYY-MM-DD`, optionally with a time and an offset.
 *
 * API-CONTRACT.md §Konvensi: "Tanggal: `YYYY-MM-DD`. Timestamp: ISO 8601 UTC."
 */
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?)(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * A trimmed parameter, or `null` when absent or blank.
 *
 * A parameter sent twice is a `400`, not a coin toss. `URLSearchParams.get()`
 * quietly keeps the first occurrence, so `?status=aktif&status=semua` would
 * otherwise filter to `aktif` with no complaint, and
 * `?fields=nip&fields=full_name` would return rows with one column instead of
 * two — a partial row, which is the one thing API-CONTRACT.md says can never
 * happen. Konsumen build these URLs with query-string helpers that append
 * rather than replace, so this is a realistic mistake and it has to be loud.
 */
export function readSingleParam(
  params: URLSearchParams,
  name: string,
): string | null {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' dikirim ${values.length} kali; kirim sekali saja.`,
    );
  }
  const raw = values[0];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type Pagination = {
  page: number;
  perPage: number;
  /** Inclusive PostgREST range, ready for `.range(from, to)`. */
  from: number;
  to: number;
};

/**
 * `page` and `per_page`, clamped as API-CONTRACT.md §Pagination defines them.
 *
 * `page` below 1 is clamped to 1 (page 0 is the same page as page 1 to anyone
 * counting from one); `per_page` is clamped into `[1, 500]`. The numbers that
 * come back are the numbers echoed in `meta`, so a Konsumen that asked for
 * 10 000 rows can see in the response that it was given 500.
 */
export function parsePagination(params: URLSearchParams): Pagination {
  const page = Math.max(DEFAULT_PAGE, parseWholeNumber(params, "page", DEFAULT_PAGE));
  const requested = parseWholeNumber(params, "per_page", DEFAULT_PER_PAGE);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, requested));
  const from = (page - 1) * perPage;
  return { page, perPage, from, to: from + perPage - 1 };
}

/** A non-negative whole number, or `400 INVALID_QUERY`. */
export function parseWholeNumber(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = readSingleParam(params, name);
  if (raw === null) return fallback;
  if (!WHOLE_NUMBER_PATTERN.test(raw)) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' harus berupa angka bulat.`,
    );
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw apiError.invalidQuery(name, `Parameter '${name}' terlalu besar.`);
  }
  return value;
}

/**
 * `status=aktif|nonaktif|semua`.
 *
 * Default `aktif` everywhere in the contract; `/employees/{personnel_number}`
 * does not filter at all, because a nonaktif Karyawan is still returned there.
 */
export function parseStatusFilter(
  params: URLSearchParams,
  fallback: StatusFilter = "aktif",
  name = "status",
): StatusFilter {
  const raw = readSingleParam(params, name);
  if (raw === null) return fallback;
  if (!(STATUS_FILTERS as readonly string[]).includes(raw)) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' hanya boleh: ${STATUS_FILTERS.join(", ")}.`,
    );
  }
  return raw as StatusFilter;
}

/** A uuid-shaped parameter, or `null` when absent. */
export function parseUuidParam(
  params: URLSearchParams,
  name: string,
): string | null {
  const raw = readSingleParam(params, name);
  if (raw === null) return null;
  if (!isUuid(raw)) {
    throw apiError.invalidQuery(name, `Parameter '${name}' harus berupa uuid.`);
  }
  return raw.toLowerCase();
}

/**
 * `true` / `false` / `1` / `0`, case-insensitive.
 *
 * Anything else is a 400 rather than a silent `false`: `include_children=yes`
 * quietly meaning "no" would hand a Konsumen a Divisi without its Proyek.
 */
export function parseBooleanParam(
  params: URLSearchParams,
  name: string,
  fallback: boolean,
): boolean {
  const raw = readSingleParam(params, name);
  if (raw === null) return fallback;
  const value = raw.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw apiError.invalidQuery(
    name,
    `Parameter '${name}' hanya boleh 'true' atau 'false'.`,
  );
}

/**
 * An ISO 8601 moment, normalised to UTC.
 *
 * A value with no offset is read as UTC (never as the server's local time,
 * which would make the same request mean different things on two deployments)
 * and a date-only value as that day's midnight UTC.
 */
export function parseTimestampParam(
  params: URLSearchParams,
  name: string,
): string | null {
  const raw = readSingleParam(params, name);
  if (raw === null) return null;

  const match = TIMESTAMP_PATTERN.exec(raw);
  if (!match) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' harus berformat YYYY-MM-DD atau ISO 8601 (mis. 2026-01-31T09:00:00Z).`,
    );
  }

  const [, date, time, offset] = match;
  const parsed = new Date(`${date}T${time ?? "00:00:00"}${offset ?? "Z"}`);
  // `new Date()` happily rolls 2026-02-30 over into March, so the calendar day
  // is checked separately: a Konsumen syncing "everything since 30 February"
  // must be told its date is wrong, not quietly given two days less.
  if (Number.isNaN(parsed.getTime()) || !isRealCalendarDay(date)) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' bukan waktu yang sah.`,
    );
  }
  return parsed.toISOString();
}

/** Does `YYYY-MM-DD` name a day that exists? */
function isRealCalendarDay(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Longest `search` the API will consider; beyond this it is not a search. */
export const MAX_SEARCH_LENGTH = 200;

/** Free-text `search`, trimmed; blank means "no search". */
export function parseSearchParam(
  params: URLSearchParams,
  name = "search",
): string | null {
  const raw = readSingleParam(params, name);
  if (raw === null) return null;
  if (raw.length > MAX_SEARCH_LENGTH) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' maksimal ${MAX_SEARCH_LENGTH} karakter.`,
    );
  }
  return raw;
}

/**
 * `tipe` on `/lookups` — **wajib**, and one of the 11 Lookup types.
 *
 * A missing `tipe` and an unknown one both answer `400 UNKNOWN_LOOKUP_TYPE`:
 * that is the only error API-CONTRACT.md documents for this endpoint, and
 * `details.allowed` lists the 11 values so an integrator never has to guess.
 */
export function parseLookupTipe(params: URLSearchParams, name = "tipe"): LookupType {
  const raw = readSingleParam(params, name);
  if (raw === null) {
    throw new ApiError(
      "UNKNOWN_LOOKUP_TYPE",
      `Parameter '${name}' wajib diisi.`,
      { details: { tipe: null, allowed: [...LOOKUP_TYPES] } },
    );
  }
  if (!(LOOKUP_TYPES as readonly string[]).includes(raw)) {
    throw apiError.unknownLookupType(raw, LOOKUP_TYPES);
  }
  return raw as LookupType;
}

/** `tipe` on `/org-units` — optional, one of the six Unit Organisasi types. */
export function parseOrgUnitTipe(
  params: URLSearchParams,
  name = "tipe",
): OrgUnitType | null {
  const raw = readSingleParam(params, name);
  if (raw === null) return null;
  if (!(ORG_UNIT_TYPES as readonly string[]).includes(raw)) {
    throw apiError.invalidQuery(
      name,
      `Parameter '${name}' hanya boleh: ${ORG_UNIT_TYPES.join(", ")}.`,
    );
  }
  return raw as OrgUnitType;
}
