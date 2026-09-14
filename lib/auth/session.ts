/**
 * Session & role helpers for SERVER COMPONENTS.
 *
 * `lib/actions/_guard.ts` already owns the security decision: it calls
 * `auth.getUser()` (verified with the Auth server) rather than `getSession()`
 * (which trusts the cookie), then reads `profiles.role`. This module does NOT
 * repeat any of that — it wraps `requireUser()` so a page can `redirect()`
 * instead of catching, which is the one thing a Server Action must never do.
 *
 * Division of labour:
 *
 *   * `middleware.ts`  — refreshes the token and bounces strangers to /login.
 *   * this module      — what a page renders once it is past the middleware.
 *   * `_guard.ts`      — what a Server Action does before it writes.
 *   * RLS              — the wall all three stand in front of (CLAUDE.md:
 *                        "Cek role di Server Action **dan** RLS").
 */
import { cache } from "react";
import { redirect } from "next/navigation";

import {
  ForbiddenError,
  UnauthenticatedError,
  requireUser,
  type AppRole,
  type GuardContext,
  type SessionUser,
} from "@/lib/actions/_guard";

import { loginHref } from "./redirect";

export type { AppRole, SessionUser };

/** A signed-in user plus a Supabase client bound to their session. */
export type PageSession = GuardContext;

/**
 * Three states, because the middle one is real: Supabase Auth knows the
 * account, but `profiles` has no row for it (an account created outside the
 * `on_auth_user_created` trigger). Collapsing that into "not signed in" would
 * send the visitor round the /login loop forever, and tell them to sign in when
 * they already are.
 */
export type SessionState =
  | { status: "tamu" }
  | { status: "tanpa-profil" }
  | { status: "masuk"; client: PageSession["client"]; user: SessionUser };

/**
 * Wrapped in `React.cache` so one request asks once.
 *
 * `requireUser()` makes a verified `auth.getUser()` round trip to the Auth
 * server plus a `profiles` select, and since the sidebar in
 * `app/(app)/layout.tsx` now needs to know who is signed in, the layout and the
 * page it wraps would otherwise do that pair twice per navigation. `cache()`
 * memoises for the lifetime of a single request and nothing longer — it is not
 * a session cache, and it cannot leak one user's session into another's
 * request.
 */
export const readSession = cache(async function readSession(): Promise<SessionState> {
  try {
    const { client, user } = await requireUser();
    return { status: "masuk", client, user };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { status: "tamu" };
    if (error instanceof ForbiddenError) return { status: "tanpa-profil" };
    // A database failure is not "please sign in" — let `error.tsx` show it.
    throw error;
  }
});

/**
 * The session, or a redirect to `/login` that says WHICH problem it is.
 *
 * `middleware.ts` normally gets there first; this is the second lock, for the
 * case where the cookie survived the matcher but the token no longer resolves.
 */
export async function requirePageSession(
  currentPath?: string,
): Promise<PageSession> {
  const state = await readSession();

  if (state.status === "tamu") {
    redirect(loginHref({ next: currentPath, pesan: "login" }));
  }
  if (state.status === "tanpa-profil") {
    redirect(loginHref({ next: currentPath, pesan: "profil" }));
  }

  return { client: state.client, user: state.user };
}

/** For deciding whether to render an admin-only control. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const state = await readSession();
  return state.status === "masuk" && state.user.role === "admin";
}
