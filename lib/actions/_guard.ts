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
 * What lives where, since the refactor that split this file:
 *
 *   * `./errors.ts`   — `ActionError`, `UnauthenticatedError`,
 *                       `ForbiddenError`, `ActionErrorCode`.
 *   * `./result.ts`   — `ActionResult` and friends, `toActionFailure()`.
 *   * `./pgErrors.ts` — `mapDbError()`, the one database-error translation.
 *   * this file       — who is signed in. The only impure part.
 *
 * The three helpers are pure (no `next/*`) and unit-tested; this module
 * re-exports them so an action still imports everything from one place:
 *
 *     "use server";
 *     export async function renameJabatan(input: JabatanRenameInput) {
 *       const parsed = jabatanRenameSchema.safeParse(input);
 *       if (!parsed.success) return actionInvalid(parsed.error);
 *       try {
 *         const { client } = await requireAdmin();
 *         …
 *       } catch (error) {
 *         return toActionFailure(mapDbError(error, JABATAN_DB));
 *       }
 *     }
 *
 * This module is NOT a `"use server"` file — it exports classes and types, and
 * a `"use server"` module may only export async functions. Import it from the
 * action files, which are. See `lib/actions/_reference.ts` for the whole thing
 * worked through.
 */
import { cache } from "react";

import type { DbClient } from "@/lib/db/shared";
import { createClient } from "@/lib/supabase/server";

import { ActionError, ForbiddenError, UnauthenticatedError } from "./errors";

export { ActionError, ForbiddenError, UnauthenticatedError } from "./errors";
export type { ActionErrorCode } from "./errors";
export { actionFail, actionInvalid, actionOk, toActionFailure } from "./result";
export type { ActionFailure, ActionResult, ActionSuccess } from "./result";

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
