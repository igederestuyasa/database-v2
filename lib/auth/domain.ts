/**
 * The office-email rule, in one place.
 *
 * PRD #21: "User login dengan email kantor". The database enforces it for real
 * — `handle_new_user()` in `supabase/migrations/0001_init.sql` raises `42501`
 * when the address is not `@<app.allowed_email_domain>` — but a Postgres
 * exception surfaced through Supabase Auth reaches the browser as
 * "Database error saving new user", which tells staf HC nothing. So the same
 * rule is checked here first, in Indonesian, before the request ever leaves.
 *
 * This module is PURE: no `process.env`, no `next/headers`. The Client
 * Component form imports it too, so the domain always arrives as an argument
 * (`lib/auth/env.ts` is what reads `ALLOWED_EMAIL_DOMAIN`, server-side only).
 */

/** Fallback used by `handle_new_user()` when `app.allowed_email_domain` is unset. */
export const DEFAULT_ALLOWED_EMAIL_DOMAIN = "hutamakarya.com";

/**
 * Deliberately loose: one `@`, something either side, a dot in the domain, no
 * whitespace. Supabase Auth and Postgres both check the address for real; this
 * only exists so an obvious typo is caught before a round trip.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cased and trimmed — the form `handle_new_user()` stores. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailShape(email: string): boolean {
  return EMAIL_SHAPE.test(normalizeEmail(email));
}

/** Trim an `ALLOWED_EMAIL_DOMAIN` value: `"@HutamaKarya.com "` → `"hutamakarya.com"`. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

/**
 * The domain part, exactly as `split_part(email, '@', 2)` computes it in
 * `handle_new_user()` — the SECOND field, so `a@b@c.com` yields `b` and is
 * rejected by the app and by the database alike.
 */
export function emailDomain(email: string): string | null {
  const parts = normalizeEmail(email).split("@");
  const domain = parts[1];
  return domain && domain.length > 0 ? domain : null;
}

export function isOfficeEmail(email: string, allowedDomain: string): boolean {
  return emailDomain(email) === normalizeDomain(allowedDomain);
}

/** The one sentence shown whenever a non-office address is used. */
export function officeEmailMessage(allowedDomain: string): string {
  return `Hanya email kantor (@${normalizeDomain(allowedDomain)}) yang bisa masuk ke HC Core.`;
}

/** `nama@hutamakarya.com` — the input placeholder. */
export function officeEmailPlaceholder(allowedDomain: string): string {
  return `nama@${normalizeDomain(allowedDomain)}`;
}
