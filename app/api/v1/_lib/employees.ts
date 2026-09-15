/**
 * `GET /api/v1/employees` and `GET /api/v1/employees/{personnel_number}`
 * (PRD #17, #20).
 *
 * Both read **`v_employees_api` and nothing else**. That view is the subset of
 * `v_employees` that may leave the building: it contains no column that comes
 * from `employee_private`, and `v_employees_private` is deliberately not
 * granted to `service_role`, so a query naming it here would fail with
 * "permission denied" rather than quietly ship a date of birth to a Konsumen
 * (ADR-004, PRD #22, `supabase/migrations/0001_init.sql` §grants).
 *
 * Which columns come back is decided entirely by `lib/api/fields.ts`, because
 * the service-role client bypasses RLS and there is no second gate.
 *
 * **`allowed_fields` limits what is returned, not what can be filtered on.**
 * API-CONTRACT.md defines `search` as a partial match on `full_name`, `nip`
 * and `personnel_number` and puts no whitelist condition on it, nor on
 * `org_unit_id`, `jabatan_id` or `updated_since` — so a key whitelisted for
 * `divisi_nama` alone can still search by name, and `meta.total` tells it
 * whether the name matched anything. That is a deliberate consequence of the
 * contract, not an oversight: every aktif key can already read every ROW (the
 * whitelist is column selection, and the rows themselves are the same for all
 * Konsumen), and the data that actually must never leave — Data Pribadi
 * Sensitif — is absent from `v_employees_api` entirely. Narrowing `search` to
 * the whitelist would change documented v1 behaviour, which means `/api/v2`.
 */
import type { PostgrestResponse, PostgrestSingleResponse } from "@supabase/supabase-js";

import { apiError } from "@/lib/api/errors";
import {
  buildSelect,
  projectRow,
  projectRows,
  resolveEmployeeFields,
} from "@/lib/api/fields";
import {
  parseBooleanParam,
  parsePagination,
  parseSearchParam,
  parseStatusFilter,
  parseTimestampParam,
  parseUuidParam,
  readSingleParam,
} from "@/lib/api/query";
import { buildMeta, jsonItem, jsonList } from "@/lib/api/response";
import { getOrgUnitDescendantIds } from "@/lib/db/orgUnits";
import { containsPattern, unwrapMaybe, unwrapRows } from "@/lib/db/shared";

import { withApiContext, type RouteDeps } from "./context";

/** One page of Karyawan. `fields` is mandatory here (API-CONTRACT.md). */
export async function handleEmployeesList(
  request: Request,
  deps?: RouteDeps,
): Promise<Response> {
  return withApiContext(request, deps, async ({ searchParams, client, key }) => {
    const fields = resolveEmployeeFields({
      // `readSingleParam`, not `searchParams.get`: a `fields` sent twice is a
      // 400, never "the first one wins", which would be a partial row.
      requested: readSingleParam(searchParams, "fields"),
      allowed: key.allowed_fields,
      required: true,
    });
    const { page, perPage, from, to } = parsePagination(searchParams);

    let query = client
      .from("v_employees_api")
      .select(buildSelect(fields), { count: "exact" })
      // `personnel_number` is the business key and is UNIQUE, so this is a
      // total order: without it Postgres may hand back the same Karyawan on
      // two pages of one sync and none on a third.
      .order("personnel_number", { ascending: true })
      .range(from, to);

    const status = parseStatusFilter(searchParams, "aktif");
    if (status !== "semua") query = query.eq("status", status);

    const orgUnitId = parseUuidParam(searchParams, "org_unit_id");
    // Parsed even without `org_unit_id`, so a misspelt value is still a 400
    // rather than a parameter nobody reads: `include_children=yes` silently
    // meaning "no" is exactly what `lib/api/query.ts` refuses to do.
    const includeChildren = parseBooleanParam(searchParams, "include_children", true);
    if (orgUnitId) {
      if (includeChildren) {
        // A Divisi filter has to include its Bagian, Sub Bagian and Proyek:
        // Karyawan point at the LOWEST unit, never at the Divisi itself
        // (CONTEXT.md). `getOrgUnitDescendantIds` throws rather than return a
        // short subtree, so a truncated read can never silently under-report.
        query = query.in("org_unit_id", await getOrgUnitDescendantIds(client, orgUnitId));
      } else {
        query = query.eq("org_unit_id", orgUnitId);
      }
    }

    const jabatanId = parseUuidParam(searchParams, "jabatan_id");
    if (jabatanId) query = query.eq("jabatan_id", jabatanId);

    const updatedSince = parseTimestampParam(searchParams, "updated_since");
    if (updatedSince) query = query.gte("updated_at", updatedSince);

    const search = parseSearchParam(searchParams);
    if (search) {
      // `containsPattern` escapes the LIKE wildcards and quotes the value for
      // a PostgREST `or(...)` filter; a raw `%` or `,` from a Konsumen would
      // otherwise change the shape of the query.
      const pattern = containsPattern(search);
      query = query.or(
        `full_name.ilike.${pattern},nip.ilike.${pattern},personnel_number.ilike.${pattern}`,
      );
    }

    // The select list is built at runtime, so the generated row type degrades
    // to the parser's fallback; every name in it was proved to be a column of
    // `v_employees_api` by `resolveEmployeeFields()`.
    const result = (await query) as unknown as PostgrestResponse<
      Record<string, unknown>
    >;
    const rows = unwrapRows("Gagal memuat Karyawan", result);

    return jsonList(
      projectRows(rows, fields),
      buildMeta({ page, perPage, total: result.count ?? rows.length }),
    );
  });
}

/**
 * One Karyawan by Personnel Number — the business key Konsumen hold
 * (CONTEXT.md; `nip` is a different, second code).
 *
 * No `status` filter: a nonaktif Karyawan is still returned, with
 * `status: "nonaktif"` when the key may read that column. Nothing is ever
 * deleted, and a Konsumen that holds an id needs to be able to learn that the
 * person has left rather than watch the row vanish.
 */
export async function handleEmployeeDetail(
  request: Request,
  personnelNumber: string,
  deps?: RouteDeps,
): Promise<Response> {
  return withApiContext(request, deps, async ({ searchParams, client, key }) => {
    // Omitted `fields` means "every column this key is allowed".
    const fields = resolveEmployeeFields({
      requested: readSingleParam(searchParams, "fields"),
      allowed: key.allowed_fields,
      required: false,
    });

    const identifier = personnelNumber.trim();
    if (identifier.length === 0) {
      throw apiError.notFound("Karyawan tidak ditemukan.", {
        personnel_number: personnelNumber,
      });
    }

    const result = (await client
      .from("v_employees_api")
      .select(buildSelect(fields))
      .eq("personnel_number", identifier)
      .maybeSingle()) as unknown as PostgrestSingleResponse<Record<
      string,
      unknown
    > | null>;

    const row = unwrapMaybe("Gagal memuat Karyawan", result);
    if (!row) {
      throw apiError.notFound("Karyawan tidak ditemukan.", {
        personnel_number: identifier,
      });
    }

    return jsonItem(projectRow(row, fields));
  });
}
