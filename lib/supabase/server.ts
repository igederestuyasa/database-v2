/**
 * Server Supabase client (anon key + the signed-in user's cookie session).
 *
 * This is the client every Server Component and Server Action uses, so that
 * RLS sees the real user and `auth.uid()` resolves. Role checks still happen
 * in the Server Action as well — both, not either (CLAUDE.md).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/db";

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi. Lihat .env.example.",
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Refreshing the session is middleware's job — and `middleware.ts`
          // does not exist yet (ADR-005 §11). Until the login unit adds it,
          // an expired token is silently not refreshed here.
        }
      },
    },
  });
}
