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
import { cache } from "react";
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
 * Who is signed in, as far as this request knows — one of four states.
 *
 * The middle two are real and must not be collapsed into "tamu": Supabase Auth
 * knows the account but `profiles` has no row for it (created outside the
 * `on_auth_user_created` trigger), or the `profiles` select itself failed.
 * Sending either to the login form would loop; `requireUser()` and
 * `lib/auth/session.ts` decide what each one means for a write and for a page.
 */
export type VerifiedSession =
  | { status: "tamu"; client: DbClient }
  | { status: "tanpa-profil"; client: DbClient }
  | { status: "profil-gagal"; client: DbClient }
  | { status: "masuk"; client: DbClient; user: SessionUser };

/**
 * THE ONE PLACE identity is verified, memoised for the lifetime of a request.
 *
 * `auth.getUser()` (a round trip that verifies the token with the Auth server)
 * rather than `getSession()` (which believes whatever the cookie says), then
 * one select on `profiles` for the role.
 *
 * Wrapped in `React.cache()` because a single navigation used to pay for this
 * three times over: `middleware.ts` verifies once, the sidebar in
 * `app/(app)/layout.tsx` asked again, and the page asked a third time through
 * `requireUser()` — each with its own `getUser()` and its own `profiles` read.
 * `cache()` lives exactly as long as one request and nothing longer: it is not
 * a session cache, and it cannot hand one visitor's session to another's
 * request. Every guard below and every page helper in `lib/auth/session.ts`
 * reads through here, so there is one answer per request, however many
 * components ask.
 */
export const readVerifiedSession = cache(
  async function readVerifiedSession(): Promise<VerifiedSession> {
    const client = await createClient();

    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { status: "tamu", client };

    const profile = await client
      .from("profiles")
      .select("id, email, role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile.error) return { status: "profil-gagal", client };
    if (!profile.data) return { status: "tanpa-profil", client };

    return {
      status: "masuk",
      client,
      user: {
        id: profile.data.id,
        email: profile.data.email,
        role: profile.data.role === "admin" ? "admin" : "viewer",
      },
    };
  },
);

/**
 * Any signed-in user (admin or viewer). Throws `UnauthenticatedError`.
 *
 * Reads still go through RLS, so this is about failing early and readably, not
 * about being the only thing standing between a stranger and the data.
 */
export async function requireUser(): Promise<GuardContext> {
  const session = await readVerifiedSession();
  switch (session.status) {
    case "tamu":
      throw new UnauthenticatedError();
    case "profil-gagal":
      throw new ActionError("GAGAL", "Gagal memeriksa profil pengguna.");
    case "tanpa-profil":
      // The `handle_new_user` trigger creates the profile at first login, so a
      // missing one means the account was made another way. Refuse rather than
      // guess a role.
      throw new ForbiddenError(
        "Profil pengguna belum dibuat. Hubungi admin HC Core.",
      );
    case "masuk":
      return { client: session.client, user: session.user };
  }
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
