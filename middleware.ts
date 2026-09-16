/**
 * THE AUTHENTICATION BOUNDARY.
 *
 * ADR-005 §11 left this file out of the foundation on purpose and wrote down
 * what it has to do. Both halves matter, and only one of them is obvious:
 *
 *   1. **Nobody reaches `app/(app)/**` without a session.** Without this file
 *      every page in the application is a public URL. The pages check again
 *      (`lib/auth/session.ts`) and RLS checks a third time — but a request
 *      should not get as far as a query before anyone asks who is asking.
 *
 *   2. **The access token is refreshed here, and only here.** `@supabase/ssr`
 *      can write refreshed auth cookies only from a Route Handler, a Server
 *      Action or middleware. `lib/supabase/server.ts` swallows its cookie
 *      writes in a `try/catch` because a Server Component may not set cookies,
 *      so without this file a long-open tab loses its session and has no way
 *      back. Hence `supabase.auth.getUser()` below: it is not only the check,
 *      it is also what triggers the refresh.
 *
 * `auth.getUser()`, never `getSession()`: this is a security decision, and
 * `getSession()` believes whatever the cookie says (matching
 * `lib/actions/_guard.ts`).
 *
 * `/api/v1/**` is excluded in the matcher. Those routes authenticate Konsumen
 * with an API key and must never be redirected to an HTML login page
 * (ADR-004, API-CONTRACT.md).
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath, loginHref } from "@/lib/auth/redirect";
import { readPublicEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  // `readPublicEnv()` never throws (lib/env.ts): a throw here would turn a
  // missing `.env.local` into a 500 on every URL.
  const env = readPublicEnv();

  if (!env) {
    // No Supabase means no session can exist. Failing OPEN here would publish
    // the whole application, so an unconfigured deployment shows the login page
    // and says why, instead of 500-ing on every URL.
    if (isPublic) return NextResponse.next({ request });
    return redirectTo(request, loginHref({ pesan: "konfigurasi" }));
  }

  // `response` is reassigned by `setAll` below, which is how the refreshed
  // cookies reach the browser. Keep the reference; do not build a new
  // NextResponse afterwards without copying its cookies over.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    userId = error ? null : (data.user?.id ?? null);
  } catch {
    // Supabase unreachable (which is the state of this environment — ADR-005).
    // Treat it as "not signed in": deny, never assume.
    userId = null;
  }

  if (!userId && !isPublic) {
    const next = `${pathname}${search}`;
    // Tanpa `pesan`: halaman Masuk tidak perlu memberi tahu orang yang sedang
    // menatap form masuk bahwa ia harus masuk dulu. `next` yang penting —
    // itulah yang mengembalikannya ke halaman yang ia tuju.
    return redirectTo(request, loginHref({ next }), response);
  }

  // A signed-in visitor is NOT bounced away from /login: that page doubles as
  // the account page, where "Keluar" lives.
  return response;
}

/**
 * Redirect, carrying over any cookies Supabase just refreshed.
 *
 * Dropping them would make the redirect undo the refresh, and the next request
 * would arrive with the same expired token.
 */
function redirectTo(
  request: NextRequest,
  href: string,
  carry?: NextResponse,
): NextResponse {
  const target = new URL(href, request.url);
  const redirect = NextResponse.redirect(target);
  if (carry) {
    for (const cookie of carry.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
  }
  return redirect;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/v1          — Konsumen REST API, authenticated by API key (ADR-004)
     *   _next/static    — build output
     *   _next/image     — image optimiser
     *   favicon.ico, and static asset extensions
     */
    "/((?!api/v1|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml|woff|woff2|ttf)$).*)",
  ],
};
