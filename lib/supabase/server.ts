/**
 * Server Supabase client (anon key + the signed-in user's cookie session).
 *
 * This is the client every Server Component and Server Action uses, so that
 * RLS sees the real user and `auth.uid()` resolves. Role checks still happen
 * in the Server Action as well — both, not either (CLAUDE.md).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requirePublicEnv } from "@/lib/env";
import type { Database } from "@/lib/types/db";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = requirePublicEnv();

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
          // Refreshing the session is `middleware.ts`'s job — it runs on every
          // request under app/(app) and can write cookies — so a refresh that
          // happens to fire here is dropped on purpose, not lost.
        }
      },
    },
  });
}
