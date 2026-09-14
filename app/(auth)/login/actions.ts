"use server";

/**
 * Sign-in, sign-out, and the magic link — the only three writes on this page.
 *
 * Shape follows `lib/actions/_reference.ts`: validate with zod, act, map every
 * failure to an Indonesian message, return an `ActionResult` instead of
 * throwing (a thrown Server Action reaches the browser as an opaque digest).
 *
 * There is no role guard here, on purpose: these run BEFORE anyone has a role.
 * The gate is the office email domain, checked twice — once here so the message
 * is readable, and once in the database by `handle_new_user()`, which is the
 * one that actually decides (see `lib/auth/domain.ts`).
 *
 * No Batch is opened: nothing in `public` is written. The `profiles` row a
 * first sign-in creates is inserted by the `on_auth_user_created` trigger, and
 * `log_revision` on `profiles` records it — ADR-005 §12, and the reason
 * application code must not write that row itself.
 */
import { headers } from "next/headers";
import { z } from "zod";

import {
  actionFail,
  actionInvalid,
  actionOk,
  type ActionFailure,
  type ActionResult,
} from "@/lib/actions/_guard";
import {
  isOfficeEmail,
  isValidEmailShape,
  normalizeEmail,
  officeEmailMessage,
} from "@/lib/auth/domain";
import { readAllowedEmailDomain, readSupabaseEnv } from "@/lib/auth/env";
import { authErrorMessage } from "@/lib/auth/errors";
import {
  LOGIN_CALLBACK_PATH,
  loginHref,
  safeNextPath,
} from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const emailField = z
  .string({ error: "Email kantor wajib diisi." })
  .trim()
  .min(1, { error: "Email kantor wajib diisi." })
  .max(254, { error: "Email terlalu panjang." })
  .refine(isValidEmailShape, { error: "Format email tidak dikenali." });

const nextField = z.string().optional();

const passwordSchema = z.object({
  email: emailField,
  password: z
    .string({ error: "Kata sandi wajib diisi." })
    .min(1, { error: "Kata sandi wajib diisi." }),
  next: nextField,
});

const magicLinkSchema = z.object({
  email: emailField,
  next: nextField,
});

export type PasswordSignInInput = z.input<typeof passwordSchema>;
export type MagicLinkInput = z.input<typeof magicLinkSchema>;

/** Sign in with email + password. */
export async function signInWithPassword(
  input: PasswordSignInInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);

  const email = normalizeEmail(parsed.data.email);
  const allowedDomain = readAllowedEmailDomain();

  if (!isOfficeEmail(email, allowedDomain)) {
    return actionFail("VALIDASI", officeEmailMessage(allowedDomain), {
      email: officeEmailMessage(allowedDomain),
    });
  }

  const configError = supabaseConfigFailure();
  if (configError) return configError;

  try {
    const client = await createClient();
    const { error } = await client.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

    if (error) {
      return actionFail(
        "GAGAL",
        // `context: "masuk"` — this call cannot create an account, so a 500
        // here is never the office-domain trigger (see lib/auth/errors.ts).
        authErrorMessage(error, { allowedDomain, context: "masuk" }),
      );
    }

    return actionOk({ redirectTo: safeNextPath(parsed.data.next) });
  } catch (error) {
    console.error("[login] signInWithPassword", error);
    return actionFail(
      "GAGAL",
      authErrorMessage(asAuthError(error), { allowedDomain, context: "masuk" }),
    );
  }
}

/**
 * Email a one-time sign-in link.
 *
 * `shouldCreateUser` is left at its default (true): a first-time user IS
 * created by this call, and `on_auth_user_created` then either rejects the
 * address for not being an office email or creates their `profiles` row as
 * `viewer` (ARCHITECTURE.md §5). That is the intended onboarding path — an
 * admin promotes them afterwards on /pengguna.
 */
export async function requestMagicLink(
  input: MagicLinkInput,
): Promise<ActionResult<{ email: string }>> {
  const parsed = magicLinkSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);

  const email = normalizeEmail(parsed.data.email);
  const allowedDomain = readAllowedEmailDomain();

  if (!isOfficeEmail(email, allowedDomain)) {
    return actionFail("VALIDASI", officeEmailMessage(allowedDomain), {
      email: officeEmailMessage(allowedDomain),
    });
  }

  const configError = supabaseConfigFailure();
  if (configError) return configError;

  try {
    const client = await createClient();
    const origin = await siteOrigin();
    const next = safeNextPath(parsed.data.next);
    const emailRedirectTo = origin
      ? `${origin}${LOGIN_CALLBACK_PATH}?next=${encodeURIComponent(next)}`
      : undefined;

    const { error } = await client.auth.signInWithOtp({
      email,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });

    if (error) {
      // `context: "pendaftaran"` — this call CAN create the account, so
      // `handle_new_user()` rejecting the domain is a real possibility here.
      return actionFail(
        "GAGAL",
        authErrorMessage(error, { allowedDomain, context: "pendaftaran" }),
      );
    }

    return actionOk({ email });
  } catch (error) {
    console.error("[login] requestMagicLink", error);
    return actionFail(
      "GAGAL",
      authErrorMessage(asAuthError(error), {
        allowedDomain,
        context: "pendaftaran",
      }),
    );
  }
}

/**
 * Sign out and clear the session cookies.
 *
 * A reported error is logged but NOT turned into a failure. `auth-js` removes
 * the local session (i.e. expires the cookies) on every path that returns an
 * error other than a missing session — so by the time this returns, this
 * browser is signed out whether or not Supabase answered. Telling the user
 * "gagal" while their cookies are gone, and leaving them on the page, is the
 * one outcome that would be wrong: on a shared HC workstation they would walk
 * away believing they were still signed in, or that they were not.
 */
export async function signOut(): Promise<ActionResult<{ redirectTo: string }>> {
  const configError = supabaseConfigFailure();
  if (configError) return configError;

  try {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) {
      // Worth knowing about (other devices may still hold a session), but not
      // worth blocking the user on.
      console.error("[login] signOut", error);
    }
    return actionOk({ redirectTo: loginHref({ pesan: "keluar" }) });
  } catch (error) {
    console.error("[login] signOut", error);
    return actionFail(
      "GAGAL",
      "Gagal keluar. Tutup peramban untuk mengakhiri sesi, lalu coba lagi.",
    );
  }
}

/**
 * The origin this request arrived on, for the magic link's `emailRedirectTo`.
 *
 * There is no `NEXT_PUBLIC_SITE_URL` in the environment contract (CLAUDE.md
 * lists four variables and this is not one), so it is derived from the request
 * rather than invented.
 *
 * `Origin` is preferred over `Host` because Next already verifies it against
 * the deployment's own host before a Server Action runs. The `Host` fallback is
 * spoofable in principle; what stops a forged value from producing a working
 * link to somebody else's site is Supabase's Redirect URL allow-list, which
 * refuses any `emailRedirectTo` outside the configured origins. Keep that list
 * tight in the Supabase dashboard — it is the real gate here.
 */
async function siteOrigin(): Promise<string | null> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return null;
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** One message for "the deployment has no Supabase", instead of a raw throw. */
function supabaseConfigFailure(): ActionFailure | null {
  if (readSupabaseEnv()) return null;
  return actionFail(
    "GAGAL",
    "Koneksi ke Supabase belum dikonfigurasi, jadi belum ada yang bisa masuk. Hubungi admin HC Core.",
  );
}

/** Narrow an unknown throw to the shape `authErrorMessage` reads. */
function asAuthError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as { name?: string; message?: string };
    return { name: candidate.name, message: candidate.message };
  }
  return null;
}
