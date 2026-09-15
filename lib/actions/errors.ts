/**
 * The three errors a Server Action throws, and the codes a failure carries.
 *
 * Pure on purpose — no `next/*`, no database — so `pgErrors.ts` and
 * `result.ts` can import the classes and still be unit-tested in plain node.
 * Action files import them from `./_guard`, which re-exports everything here;
 * the split exists only so the mapping code can be tested.
 */
import { UI } from "@/lib/i18n/terms";

export type ActionErrorCode =
  /** Not signed in. */
  | "TIDAK_LOGIN"
  /** Signed in as viewer, action needs admin. */
  | "BUKAN_ADMIN"
  /** zod rejected the input. */
  | "VALIDASI"
  /** The row does not exist (any more). */
  | "TIDAK_DITEMUKAN"
  /** A UNIQUE constraint, a Batch already reverted, a stale edit. */
  | "KONFLIK"
  /** Anything else. */
  | "GAGAL";

/** Nobody is signed in. */
export class UnauthenticatedError extends Error {
  constructor(message = "Anda belum login.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** Signed in, but not an admin. */
export class ForbiddenError extends Error {
  constructor(message: string = UI.hanyaAdmin) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Something the action refuses for a reason the user can act on. */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors: Record<string, string> | undefined;

  constructor(
    code: ActionErrorCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
