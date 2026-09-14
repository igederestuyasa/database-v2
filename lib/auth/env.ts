/**
 * The three environment variables the sign-in flow needs, read in one place.
 *
 * Server-side only — `ALLOWED_EMAIL_DOMAIN` is deliberately NOT a
 * `NEXT_PUBLIC_*` variable, so the login page reads it here and passes the
 * domain down to the form as a prop.
 *
 * Nothing here throws. `lib/supabase/{client,server}.ts` already throw when the
 * Supabase keys are missing, and a throw inside `middleware.ts` would turn a
 * missing `.env.local` into a 500 on every URL in the app. Instead the caller
 * asks `isSupabaseConfigured()` and renders a readable Indonesian notice.
 */
import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  normalizeDomain,
} from "./domain";

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

/**
 * `NEXT_PUBLIC_*` must be indexed literally so Next can inline it at build
 * time — `process.env[name]` is not substituted.
 */
export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}

/**
 * The office email domain. Must match `app.allowed_email_domain` on the
 * database — the trigger is the real gate, this only decides what the UI says.
 */
export function readAllowedEmailDomain(): string {
  const configured = process.env.ALLOWED_EMAIL_DOMAIN;
  const normalized = configured ? normalizeDomain(configured) : "";
  return normalized.length > 0 ? normalized : DEFAULT_ALLOWED_EMAIL_DOMAIN;
}
