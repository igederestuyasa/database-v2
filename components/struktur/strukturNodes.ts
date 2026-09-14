/**
 * The view model `/struktur` renders, and the pure helpers that shape it.
 *
 * Kept away from both the page and the components so the two sides agree on
 * one shape, and so the filtering and collapsing rules can be read without
 * wading through JSX. Everything here is pure and cycle-safe — the hierarchy
 * comes out of `lib/db/orgUnits.ts`, which is careful about cycles for exactly
 * the reason this file has to be too: seed data arrives dirty.
 */

/** One Unit Organisasi as the tree draws it. Pre-order, `depth` from the root. */
export type StrukturNode = {
  id: string;
  kode: string;
  /** Kept as `string`, not `OrgUnitType`: seed data may carry anything. */
  tipe: string;
  nama: string;
  parentId: string | null;
  status: string;
  /** Set when the unit was merged away; it stays, nonaktif, pointing here. */
  mergedIntoId: string | null;
  /** Nama of `mergedIntoId`, resolved on the server so the row can say it. */
  mergedIntoNama: string | null;
  /** 0 for a root of the whole forest. */
  depth: number;
  /** Karyawan aktif pointing straight at this unit. `null` = not counted. */
  karyawanAktifLangsung: number | null;
  /** Karyawan aktif in this unit and everything below it. `null` = not counted. */
  karyawanAktifTotal: number | null;
  /**
   * Karyawan of ANY status pointing straight at this unit — the number a Merge
   * actually moves, since `merge_org_unit` re-points
   * `employees where org_unit_id = source` regardless of status and only
   * *re-parents* the units below. `null` = not counted.
   */
  karyawanPindahSaatMerge: number | null;
};

/** What the toolbar on `/struktur` narrows the tree by. */
export type StrukturFilter = {
  /** Free text, matched against nama and kode. */
  query: string;
  /** Show units whose `status` is `nonaktif` (they are never deleted). */
  tampilkanNonaktif: boolean;
};

/**
 * A unit is `yatim` when it has no induk but is not a Direktorat.
 *
 * `parent_id` is deliberately not constrained in the database so dirty seed
 * data can land; "Perlu Dibereskan" reports this as a Temuan
 * (ARCHITECTURE.md §3). The tree only flags it.
 */
export function isYatim(node: StrukturNode): boolean {
  return node.parentId === null && node.tipe !== "direktorat";
}

function matches(node: StrukturNode, filter: StrukturFilter): boolean {
  if (!filter.tampilkanNonaktif && node.status !== "aktif") return false;

  const query = filter.query.trim().toLowerCase();
  if (query.length === 0) return true;
  return (
    node.nama.toLowerCase().includes(query) || node.kode.toLowerCase().includes(query)
  );
}

/**
 * Narrow the tree, keeping every ancestor of a match.
 *
 * Dropping the ancestors would leave the survivors hanging at whatever `depth`
 * they had, drawing a hierarchy that does not exist. So a unit survives if it
 * matches, or if anything below it does — which also means a nonaktif Divisi
 * stays visible as long as one of its aktif Bagian is, instead of quietly
 * taking the subtree with it.
 *
 * `depth` is never rewritten, so indentation keeps meaning the same thing.
 */
export function filterStrukturNodes(
  nodes: readonly StrukturNode[],
  filter: StrukturFilter,
): StrukturNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const keep = new Set<string>();

  for (const node of nodes) {
    if (!matches(node, filter)) continue;
    // Walk up to the root. The `keep.has` guard both saves the repeated work
    // and stops dead if the data ever contains a cycle.
    let current: StrukturNode | undefined = node;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return nodes.filter((node) => keep.has(node.id));
}

/**
 * Drop everything sitting under a collapsed unit.
 *
 * Works straight off the pre-order list: the descendants of a node are exactly
 * the rows that follow it until `depth` comes back down to its own.
 */
export function collapseStrukturNodes(
  nodes: readonly StrukturNode[],
  collapsed: ReadonlySet<string>,
): StrukturNode[] {
  const rows: StrukturNode[] = [];
  let hiddenBelowDepth: number | null = null;

  for (const node of nodes) {
    if (hiddenBelowDepth !== null && node.depth > hiddenBelowDepth) continue;
    hiddenBelowDepth = null;
    rows.push(node);
    if (collapsed.has(node.id)) hiddenBelowDepth = node.depth;
  }

  return rows;
}

/** Ids of every unit below `rootId`, plus `rootId` itself. Cycle-safe. */
export function subtreeIds(
  nodes: readonly StrukturNode[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenOf.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else childrenOf.set(node.parentId, [node.id]);
  }

  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}
