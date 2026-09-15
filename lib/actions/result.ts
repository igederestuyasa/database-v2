/**
 * The result shape every Server Action ends with, and the one function that
 * turns anything thrown into it.
 *
 * A returned failure, not a thrown one: a Server Action that throws reaches
 * the client as an opaque digest, which tells staf HC nothing.
 *
 * Pure — no `next/*` — so `toActionFailure()` can be reasoned about and tested
 * without a request. Action files import all of this from `./_guard`, which
 * re-exports it.
 */
import type { z } from "zod";

import { DbError } from "@/lib/db/shared";
import { logError } from "@/lib/log";
import { formatZodErrors } from "@/lib/validation/common";

import {
  ActionError,
  ForbiddenError,
  UnauthenticatedError,
  type ActionErrorCode,
} from "./errors";
import { classifyDatabaseError } from "./pgErrors";

export type ActionSuccess<T> = { ok: true; data: T };

export type ActionFailure = {
  ok: false;
  error: {
    code: ActionErrorCode;
    /** Indonesian, ready to show in a toast. */
    message: string;
    /** Per-field messages for react-hook-form, when the failure is validation. */
    fieldErrors?: Record<string, string>;
  };
};

/** What every Server Action returns. */
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export function actionOk<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function actionFail(
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
): ActionFailure {
  return { ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } };
}

/** Shorthand for a failed `safeParse`. */
export function actionInvalid(error: z.ZodError): ActionFailure {
  const { fieldErrors, messages } = formatZodErrors(error);
  return actionFail(
    "VALIDASI",
    messages[0] ?? "Data yang dikirim tidak valid.",
    fieldErrors,
  );
}

/**
 * Turn anything thrown inside an action into a failure the UI can render.
 *
 * Unexpected errors are logged server-side and reported generically: a
 * PostgREST message ("duplicate key value violates unique constraint …") is
 * not something staf HC should have to read.
 *
 * A `DbError` an action did not translate (see `mapDbError` in `pgErrors.ts`)
 * falls back to the shared defaults there rather than straight to the
 * catch-all. This is the floor, not the ceiling: without it, forgetting one
 * code turns an RLS refusal into "coba lagi", which asks the user to retry a
 * write that can never succeed.
 */
export function toActionFailure(error: unknown): ActionFailure {
  if (error instanceof UnauthenticatedError) {
    return actionFail("TIDAK_LOGIN", error.message);
  }
  if (error instanceof ForbiddenError) {
    return actionFail("BUKAN_ADMIN", error.message);
  }
  if (error instanceof ActionError) {
    return actionFail(error.code, error.message, error.fieldErrors);
  }
  if (error instanceof DbError) {
    const known = classifyDatabaseError(error.code);
    // Logged either way: a database error nobody translated is worth seeing in
    // the server log even when the user gets a decent sentence.
    logError("action", error);
    if (known) return actionFail(known.code, known.message);
    return actionFail("GAGAL", "Gagal menyimpan perubahan. Coba lagi.");
  }
  logError("action", error);
  return actionFail("GAGAL", "Gagal menyimpan perubahan. Coba lagi.");
}
