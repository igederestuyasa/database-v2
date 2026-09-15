/**
 * Server-side read for `/struktur`.
 *
 * Two queries, no matter how deep the hierarchy is: one flat read of
 * `org_units` (the tree, the descendant sets and the ancestor paths are all
 * assembled in TypeScript by `lib/db/orgUnits.ts`), and one flat read of the
 * Karyawan placements (`countEmployeesPerOrgUnit` in `lib/db/employees.ts`)
 * so the tree can say how many people sit in each unit.
 *
 * Two different truncation checks meet on this page and they are NOT the same
 * check, so both stay:
 *
 *   * `terpotong` — the `org_units` read, reported by `listAllOrgUnits()` from
 *     the exact count of that same query. A unit whose induk was cut from the
 *     read is promoted to a root by `buildOrgUnitTree()`, so a capped response
 *     does not draw a smaller company — it draws a different one. Hence it is
 *     passed up for the page to say, not shrugged off.
 *   * the placement read, which throws `IncompleteReadError` when it falls
 *     short; `bacaAman()` turns that (and any other failure) into `null`
 *     counts, and the tree shows "—" rather than a number it cannot back up.
 */
import type { StrukturNode } from "@/components/struktur/strukturNodes";
import { countEmployeesPerOrgUnit } from "@/lib/db/employees";
import {
  buildOrgUnitTree,
  flattenOrgUnitTree,
  listAllOrgUnits,
} from "@/lib/db/orgUnits";
import { terpotongDari, type DaftarTerpotong, type DbClient } from "@/lib/db/shared";
import { TERMS } from "@/lib/i18n/terms";

import { bacaAman } from "../../_lib/bacaAman";

export type StrukturData = {
  nodes: StrukturNode[];
  /** Non-empty when the hierarchy below is missing rows — draw a warning. */
  terpotong: DaftarTerpotong[];
};

/** The whole hierarchy, pre-order, every status, ready for `StrukturClient`. */
export async function loadStrukturNodes(client: DbClient): Promise<StrukturData> {
  // `status: "semua"` on purpose: a nonaktif unit is still a real parent, and
  // leaving it out would promote its children to roots and draw a hierarchy
  // that does not exist.
  const [unitRead, counts] = await Promise.all([
    listAllOrgUnits(client, { status: "semua", orderBy: "nama" }),
    bacaAman("struktur", "menghitung Karyawan per unit", () =>
      countEmployeesPerOrgUnit(client),
    ),
  ]);
  const rows = unitRead.rows;
  const flat = flattenOrgUnitTree(buildOrgUnitTree(rows));
  const namaById = new Map(rows.map((row) => [row.id, row.nama]));

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

  const nodes = flat.map((node) => ({
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

  return { nodes, terpotong: terpotongDari(TERMS.unitOrganisasi, unitRead) };
}
