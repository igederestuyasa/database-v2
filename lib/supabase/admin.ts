// ============================================================================
// SERVICE-ROLE CLIENT — BYPASSES ROW LEVEL SECURITY.
//
// THIS MODULE MAY ONLY BE IMPORTED BY:
//     app/api/v1/**      (Konsumen REST API — authenticated by API key)
//     scripts/**         (one-shot seed / maintenance scripts)
//
// Importing it anywhere else — a page, a layout, a Server Action, a Client
// Component, lib/db/**, lib/actions/** — is a bug. Those paths must use
// `lib/supabase/server.ts` so RLS and `auth.uid()` still apply.
// (ARCHITECTURE.md §6, ADR-004, CLAUDE.md.)
//
// Route handlers under app/api/v1 may read ONLY `v_employees_api`,
// `org_units`, `jabatan` and `lookups` — never `employee_private` or
// `v_employees_private`.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/db";

export type AdminClient = SupabaseClient<Database>;

/**
 * Builds a fresh service-role client.
 *
 * A factory, not a module-level singleton, so that callers (and their tests)
 * can construct or substitute one per request instead of inheriting shared
 * state at import time.
 */
export function createAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL belum diisi. Lihat .env.example.",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY belum diisi (server only). Lihat .env.example.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      // No cookie session, no refresh: this client is never a logged-in user.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
