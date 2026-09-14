/**
 * Browser Supabase client (anon key, RLS applies).
 *
 * Read-only convenience for Client Components. Every write from the UI goes
 * through a Server Action in `lib/actions/` — never
 * `supabase.from(...).insert/update` in a Client Component (CLAUDE.md).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/db";

export function createClient() {
  return createBrowserClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

function requiredEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  // Must be indexed literally so Next can inline NEXT_PUBLIC_* at build time.
  const value =
    name === "NEXT_PUBLIC_SUPABASE_URL"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) {
    throw new Error(
      `Environment variable ${name} belum diisi. Lihat .env.example.`,
    );
  }
  return value;
}
