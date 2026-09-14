/**
 * Server-side read for `/struktur`.
 *
 * Two queries, no matter how deep the hierarchy is: one flat read of
 * `org_units` (the tree, the descendant sets and the ancestor paths are all
 * assembled in TypeScript by `lib/db/orgUnits.ts`), and one flat read of the
 * Karyawan placements so the tree can say how many people sit in each unit.
 *
 * Counting per unit the obvious way — `countEmployeesByOrgUnit()` per node —
 * would be one round trip per Unit Organisasi, i.e. a few hundred, to render
 * one page. One read of two columns and a pass in memory is the same answer
 * for the price of one request.
 */
import type { StrukturNode } from "@/components/struktur/strukturNodes";
import {
  buildOrgUnitTree,
  flattenOrgUnitTree,
  listAllOrgUnits,
} from "@/lib/db/orgUnits";
import type { DbClient } from "@/lib/db/shared";

/**
 * Ceiling on the placement read. HK has ~1.500 Karyawan; past this the counts
 * would be quietly wrong, so they are dropped entirely instead — the tree then
 * shows "—" and says nothing it cannot back up.
 */
const MAX_EMPLOYEE_ROWS = 20000;

/**
 * Rows per request. PostgREST enforces its own `db-max-rows` ceiling — 1000 on
 * a stock Supabase project — *before* any `.range()` we ask for, so a single
 * request for 1.500 Karyawan comes back with 1000 rows and no complaint. Hence
 * paging, and hence comparing the total read against the exact `count` at the
 * end: a short read must never pass for a short table.
 */
const PAGE_SIZE = 1000;

type PlacementCounts = {
  /** Karyawan aktif per unit — what the tree shows. */
  aktif: Map<string, number>;
  /** Karyawan of any status per unit — what a Merge would move. */
  semua: Map<string, number>;
};

/** Karyawan per Unit Organisasi, or `null` when the numbers cannot be trusted. */
async function countKaryawanPerUnit(
  client: DbClient,
): Promise<PlacementCounts | null> {
  const aktif = new Map<string, number>();
  const semua = new Map<string, number>();

  let dibaca = 0;
  let seharusnya: number | null = null;

  for (let offset = 0; offset <= MAX_EMPLOYEE_ROWS; offset += PAGE_SIZE) {
    // `.order("id")` matters: without a stable sort, paging over PostgREST can
    // repeat or skip rows between requests, and every count would be off.
    const query = client
      .from("employees")
      .select(
        "org_unit_id, status",
        offset === 0 ? { count: "exact" } : undefined,
      )
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error || !data) {
      if (error) console.error("[struktur] gagal menghitung Karyawan per unit", error);
      return null;
    }
    if (offset === 0) seharusnya = count;

    for (const row of data) {
      const unitId = row.org_unit_id;
      if (!unitId) continue;
      semua.set(unitId, (semua.get(unitId) ?? 0) + 1);
      if (row.status === "aktif") aktif.set(unitId, (aktif.get(unitId) ?? 0) + 1);
    }

    dibaca += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  if (seharusnya !== null && dibaca < seharusnya) {
    console.warn(
      `[struktur] baru ${dibaca} dari ${seharusnya} Karyawan yang terbaca; jumlah per unit tidak ditampilkan.`,
    );
    return null;
  }

  return { aktif, semua };
}

/** The whole hierarchy, pre-order, every status, ready for `StrukturClient`. */
export async function loadStrukturNodes(client: DbClient): Promise<StrukturNode[]> {
  // `status: "semua"` on purpose: a nonaktif unit is still a real parent, and
  // leaving it out would promote its children to roots and draw a hierarchy
  // that does not exist.
  const rows = await listAllOrgUnits(client, { status: "semua", orderBy: "nama" });
  const flat = flattenOrgUnitTree(buildOrgUnitTree(rows));

  const namaById = new Map(rows.map((row) => [row.id, row.nama]));
  const counts = await countKaryawanPerUnit(client);

  // Subtree totals in one reverse pass: a parent always precedes its children
  // in pre-order, so walking backwards means every child has already folded
  // its own subtree in by the time its parent is reached.
  const total = new Map<string, number>();
  if (counts) {
    for (const node of flat) total.set(node.id, counts.aktif.get(node.id) ?? 0);
    for (let i = flat.length - 1; i >= 0; i -= 1) {
      const node = flat[i];
      const parentId = node.parent_id;
      if (!parentId || !total.has(parentId)) continue;
      total.set(parentId, (total.get(parentId) ?? 0) + (total.get(node.id) ?? 0));
    }
  }

  return flat.map((node) => ({
    id: node.id,
    kode: node.kode,
    tipe: node.tipe,
    nama: node.nama,
    parentId: node.parent_id,
    status: node.status,
    mergedIntoId: node.merged_into_id,
    mergedIntoNama: node.merged_into_id
      ? (namaById.get(node.merged_into_id) ?? null)
      : null,
    depth: node.depth,
    karyawanAktifLangsung: counts ? (counts.aktif.get(node.id) ?? 0) : null,
    karyawanAktifTotal: counts ? (total.get(node.id) ?? 0) : null,
    karyawanPindahSaatMerge: counts ? (counts.semua.get(node.id) ?? 0) : null,
  }));
}
