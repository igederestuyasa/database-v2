/**
 * API Key authentication for `/api/v1` — the only gate on these routes.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * `middleware.ts` excludes `/api/v1/**` from its matcher on purpose: a
 * Konsumen is a server-to-server caller and must never be redirected to an
 * HTML login page (ADR-004). So there is no session, no cookie and no
 * `auth.uid()` on these requests. The routes then query with the service-role
 * client, which bypasses RLS. Between those two facts, this module and
 * `fields.ts` are the *entire* access control of the public API. If
 * `authenticateApiKey()` is wrong, the endpoint is simply open.
 *
 * The scheme (API-CONTRACT.md §Auth):
 *
 *   * `Authorization: Bearer hck_<40 random characters>`;
 *   * the database stores only the **SHA-256** of the full key
 *     (`api_keys.key_hash`), lowercase hex, and the key itself is shown once
 *     at creation and never again;
 *   * a missing, malformed, unknown or nonaktif key all answer the same
 *     `401 UNAUTHORIZED`. The wording never distinguishes them: telling a
 *     caller that their key is real but switched off is more than they need to
 *     know, and it turns the endpoint into an oracle for guessing keys.
 *
 * **Hashing is a shared contract with the API Keys page** (PRD #19), which
 * creates keys and stores their hash. Both sides must produce the same string
 * for the same key: `sha256(utf8(token))` rendered as **lowercase hex**, no
 * salt, no pepper, no encoding of any other kind. A key is 40 characters of
 * cryptographic randomness, so it needs no work factor; a slow KDF here would
 * only tax every Konsumen request.
 *
 * ┌─ FOLLOW-UP, one line ─────────────────────────────────────────────────────┐
 * │ The canonical implementation is `hashApiKey()` in `lib/apiKeys/keygen.ts`,│
 * │ which the API Keys unit ships in PR #13. That module is not on `main` yet,│
 * │ so this file cannot import it without failing to build. `hashApiKey()`    │
 * │ below is deliberately byte-identical to it — same algorithm, same         │
 * │ encoding, same empty-key guard, same "no normalisation" rule — and        │
 * │ `auth.test.ts` pins the digest of a fixed key so the two cannot drift     │
 * │ unnoticed. Once PR #13 has landed, delete the body here and re-export:    │
 * │                                                                           │
 * │     export { hashApiKey } from "@/lib/apiKeys/keygen";                    │
 * │                                                                           │
 * │ A mismatch would not look like a bug: every freshly issued key would be   │
 * │ rejected as "wrong key", the Konsumen would re-copy it, the admin would   │
 * │ reissue it, and nobody would suspect two different digests.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { createHash } from "node:crypto";

import { findActiveApiKeyByHash, type ApiKeySummary } from "@/lib/db/apiKeys";
import type { DbClient } from "@/lib/db/shared";
import { API_KEY_PATTERN } from "@/lib/validation/apiKey";

import { apiError } from "./errors";

/** The authenticated Konsumen. Never carries `key_hash` — see `lib/db/apiKeys.ts`. */
export type AuthenticatedKey = ApiKeySummary;

/** Spelled once so the two sides of the contract cannot differ by a typo. */
export const API_KEY_HASH_ALGORITHM = "sha256";

/** 32 bytes of SHA-256 rendered as hex. */
export const API_KEY_HASH_LENGTH = 64;

/**
 * `sha256(token)` as lowercase hex — the value stored in `api_keys.key_hash`.
 *
 * Computed over the key **exactly as issued**, `hck_` prefix included: no
 * trim, no lowercasing, no normalisation of any kind. Whitespace around the
 * header value is stripped by `extractBearerToken()` and the format is checked
 * by `requireBearerToken()` *before* this is called, so `"hck_… "` with a
 * trailing space cannot quietly become a different digest.
 *
 * An empty key is refused rather than hashed: `sha256("")` is a perfectly good
 * digest, and a row whose `key_hash` failed to save would match it.
 */
export function hashApiKey(token: string): string {
  if (token.length === 0) {
    throw new Error("API Key kosong tidak bisa di-hash.");
  }
  return createHash(API_KEY_HASH_ALGORITHM).update(token, "utf8").digest("hex");
}

/**
 * The bearer token from an `Authorization` header, or `null`.
 *
 * Accepts the scheme case-insensitively (`Bearer`, `bearer`, `BEARER`) because
 * RFC 7235 says it is case-insensitive and a Konsumen's HTTP client may
 * normalise it. Everything after the scheme is trimmed; an empty remainder is
 * `null`, not `""`.
 */
export function extractBearerToken(source: Request | Headers): string | null {
  const headers = source instanceof Headers ? source : source.headers;
  const raw = headers.get("authorization");
  if (!raw) return null;

  const match = /^bearer[ \t]+(.+)$/i.exec(raw.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * The bearer token, or `401`.
 *
 * Shape is checked here, before anything touches the database or even builds a
 * Supabase client: a request with no key at all must answer 401 even on a
 * deployment whose Supabase environment variables are missing. That is also
 * what makes `curl` against a freshly started server a meaningful test.
 */
export function requireBearerToken(request: Request): string {
  const token = extractBearerToken(request);
  if (!token) throw apiError.unauthorized();
  if (!API_KEY_PATTERN.test(token)) throw apiError.unauthorized();
  return token;
}

/**
 * Look the key up and hand back the Konsumen it belongs to, or throw `401`.
 *
 * `findActiveApiKeyByHash()` filters on `status = 'aktif'`, so a nonaktif key
 * is indistinguishable from an unknown one here — which is exactly the Fase 4
 * exit criterion ("key dinonaktifkan → 401").
 */
export async function authenticateApiKey(
  client: DbClient,
  token: string,
): Promise<AuthenticatedKey> {
  const key = await findActiveApiKeyByHash(client, hashApiKey(token));
  if (!key) throw apiError.unauthorized();
  return key;
}

/**
 * How stale `last_used_at` may get before it is rewritten.
 *
 * `last_used_at` answers "is this Konsumen still alive?" (ADR-004), which is a
 * question about days, not milliseconds — so it is written at most once every
 * few minutes per key. Without this, a Konsumen paging through ~1.475 Karyawan
 * makes every one of its requests UPDATE the same single `api_keys` row: they
 * queue on one row lock, each pays an extra round trip, and each also bumps
 * `api_keys.updated_at` through the `set_updated_at` trigger until that column
 * can no longer tell "an admin edited this key" from "a Konsumen called the
 * API".
 */
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** Is `last_used_at` stale enough to be worth rewriting? */
export function shouldTouchLastUsed(
  lastUsedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!lastUsedAt) return true;
  const previous = new Date(lastUsedAt).getTime();
  if (Number.isNaN(previous)) return true;
  // A timestamp in the future (clock skew between app and database) is left
  // alone: rewriting it would not make it truer.
  return now.getTime() - previous >= LAST_USED_THROTTLE_MS;
}

/**
 * Record that this key was used, so the API Keys page can show which Konsumen
 * is still alive (ADR-004).
 *
 * Two deliberate decisions:
 *
 *   * **It never fails the request.** A Konsumen's data pull must not 500
 *     because a housekeeping write did not land. Errors are logged and
 *     swallowed.
 *   * **It does not pollute the Revisi log.** The `log_revision` trigger skips
 *     an update that touches only `updated_at` / `api_keys.last_used_at`
 *     (`supabase/migrations/0001_init.sql`, proved by
 *     `scripts/verify-schema.sql` §11), so ordinary Konsumen traffic cannot
 *     bury the Log Perubahan. Do not widen this update to any other column.
 *
 * Awaited rather than fired and forgotten: on a serverless runtime a dangling
 * promise is cancelled when the response is returned, and a `last_used_at`
 * that is only sometimes written is worse than useless. Thanks to the throttle
 * above, awaiting it costs a round trip only a few times an hour per key.
 */
export async function touchApiKeyUsage(
  client: DbClient,
  key: Pick<AuthenticatedKey, "id" | "last_used_at">,
  now: Date = new Date(),
): Promise<void> {
  if (!shouldTouchLastUsed(key.last_used_at, now)) return;
  try {
    const { error } = await client
      .from("api_keys")
      .update({ last_used_at: now.toISOString() })
      .eq("id", key.id);
    if (error) {
      console.error("[api/v1] gagal memperbarui last_used_at", error.message);
    }
  } catch (cause) {
    console.error("[api/v1] gagal memperbarui last_used_at", cause);
  }
}
