/**
 * Where the emailed sign-in link lands.
 *
 * `requestMagicLink()` asks Supabase to send a link pointing here. Supabase
 * verifies the token on its own domain and then bounces the browser back with
 * either a PKCE `code` (the flow `@supabase/ssr` uses by default) or a
 * `token_hash` + `type` pair (the older email-link shape). Both are handled,
 * because which one arrives depends on how the Supabase project's email
 * template is written, and that is not settable from this repo.
 *
 * This has to be a Route Handler rather than a page: exchanging the code sets
 * the session cookies, and a Server Component may not write cookies.
 *
 * Every failure path ends at `/login?pesan=<code>` with a code from the closed
 * set in `lib/auth/errors.ts` — never with text taken from the URL.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { looksLikeDomainRejection } from "@/lib/auth/errors";
import { loginHref, safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OTP_TYPES: readonly EmailOtpType[] = [
  "email",
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));

  // Keep `next` on every failure path too: a user who asks for a fresh link
  // after an expired one should still land where they were going.
  const fail = (pesan: string) =>
    NextResponse.redirect(new URL(loginHref({ next, pesan }), request.url));

  // Supabase reports its own refusals in the query string.
  if (searchParams.get("error") || searchParams.get("error_code")) {
    const code = searchParams.get("error_code") ?? "";
    const description = searchParams.get("error_description") ?? "";
    // A first sign-in from outside the office domain surfaces here, as
    // `handle_new_user()` aborting the INSERT into auth.users.
    if (looksLikeDomainRejection(description)) return fail("domain");
    return fail(
      code.includes("expired") || code === "otp_expired"
        ? "tautan-kedaluwarsa"
        : "tautan-gagal",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return fail("konfigurasi");

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");

  try {
    const client = await createClient();

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) return fail(otpFailureCode(error.code, error.message));
      return NextResponse.redirect(new URL(next, request.url));
    }

    if (tokenHash && rawType && isOtpType(rawType)) {
      const { error } = await client.auth.verifyOtp({
        type: rawType,
        token_hash: tokenHash,
      });
      if (error) return fail(otpFailureCode(error.code, error.message));
      return NextResponse.redirect(new URL(next, request.url));
    }
  } catch (error) {
    console.error("[login/callback]", error);
    return fail("tautan-gagal");
  }

  // Someone opened /login/callback by hand.
  return fail("tautan-gagal");
}

function isOtpType(value: string): value is EmailOtpType {
  return (OTP_TYPES as readonly string[]).includes(value);
}

function otpFailureCode(code: string | undefined, message: string): string {
  const haystack = `${code ?? ""} ${message}`.toLowerCase();
  if (looksLikeDomainRejection(haystack)) return "domain";
  return haystack.includes("expired") || haystack.includes("already used")
    ? "tautan-kedaluwarsa"
    : "tautan-gagal";
}
