/**
 * Database failures → something staf HC can act on, in ONE place.
 *
 * Two layers, both pure (no `next/*`; tested in `pgErrors.test.ts`):
 *
 *   * `classifyDatabaseError(code)` — the **floor**: the five SQLSTATE /
 *     PostgREST codes every one-statement action can meet, mapped to the least
 *     wrong general-purpose sentence. `toActionFailure()` in `result.ts` falls
 *     back to it for a `DbError` nobody translated, so a new action that maps
 *     nothing still tells staf HC something true.
 *   * `mapDbError(error, ctx)` — the **entity-aware** mapping. Seven action
 *     files used to carry their own copy of this, and they drifted: `PGRST116`
 *     was BUKAN_ADMIN in four of them and TIDAK_DITEMUKAN in two. The wording
 *     that names the thing ("Kode Unit Organisasi «DIV-HC» sudah dipakai unit
 *     lain") is still better than anything generic, so it stays — but as a
 *     table of sentences the caller hands in (`DbErrorContext`), not as a
 *     function reimplemented per file.
 *
 * `PGRST116` is the one worth reading twice. RLS on every data table is
 * written `using (public.is_admin())`, and a USING clause **filters**: a
 * viewer's UPDATE does not raise `insufficient_privilege`, it matches **zero
 * rows**, and `.single()` then answers PGRST116 — "no rows returned". So the
 * shape of an RLS refusal on an UPDATE is a not-found, and an action that
 * treats PGRST116 as "hilang" tells a viewer the data disappeared. Nothing is
 * ever deleted here (ADR-003), so zero rows on an UPDATE by id has exactly one
 * ordinary cause: the caller stopped being an admin between `requireAdmin()`
 * and the write.
 *
 * Messages passed through verbatim: the functions in
 * `0002_batch_operations.sql` raise Indonesian sentences with deliberate
 * SQLSTATEs (`42501`, `22023`, `55000`, `P0002`, `23514`), and those are worth
 * showing. But Postgres itself also raises `42501` ("new row violates
 * row-level security policy for table …") and `23514` (a CHECK constraint) in
 * English, naming tables. `mapDbError` therefore passes a message through only
 * when it does not read like Postgres prose; otherwise it uses the generic
 * sentence for that code.
 */
import { DbError, IncompleteReadError } from "@/lib/db/shared";
import { UI } from "@/lib/i18n/terms";
import { logError } from "@/lib/log";

import {
  ActionError,
  ForbiddenError,
  UnauthenticatedError,
  type ActionErrorCode,
} from "./errors";

/** What a recognised database code means, in Indonesian. */
export type DatabaseFailure = {
  code: ActionErrorCode;
  message: string;
};

/**
 * Postgres SQLSTATEs and PostgREST codes an ordinary one-statement action can
 * hit, mapped to the least wrong general-purpose sentence.
 *
 * Kept generic on purpose: a message here can be shown for any table, so it
 * must not claim to know which column or which entity was involved.
 */
const BY_CODE: Readonly<Record<string, DatabaseFailure>> = {
  // unique_violation — two admins racing, or a kode that already exists.
  "23505": {
    code: "KONFLIK",
    message:
      "Nilai ini sudah dipakai baris lain dan harus unik. Muat ulang halaman, lalu pakai nilai lain.",
  },
  // foreign_key_violation — the row being pointed at is gone.
  "23503": {
    code: "KONFLIK",
    message:
      "Data yang dirujuk sudah tidak ada. Muat ulang halaman, lalu pilih ulang.",
  },
  // check_violation — a CHECK constraint or a guard trigger said no.
  "23514": {
    code: "KONFLIK",
    message:
      "Nilai yang dikirim ditolak aturan basis data. Periksa kembali isian, lalu coba lagi.",
  },
  // insufficient_privilege — `with check (is_admin())` on INSERT really throws.
  "42501": {
    code: "BUKAN_ADMIN",
    message: UI.hanyaAdmin,
  },
  // No rows returned. On an UPDATE that is what an RLS refusal looks like.
  PGRST116: {
    code: "BUKAN_ADMIN",
    message: `${UI.hanyaAdmin} Kalau Anda memang admin, baris ini baru saja diubah orang lain — muat ulang halaman lalu coba lagi.`,
  },
};

/** Every code with a shared default, for tests and for readers. */
export const KNOWN_DATABASE_CODES = Object.keys(BY_CODE) as readonly string[];

/**
 * The default meaning of a database code, or `null` when there is none.
 *
 * `null` is not a failure to handle — it means "nothing generic to say", and
 * the caller should keep its own behaviour (log it, show the catch-all).
 */
export function classifyDatabaseError(
  code: string | null | undefined,
): DatabaseFailure | null {
  if (!code) return null;
  return BY_CODE[code] ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * mapDbError — the entity-aware mapping
 * ──────────────────────────────────────────────────────────────────────────── */

/** One sentence, optionally pinned to a form field. */
export type FailureWording = {
  /** The toast. */
  message: string;
  /** Form field to attach the failure to (react-hook-form). */
  field?: string;
  /** The per-field sentence; defaults to `message`. */
  fieldMessage?: string;
};

/** `23505` wording for one UNIQUE column, chosen by what the constraint is called. */
export type UniqueRule = FailureWording & {
  /** Text looked for in the Postgres message + details, e.g. the column name. */
  cocok: string;
};

/**
 * What one entity's actions know about their own failures. Every field is
 * optional: an empty context gives exactly the floor sentences.
 */
export type DbErrorContext = {
  /** The entity in CONTEXT.md vocabulary: "Karyawan", "Jabatan", … */
  entitas: string;
  /** For the hanya-admin sentence; default `mengubah <entitas>`. */
  aksi?: string;
  /** `23505` per UNIQUE column, in priority order; the first match wins. */
  unik?: readonly UniqueRule[];
  /** `23505` when no rule matches, or when there are no rules. */
  unikDefault?: FailureWording;
  /** `23503` — the row being pointed at is gone. */
  rujukan?: FailureWording;
  /** `23514` — CHECK or guard trigger. Receives the raw Postgres message. */
  aturan?: (pesan: string) => string;
  /**
   * SQLSTATEs whose message our own SQL wrote (`0002_batch_operations.sql`),
   * with the `ActionErrorCode` each one maps to. Checked before anything else,
   * and the message is shown verbatim unless it reads like Postgres prose.
   */
  sendiri?: Readonly<Partial<Record<string, ActionErrorCode>>>;
  /** Replacement sentences for codes in `sendiri` whose message names a uuid. */
  ulang?: Readonly<Partial<Record<string, string>>>;
  /** Suffix after an `IncompleteReadError` message; default asks for the admin. */
  bacaTerpotong?: string;
  /** GAGAL sentence for a code nobody knows; default is the generic one. */
  fallback?: string;
};

/** What Postgres's own English sounds like; our SQL never says any of these. */
const POSTGRES_ENGLISH =
  /\b(violates|permission denied|denied for|policy|constraint|null value|syntax error|invalid input|does not exist)\b/i;

/** Generic sentence per code, for an own-SQL code whose message turned out to be Postgres's. */
const GENERIC_BY_CODE: Record<ActionErrorCode, string> = {
  TIDAK_LOGIN: "Anda belum login.",
  BUKAN_ADMIN: UI.hanyaAdmin,
  VALIDASI: "Data yang dikirim ditolak database. Periksa kembali isian.",
  TIDAK_DITEMUKAN: "Data yang dituju tidak ditemukan lagi. Muat ulang halaman.",
  KONFLIK:
    "Perubahan bentrok dengan keadaan data sekarang. Muat ulang halaman, lalu coba lagi.",
  GAGAL: "Gagal menyimpan perubahan. Coba lagi.",
};

const GAGAL_UMUM = "Gagal menyimpan perubahan. Coba lagi.";

/** The PostgREST message, without the `"<context>: "` prefix `DbError` adds. */
function rawMessage(error: DbError): string {
  const cause = error.cause;
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return error.message;
}

function fieldErrorsOf(wording: FailureWording): Record<string, string> | undefined {
  if (!wording.field) return undefined;
  return { [wording.field]: wording.fieldMessage ?? wording.message };
}

function hanyaAdmin(ctx: DbErrorContext): string {
  const aksi = ctx.aksi ?? `mengubah ${ctx.entitas}`;
  return `Perubahan ditolak database: akun Anda tidak berhak ${aksi}. Muat ulang halaman, lalu hubungi admin HC Core kalau masih ditolak.`;
}

/**
 * Translate a thrown value into an `ActionError` with an Indonesian message.
 *
 * Returns `unknown` on purpose: what is not a database failure —
 * `ActionError`, `UnauthenticatedError`, `ForbiddenError`, or anything else
 * when no `fallback` is given — is handed back untouched for
 * `toActionFailure()` to report. The shape every action uses:
 *
 *     } catch (error) {
 *       return toActionFailure(mapDbError(error, KARYAWAN_DB));
 *     }
 */
export function mapDbError(error: unknown, ctx: DbErrorContext): unknown {
  if (
    error instanceof ActionError ||
    error instanceof UnauthenticatedError ||
    error instanceof ForbiddenError
  ) {
    return error;
  }

  if (error instanceof IncompleteReadError) {
    // Nothing failed — the read came back short, and whatever was about to be
    // decided on it would have been decided on half the data. Refusing is the
    // only honest answer, and it must not read as "coba lagi".
    return new ActionError(
      "GAGAL",
      `${error.message} ${ctx.bacaTerpotong ?? "Hubungi admin HC Core."}`,
    );
  }

  if (!(error instanceof DbError)) {
    if (ctx.fallback === undefined) return error;
    logError("action", error, { entitas: ctx.entitas });
    return new ActionError("GAGAL", ctx.fallback);
  }

  const code = error.code ?? "";
  const raw = rawMessage(error);

  const own = ctx.sendiri?.[code];
  if (own) {
    const reworded = ctx.ulang?.[code];
    if (reworded) return new ActionError(own, reworded);
    return new ActionError(own, POSTGRES_ENGLISH.test(raw) ? GENERIC_BY_CODE[own] : raw);
  }

  switch (code) {
    case "23505": {
      const detail = `${raw} ${error.details ?? ""}`;
      const rule = ctx.unik?.find((candidate) => detail.includes(candidate.cocok));
      const wording = rule ?? ctx.unikDefault;
      if (!wording) return new ActionError("KONFLIK", BY_CODE["23505"].message);
      return new ActionError("KONFLIK", wording.message, fieldErrorsOf(wording));
    }
    case "23503": {
      const wording = ctx.rujukan;
      if (!wording) return new ActionError("KONFLIK", BY_CODE["23503"].message);
      return new ActionError("KONFLIK", wording.message, fieldErrorsOf(wording));
    }
    case "23514":
      return new ActionError(
        "KONFLIK",
        ctx.aturan ? ctx.aturan(raw) : BY_CODE["23514"].message,
      );
    case "42501":
      // `with check (is_admin())` on INSERT really does raise
      // insufficient_privilege. The action checked the role too — both, not
      // either (CLAUDE.md) — so reaching here means the role changed mid-request.
      return new ActionError("BUKAN_ADMIN", hanyaAdmin(ctx));
    case "PGRST116":
      // An UPDATE refused by RLS matches zero rows; `.single()` reports that as
      // PGRST116. The row was read a moment ago and nothing is ever deleted,
      // so the refusal is the cause — say so instead of "coba lagi".
      return new ActionError(
        "BUKAN_ADMIN",
        `${hanyaAdmin(ctx)} Kalau Anda memang admin, baris ini baru saja berubah — muat ulang halaman lalu coba lagi.`,
      );
    default:
      // A database error nobody translated is worth seeing in the server log
      // even when the user gets a decent sentence.
      logError("action", error, { entitas: ctx.entitas });
      return new ActionError("GAGAL", ctx.fallback ?? GAGAL_UMUM);
  }
}
