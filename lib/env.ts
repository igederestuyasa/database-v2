/**
 * Environment variables, read in ONE place.
 *
 * Four of them (CLAUDE.md): `NEXT_PUBLIC_SUPABASE_URL`,
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only),
 * `ALLOWED_EMAIL_DOMAIN`. They used to be read in six files, each with its
 * own "belum diisi" check; a missing one now has one shape of failure.
 *
 * Two rules that shape this file:
 *
 *   * **`NEXT_PUBLIC_*` is read by literal property name**, never through
 *     `process.env[name]`. Next inlines a public variable into the browser
 *     bundle only when it sees the literal — a computed key is `undefined` on
 *     the client. There is no browser Supabase client any more, but
 *     `middleware.ts` (Edge) reads these too, and the rule costs nothing.
 *   * **The `read*` functions never throw.** `middleware.ts` and the login page
 *     run on a deployment whose `.env.local` may be missing, and a throw there
 *     turns "belum dikonfigurasi" into a 500 on every URL. They return `null`
 *     and the caller renders a readable Indonesian notice. The `require*`
 *     functions are for code that cannot proceed without the value — a
 *     Supabase client — and they throw the sentence `.env.example` explains.
 *
 * No zod here on purpose: `middleware.ts` imports this and runs on the Edge
 * runtime, and four variables do not need a schema library in that bundle.
 */
import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  normalizeDomain,
} from "@/lib/auth/domain";

export type PublicEnv = {
  /** `NEXT_PUBLIC_SUPABASE_URL` — the PostgREST URL, `https://….supabase.co`. */
  url: string;
  /** `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe in the browser; RLS still applies. */
  anonKey: string;
};

const PUBLIC_MISSING =
  "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi. Lihat .env.example.";

const SERVICE_ROLE_MISSING =
  "SUPABASE_SERVICE_ROLE_KEY belum diisi (server only). Lihat .env.example.";

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** The two public Supabase variables, or `null` when either is missing or malformed. */
export function readPublicEnv(): PublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!isHttpUrl(url)) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readPublicEnv() !== null;
}

/** The two public variables, or a thrown sentence naming them. */
export function requirePublicEnv(): PublicEnv {
  const env = readPublicEnv();
  if (!env) throw new Error(PUBLIC_MISSING);
  return env;
}

/**
 * The service-role key. Server only, bypasses RLS: the only callers are
 * `lib/supabase/admin.ts` (for `app/api/v1/**`) and scripts.
 */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error(SERVICE_ROLE_MISSING);
  return key;
}

/**
 * The office email domain. Must match `app.allowed_email_domain` on the
 * database — the `handle_new_user()` trigger is the real gate, this only
 * decides what the UI says (PRD #21). Never `NEXT_PUBLIC_`: the login page
 * reads it here and passes it to the form as a prop.
 */
export function readAllowedEmailDomain(): string {
  const configured = process.env.ALLOWED_EMAIL_DOMAIN;
  const normalized = configured ? normalizeDomain(configured) : "";
  return normalized.length > 0 ? normalized : DEFAULT_ALLOWED_EMAIL_DOMAIN;
}
