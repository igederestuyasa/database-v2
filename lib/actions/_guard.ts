/**
 * The guard every Server Action starts with, and the result shape every Server
 * Action ends with.
 *
 * FROZEN CONTRACT (Wave 1). CLAUDE.md: "Cek role di Server Action **dan** RLS
 * — keduanya, bukan salah satu." RLS is the wall; this is the door. Both are
 * needed: RLS alone would let an action get as far as a confusing database
 * error, and an action check alone would be bypassed the moment anything talks
 * to the database another way.
 *
 * This module is NOT a `"use server"` file — it exports classes and types, and
 * a `"use server"` module may only export async functions. Import it from the
 * action files, which are.
 *
 *     "use server";
 *     export async function renameJabatan(input: JabatanRenameInput) {
 *       const parsed = jabatanRenameSchema.safeParse(input);
 *       if (!parsed.success) return actionInvalid(parsed.error);
 *       try {
 *         const { client } = await requireAdmin();
 *         …
 *       } catch (error) {
 *         return toActionFailure(error);
 *       }
 *     }
 *
 * See `lib/actions/_reference.ts` for the whole thing worked through.
 */
import type { z } from "zod";

import { DbError, type DbClient } from "@/lib/db/shared";
import { createClient } from "@/lib/supabase/server";
import { formatZodErrors } from "@/lib/validation/common";
import { UI } from "@/lib/i18n/terms";

import { classifyDatabaseError } from "./pgErrors";

/** `profiles.role` (ARCHITECTURE.md §5). */
export type AppRole = "admin" | "viewer";

/** The signed-in user, as every Server Action needs them. */
export type SessionUser = {
  id: string;
  email: string;
  role: AppRole;
};

/** What a guard hands back: a client bound to this user's session, and them. */
export type GuardContext = {
  client: DbClient;
  user: SessionUser;
};

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

/**
 * What every Server Action returns.
 *
 * A returned failure, not a thrown one: a Server Action that throws reaches
 * the client as an opaque digest, which tells staf HC nothing.
 */
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
 * A `DbError` an action did not translate itself falls back to the shared
 * defaults in `pgErrors.ts` rather than straight to the catch-all. An entity
 * that words `23505` better than "nilai ini sudah dipakai" still should, and
 * still does — it converts to an `ActionError` first and never reaches here.
 * This is the floor, not the ceiling: without it, forgetting one code turns an
 * RLS refusal into "coba lagi", which asks the user to retry a write that can
 * never succeed.
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
    console.error("[action]", error);
    if (known) return actionFail(known.code, known.message);
    return actionFail("GAGAL", "Gagal menyimpan perubahan. Coba lagi.");
  }
  console.error("[action]", error);
  return actionFail("GAGAL", "Gagal menyimpan perubahan. Coba lagi.");
}

/**
 * The signed-in user, or `null`.
 *
 * Uses `auth.getUser()`, which verifies the token with the Auth server, rather
 * than `getSession()`, which trusts whatever the cookie says.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const client = await createClient();

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  const profile = await client
    .from("profiles")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile.error || !profile.data) return null;

  return {
    id: profile.data.id,
    email: profile.data.email,
    role: profile.data.role === "admin" ? "admin" : "viewer",
  };
}

/**
 * Any signed-in user (admin or viewer). Throws `UnauthenticatedError`.
 *
 * Reads still go through RLS, so this is about failing early and readably, not
 * about being the only thing standing between a stranger and the data.
 */
export async function requireUser(): Promise<GuardContext> {
  const client = await createClient();

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new UnauthenticatedError();

  const profile = await client
    .from("profiles")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile.error) {
    throw new ActionError("GAGAL", "Gagal memeriksa profil pengguna.");
  }
  if (!profile.data) {
    // The `handle_new_user` trigger creates the profile at first login, so a
    // missing one means the account was made another way. Refuse rather than
    // guess a role.
    throw new ForbiddenError(
      "Profil pengguna belum dibuat. Hubungi admin HC Core.",
    );
  }

  return {
    client,
    user: {
      id: profile.data.id,
      email: profile.data.email,
      role: profile.data.role === "admin" ? "admin" : "viewer",
    },
  };
}

/**
 * An admin. Throws `UnauthenticatedError` or `ForbiddenError`.
 *
 * Every write in the application starts here (ARCHITECTURE.md §5: tambah/edit,
 * CRUD & merge Data Referensi, revert, dan kelola API Key semuanya admin).
 */
export async function requireAdmin(): Promise<GuardContext> {
  const context = await requireUser();
  if (context.user.role !== "admin") throw new ForbiddenError();
  return context;
}

/** Non-throwing variant, for deciding whether to render a button. */
export async function isAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  return user?.role === "admin";
}
