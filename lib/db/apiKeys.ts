/**
 * Read layer for API Key (`api_keys`) — one credential per Konsumen.
 *
 * FROZEN CONTRACT (Wave 1) — reads only. Creating, rotating and deactivating
 * keys lives in `lib/actions/apiKeys.ts` (another unit).
 *
 * **`key_hash` never leaves this module.** Every select here names its columns
 * and leaves `key_hash` out, so a page, a log or a debug dump cannot spill it.
 * The one place that needs the hash is API-key authentication, which looks a
 * key *up* by its hash (`findActiveApiKeyByHash`) instead of reading it back.
 * `api_keys` is admin-only under RLS, and its Revisi are admin-only too.
 */
import type { ApiKey } from "@/lib/types/db";

import {
  containsPattern,
  normalizeSearch,
  resolvePage,
  toPaged,
  unwrapMaybe,
  unwrapRows,
  type DbClient,
  type PageParams,
  type Paged,
  type StatusFilter,
} from "./shared";

/** An API Key as the UI may see it: everything except the secret hash. */
export type ApiKeySummary = Omit<ApiKey, "key_hash">;

const SELECT_PUBLIC =
  "id, nama_konsumen, key_prefix, allowed_fields, status, last_used_at, created_at, updated_at";

export type ApiKeyListParams = PageParams & {
  /** Default `"semua"` — the admin page lists aktif and nonaktif together. */
  status?: StatusFilter;
  /** Partial, case-insensitive match on `nama_konsumen` or `key_prefix`. */
  search?: string | null;
};

/** The table on `/api-keys` (PRD #19). Admin only, enforced by RLS. */
export async function listApiKeys(
  client: DbClient,
  params?: ApiKeyListParams,
): Promise<Paged<ApiKeySummary>> {
  const { page, perPage, from, to } = resolvePage(params);

  let query = client
    .from("api_keys")
    .select(SELECT_PUBLIC, { count: "exact" })
    .order("nama_konsumen", { ascending: true })
    .range(from, to);

  const status = params?.status ?? "semua";
  if (status !== "semua") query = query.eq("status", status);

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`nama_konsumen.ilike.${pattern},key_prefix.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat API Key", result);
  return toPaged(rows, result.count, page, perPage);
}

export async function getApiKeyById(
  client: DbClient,
  id: string,
): Promise<ApiKeySummary | null> {
  return unwrapMaybe(
    "Gagal memuat API Key",
    await client.from("api_keys").select(SELECT_PUBLIC).eq("id", id).maybeSingle(),
  );
}

/**
 * Look one aktif key up by the SHA-256 of the key the Konsumen sent.
 *
 * Called from `app/api/v1/**` with the service-role client, because those
 * routes have no user session (ADR-004). The hash is an input, never an
 * output: the returned row still omits `key_hash`.
 *
 * A `null` result means "no aktif key with that hash" — the route answers 401
 * without saying whether the key is unknown or merely nonaktif.
 */
export async function findActiveApiKeyByHash(
  client: DbClient,
  keyHash: string,
): Promise<ApiKeySummary | null> {
  return unwrapMaybe(
    "Gagal memeriksa API Key",
    await client
      .from("api_keys")
      .select(SELECT_PUBLIC)
      .eq("key_hash", keyHash)
      .eq("status", "aktif")
      .maybeSingle(),
  );
}
