/**
 * The error vocabulary of `/api/v1` — codes, HTTP status, and the one envelope.
 *
 * FROZEN CONTRACT (Wave 1). API-CONTRACT.md is the specification and it says
 * the shape of a v1 response never changes once a Konsumen depends on it:
 *
 *     { "error": { "code": "FIELD_NOT_ALLOWED",
 *                  "message": "Kolom tidak diizinkan untuk key ini",
 *                  "details": { "fields": ["person_grade_label"] } } }
 *
 * Every route under `app/api/v1/**` throws or returns one of these; nothing
 * invents its own code, its own status mapping, or its own wording. The
 * request-handling that produces them — key authentication, `fields` parsing,
 * query parsing — lives in `lib/api/{auth,fields,query}.ts`, which belong to
 * the API unit, not here.
 */

/**
 * Every error code v1 can return, with the status it maps to.
 *
 * The status column is the table in API-CONTRACT.md §Konvensi: `400` query
 * tidak valid · `401` key tidak ada/tidak dikenal/nonaktif · `403` kolom di
 * luar whitelist · `404` tidak ditemukan · `405` method salah · `500` error
 * server.
 */
export const API_ERROR_STATUS = {
  /** `fields` is required on /employees and was empty (400). */
  FIELDS_REQUIRED: 400,
  /** A requested column does not exist in `v_employees_api` (400). */
  UNKNOWN_FIELD: 400,
  /** `tipe` on /lookups is not one of the 11 Lookup types (400). */
  UNKNOWN_LOOKUP_TYPE: 400,
  /** Any other malformed query parameter (400). */
  INVALID_QUERY: 400,
  /** Missing, unknown or nonaktif API Key (401). */
  UNAUTHORIZED: 401,
  /** The column exists but is outside this key's `allowed_fields` (403). */
  FIELD_NOT_ALLOWED: 403,
  /** No such row (404). */
  NOT_FOUND: 404,
  /** v1 is GET-only (405). */
  METHOD_NOT_ALLOWED: 405,
  /** Anything unexpected (500). */
  INTERNAL_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Default Indonesian message per code. A factory may override it. */
export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  FIELDS_REQUIRED: "Parameter 'fields' wajib diisi.",
  UNKNOWN_FIELD: "Ada kolom yang tidak dikenal.",
  UNKNOWN_LOOKUP_TYPE: "Tipe Lookup tidak dikenal.",
  INVALID_QUERY: "Parameter query tidak valid.",
  UNAUTHORIZED: "API Key tidak valid atau tidak aktif.",
  FIELD_NOT_ALLOWED: "Kolom tidak diizinkan untuk key ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  METHOD_NOT_ALLOWED: "Method tidak didukung; /api/v1 hanya menerima GET.",
  INTERNAL_ERROR: "Terjadi kesalahan di server.",
};

/** The `details` object is free-form but always a JSON object. */
export type ApiErrorDetails = Record<string, unknown>;

/** The single error envelope of v1. */
export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetails;
  };
};

/**
 * One error, carrying everything a route needs to answer with.
 *
 * Throw it from anywhere under `app/api/v1/**` and let the route's catch turn
 * it into a Response with `jsonError()`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetails | undefined;
  /** Extra response headers (e.g. `Allow` on a 405). */
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ApiErrorCode,
    message?: string,
    options?: {
      details?: ApiErrorDetails;
      headers?: Record<string, string>;
      cause?: unknown;
    },
  ) {
    super(message ?? API_ERROR_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = options?.details;
    this.headers = options?.headers;
    if (options?.cause !== undefined) this.cause = options.cause;
  }

  /** The exact JSON body API-CONTRACT.md promises. */
  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Factories, so the same situation always produces the same code, status and
 * wording across five route files.
 */
export const apiError = {
  /** 400 — `fields` missing on an endpoint that requires it. */
  fieldsRequired(message?: string): ApiError {
    return new ApiError("FIELDS_REQUIRED", message);
  },

  /** 400 — columns that are not in `v_employees_api` at all. */
  unknownField(fields: readonly string[], message?: string): ApiError {
    return new ApiError(
      "UNKNOWN_FIELD",
      message ?? `Kolom tidak dikenal: ${fields.join(", ")}.`,
      { details: { fields: [...fields] } },
    );
  },

  /**
   * 403 — columns that exist but are outside this key's whitelist.
   *
   * The request is refused whole: "kalau ada satu saja yang tidak boleh → 403,
   * tidak dieksekusi sebagian" (API-CONTRACT.md).
   */
  fieldNotAllowed(fields: readonly string[], message?: string): ApiError {
    return new ApiError("FIELD_NOT_ALLOWED", message, {
      details: { fields: [...fields] },
    });
  },

  /** 400 — `tipe` outside the 11 Lookup types. */
  unknownLookupType(tipe: string, allowed?: readonly string[]): ApiError {
    return new ApiError("UNKNOWN_LOOKUP_TYPE", `Tipe Lookup tidak dikenal: ${tipe}.`, {
      details: { tipe, ...(allowed ? { allowed: [...allowed] } : {}) },
    });
  },

  /** 400 — any other bad query parameter. */
  invalidQuery(param: string, message?: string): ApiError {
    return new ApiError(
      "INVALID_QUERY",
      message ?? `Parameter '${param}' tidak valid.`,
      { details: { param } },
    );
  },

  /**
   * 401 — no key, unknown key, or nonaktif key.
   *
   * The message never distinguishes those three: telling a caller that a key
   * is real but switched off is more than they need to know.
   */
  unauthorized(message?: string): ApiError {
    return new ApiError("UNAUTHORIZED", message, {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  },

  /** 404 — no such row. */
  notFound(message?: string, details?: ApiErrorDetails): ApiError {
    return new ApiError("NOT_FOUND", message, { details });
  },

  /** 405 — v1 is GET-only; the `Allow` header says so. */
  methodNotAllowed(allow: readonly string[] = ["GET"]): ApiError {
    return new ApiError("METHOD_NOT_ALLOWED", undefined, {
      details: { allow: [...allow] },
      headers: { Allow: allow.join(", ") },
    });
  },

  /** 500 — anything unexpected. The cause is logged, never returned. */
  internal(cause?: unknown, message?: string): ApiError {
    return new ApiError("INTERNAL_ERROR", message, { cause });
  },
};

/**
 * Coerce anything thrown into an `ApiError`.
 *
 * Unknown errors become a 500 with the generic message: a PostgREST message,
 * a stack trace or a constraint name must never reach a Konsumen.
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return apiError.internal(error);
}
