/**
 * The three Data Referensi endpoints (PRD #18):
 * `/api/v1/org-units`, `/api/v1/jabatan`, `/api/v1/lookups`.
 *
 * These are not personal data, so they are not filtered by the key's
 * `allowed_fields` — API-CONTRACT.md says so in as many words for org-units
 * ("tidak dibatasi whitelist — struktur organisasi bukan data pribadi"). An
 * aktif API Key is still required: a Konsumen is authenticated on every
 * endpoint, the whitelist simply has nothing to say about these rows.
 *
 * **Each endpoint returns `{ data }` with no `meta`.** The contract shows no
 * pagination parameters and no `meta` block for any of the three, and a v1
 * response shape is frozen once a Konsumen depends on it — so these return the
 * whole (filtered) list, and the column list of each is exactly the one in
 * API-CONTRACT.md, no more.
 *
 * **A short read is an error, not a shorter answer.** PostgREST applies its own
 * `db-max-rows` ceiling before any `.limit()` and reports the capped response
 * as HTTP 200, so the exact count is the only thing that can tell a small
 * table from a truncated read (`FullRead` in `lib/db/shared.ts`). Since these
 * endpoints cannot page, a truncated read is answered with a logged 500 rather
 * than a silently incomplete organisation chart that a Konsumen would copy
 * into its own database. The structure is a few hundred nodes
 * (ARCHITECTURE.md §7), so in practice this never fires — and if it ever does,
 * v1 needs pagination, which means `/api/v2`.
 */
import { parseLookupTipe, parseOrgUnitTipe, parseStatusFilter, parseUuidParam } from "@/lib/api/query";
import { jsonCollection } from "@/lib/api/response";
import { requireComplete, toFullRead, unwrapRows } from "@/lib/db/shared";

import { withApiContext, type RouteDeps } from "./context";

/**
 * Sanity ceiling asked of PostgREST, matching `MAX_TREE_ROWS` in
 * `lib/db/orgUnits.ts`. It is not a truncation detector — the exact count is.
 */
export const MAX_REFERENCE_ROWS = 5000;

/** Unit Organisasi, optionally narrowed by `tipe` and `parent_id`. */
export async function handleOrgUnits(
  request: Request,
  deps?: RouteDeps,
): Promise<Response> {
  return withApiContext(request, deps, async ({ searchParams, client }) => {
    const status = parseStatusFilter(searchParams, "aktif");
    const tipe = parseOrgUnitTipe(searchParams);
    const parentId = parseUuidParam(searchParams, "parent_id");

    let query = client
      .from("org_units")
      .select("id, kode, nama, tipe, parent_id, status", { count: "exact" })
      // `kode` is UNIQUE and stable, unlike `nama`, which an admin renames.
      .order("kode", { ascending: true })
      .limit(MAX_REFERENCE_ROWS);

    if (status !== "semua") query = query.eq("status", status);
    if (tipe) query = query.eq("tipe", tipe);
    if (parentId) query = query.eq("parent_id", parentId);

    const result = await query;
    const rows = unwrapRows("Gagal memuat Unit Organisasi", result);
    return jsonCollection(
      requireComplete(toFullRead(rows, result.count), "Unit Organisasi"),
    );
  });
}

/** Jabatan — a nama pekerjaan many Karyawan can hold at once (ADR-002). */
export async function handleJabatan(
  request: Request,
  deps?: RouteDeps,
): Promise<Response> {
  return withApiContext(request, deps, async ({ searchParams, client }) => {
    const status = parseStatusFilter(searchParams, "aktif");

    let query = client
      .from("jabatan")
      .select("id, kode, nama, status", { count: "exact" })
      .order("kode", { ascending: true })
      .limit(MAX_REFERENCE_ROWS);

    if (status !== "semua") query = query.eq("status", status);

    const result = await query;
    const rows = unwrapRows("Gagal memuat Jabatan", result);
    return jsonCollection(requireComplete(toFullRead(rows, result.count), "Jabatan"));
  });
}

/** One Lookup list — the options behind one dropdown. `tipe` is mandatory. */
export async function handleLookups(
  request: Request,
  deps?: RouteDeps,
): Promise<Response> {
  return withApiContext(request, deps, async ({ searchParams, client }) => {
    const tipe = parseLookupTipe(searchParams);
    const status = parseStatusFilter(searchParams, "aktif");

    let query = client
      .from("lookups")
      .select("id, tipe, kode, label, urutan, status", { count: "exact" })
      // The curated order Master Data is kept in; `urutan` is nullable, so
      // `label` always follows as a tie-break.
      .order("urutan", { ascending: true, nullsFirst: false })
      .order("label", { ascending: true })
      .limit(MAX_REFERENCE_ROWS);

    query = query.eq("tipe", tipe);
    if (status !== "semua") query = query.eq("status", status);

    const result = await query;
    const rows = unwrapRows("Gagal memuat Lookup", result);
    return jsonCollection(requireComplete(toFullRead(rows, result.count), "Lookup"));
  });
}
