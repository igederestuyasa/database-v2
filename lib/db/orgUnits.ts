/**
 * Read layer for Unit Organisasi (`org_units`).
 *
 * FROZEN CONTRACT (Wave 1) — reads only. Writes live in
 * `lib/actions/orgUnits.ts` (another unit): one statement per Server Action, or
 * `merge_org_unit` when several rows move (ADR-006).
 *
 * The hierarchy is one self-referencing table (ADR-002). Trees, descendant
 * sets and ancestor paths are assembled **in TypeScript** from one flat read:
 * there are a few hundred nodes, the whole tree is meant to be loaded at once
 * (ARCHITECTURE.md §7), and the pure helpers are unit-testable without a
 * database.
 */
import type { OrgUnitType } from "@/lib/validation/orgUnit";
import type { OrgUnit } from "@/lib/types/db";

import {
  containsPattern,
  DbError,
  normalizeSearch,
  requireComplete,
  resolvePage,
  toFullRead,
  toPaged,
  unwrapMaybe,
  unwrapRows,
  type DbClient,
  type FullRead,
  type PageParams,
  type Paged,
  type SortDirection,
  type StatusFilter,
} from "./shared";

export type OrgUnitOrderBy = "nama" | "kode" | "tipe" | "created_at" | "updated_at";

export type OrgUnitListParams = PageParams & {
  /** Default `"aktif"`. Pass `"semua"` to include nonaktif units. */
  status?: StatusFilter;
  /** Restrict to one or more `tipe` values. */
  tipe?: OrgUnitType | readonly OrgUnitType[];
  /**
   * `undefined` — no filter.
   * `null` — only roots (units without an induk; a Temuan on "Perlu Dibereskan").
   * `string` — only direct children of that unit.
   */
  parentId?: string | null;
  /** Partial, case-insensitive match on `nama` or `kode`. */
  search?: string | null;
  /** Default `"nama"`. */
  orderBy?: OrgUnitOrderBy;
  /** Default `"asc"`. */
  direction?: SortDirection;
};

/** One node of the Unit Organisasi tree, with its children attached. */
export type OrgUnitNode = OrgUnit & {
  children: OrgUnitNode[];
  /** 0 for a root of the returned tree. */
  depth: number;
};

const SELECT_ALL =
  "id, kode, nama, tipe, parent_id, status, merged_into_id, created_at, updated_at";

/**
 * Ceiling this module asks PostgREST for on an unpaginated read. The tree is a
 * few hundred nodes (ARCHITECTURE.md §7); blowing past this means something is
 * wrong, and a silently truncated tree draws a wrong hierarchy.
 *
 * It is a sanity ceiling, **not** a truncation detector. PostgREST applies its
 * own `db-max-rows` first and reports the capped response as success, so the
 * number that matters is the exact count — see `FullRead` in `lib/db/shared.ts`.
 */
export const MAX_TREE_ROWS = 5000;

/** One page of Unit Organisasi, for the table on `/struktur`. */
export async function listOrgUnits(
  client: DbClient,
  params?: OrgUnitListParams,
): Promise<Paged<OrgUnit>> {
  const { page, perPage, from, to } = resolvePage(params);

  let query = client
    .from("org_units")
    .select(SELECT_ALL, { count: "exact" })
    .order(params?.orderBy ?? "nama", {
      ascending: (params?.direction ?? "asc") === "asc",
    })
    .range(from, to);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const tipe = params?.tipe
    ? Array.isArray(params.tipe)
      ? params.tipe
      : [params.tipe as OrgUnitType]
    : [];
  if (tipe.length > 0) query = query.in("tipe", tipe);

  if (params?.parentId === null) query = query.is("parent_id", null);
  else if (typeof params?.parentId === "string") {
    query = query.eq("parent_id", params.parentId);
  }

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`nama.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat Unit Organisasi", result);
  return toPaged(rows, result.count, page, perPage);
}

/**
 * Every matching Unit Organisasi, unpaginated — for the tree and pickers.
 *
 * Returns a `FullRead`, because a hierarchy is the worst thing to truncate
 * quietly: a unit whose induk was not read is promoted to a root by
 * `buildOrgUnitTree()`, so the page would draw a structure that does not
 * exist rather than simply a shorter one.
 */
export async function listAllOrgUnits(
  client: DbClient,
  params?: Omit<OrgUnitListParams, "page" | "perPage">,
): Promise<FullRead<OrgUnit>> {
  let query = client
    .from("org_units")
    .select(SELECT_ALL, { count: "exact" })
    .order(params?.orderBy ?? "nama", {
      ascending: (params?.direction ?? "asc") === "asc",
    })
    .limit(MAX_TREE_ROWS);

  const status = params?.status ?? "aktif";
  if (status !== "semua") query = query.eq("status", status);

  const tipe = params?.tipe
    ? Array.isArray(params.tipe)
      ? params.tipe
      : [params.tipe as OrgUnitType]
    : [];
  if (tipe.length > 0) query = query.in("tipe", tipe);

  if (params?.parentId === null) query = query.is("parent_id", null);
  else if (typeof params?.parentId === "string") {
    query = query.eq("parent_id", params.parentId);
  }

  const search = normalizeSearch(params?.search);
  if (search) {
    const pattern = containsPattern(search);
    query = query.or(`nama.ilike.${pattern},kode.ilike.${pattern}`);
  }

  const result = await query;
  const rows = unwrapRows("Gagal memuat Unit Organisasi", result);
  return toFullRead(rows, result.count);
}

export async function getOrgUnitById(
  client: DbClient,
  id: string,
): Promise<OrgUnit | null> {
  return unwrapMaybe(
    "Gagal memuat Unit Organisasi",
    await client.from("org_units").select(SELECT_ALL).eq("id", id).maybeSingle(),
  );
}

export async function getOrgUnitByKode(
  client: DbClient,
  kode: string,
): Promise<OrgUnit | null> {
  return unwrapMaybe(
    "Gagal memuat Unit Organisasi",
    await client.from("org_units").select(SELECT_ALL).eq("kode", kode).maybeSingle(),
  );
}

/**
 * Turn a flat list into a forest.
 *
 * A row whose `parent_id` is not in `rows` (missing induk, or an induk filtered
 * out by `status`) becomes a root — that is exactly the orphan case the
 * "Perlu Dibereskan" page reports, and dropping it would hide data.
 *
 * Pure: no database, no ordering assumptions. Children keep the order of the
 * input, so callers control sorting by sorting `rows`.
 */
export function buildOrgUnitTree(rows: readonly OrgUnit[]): OrgUnitNode[] {
  const nodes = new Map<string, OrgUnitNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, children: [], depth: 0 });
  }

  const roots: OrgUnitNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = row.parent_id ? nodes.get(row.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // Depth is assigned by walking down from the roots, with a visited guard: a
  // cycle is impossible in the database (org_units_no_cycle) but must never be
  // able to hang the UI.
  const seen = new Set<string>();
  const walk = (from: readonly OrgUnitNode[]) => {
    const stack = [...from];
    while (stack.length > 0) {
      const node = stack.pop() as OrgUnitNode;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      for (const child of node.children) {
        child.depth = node.depth + 1;
        stack.push(child);
      }
    }
  };
  walk(roots);

  // Anything still unvisited is part of a cycle: every member is some other
  // member's child, so none of them is a root and none is reachable. Detach the
  // first one found from its parent and promote it, so the units still appear
  // in the tree (as a Temuan to fix) instead of vanishing from /struktur.
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node || seen.has(node.id)) continue;
    const parent = row.parent_id ? nodes.get(row.parent_id) : undefined;
    if (parent) parent.children = parent.children.filter((child) => child !== node);
    node.depth = 0;
    roots.push(node);
    walk([node]);
  }

  return roots;
}

/** Flatten a tree back into display order (pre-order), keeping `depth`. */
export function flattenOrgUnitTree(nodes: readonly OrgUnitNode[]): OrgUnitNode[] {
  const out: OrgUnitNode[] = [];
  const visit = (list: readonly OrgUnitNode[]) => {
    for (const node of list) {
      out.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

/**
 * The whole hierarchy in one read, plus the flat rows it was built from.
 *
 * `rows`/`total`/`truncated` describe the READ — so `rows.length < total` keeps
 * meaning what `FullRead` says it means — and `tree` is the forest assembled
 * from those same rows. Deliberately not `FullRead<OrgUnitNode>`: a forest has
 * as many roots as it has, which is nothing like the row count, and a caller
 * re-deriving truncation from `rows.length < total` would then warn "pohon
 * belum lengkap" on perfectly healthy data. Same shape as `GroupedLookups`.
 */
export type OrgUnitTreeRead = FullRead<OrgUnit> & {
  /** Roots of the forest; every row is reachable from one of them. */
  tree: OrgUnitNode[];
};

export async function getOrgUnitTree(
  client: DbClient,
  params?: Omit<OrgUnitListParams, "page" | "perPage" | "parentId">,
): Promise<OrgUnitTreeRead> {
  const read = await listAllOrgUnits(client, params);
  return { ...read, tree: buildOrgUnitTree(read.rows) };
}

/**
 * `rootId` plus every Unit Organisasi below it.
 *
 * Pure. Cycle-safe. The root is always the first element, even when it has no
 * children, so callers can use the result directly in an `in` filter.
 */
export function collectDescendantIds(
  rows: readonly Pick<OrgUnit, "id" | "parent_id">[],
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const siblings = childrenByParent.get(row.parent_id);
    if (siblings) siblings.push(row.id);
    else childrenByParent.set(row.parent_id, [row.id]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * `rootId` plus every unit below it, read from the database.
 *
 * Deliberately reads every unit regardless of `status`: a nonaktif Unit
 * Organisasi can still have Karyawan pointing at it, and leaving it out would
 * quietly under-count them.
 */
export async function getOrgUnitDescendantIds(
  client: DbClient,
  rootId: string,
): Promise<string[]> {
  // `count: "exact"` is the whole point: without it a response capped by
  // `db-max-rows` is indistinguishable from a complete one, and the subtree
  // would be quietly under-counted. Silently truncating here would under-count
  // the number this feeds ("… Karyawan akan dipindahkan"), which is read right
  // before someone presses Merge — so this one throws rather than reporting a
  // partial answer nobody can see is partial.
  const result = await client
    .from("org_units")
    .select("id, parent_id", { count: "exact" })
    .limit(MAX_TREE_ROWS);

  const rows = unwrapRows("Gagal memuat hierarki Unit Organisasi", result);
  const complete = requireComplete(
    toFullRead(rows, result.count),
    "Unit Organisasi",
  );
  return collectDescendantIds(complete, rootId);
}

/**
 * Path from the topmost ancestor down to `id`, inclusive.
 *
 * Pure. Returns `[]` when `id` is not in `rows`; stops (rather than looping)
 * if the data ever contains a cycle.
 */
export function buildAncestorPath(rows: readonly OrgUnit[], id: string): OrgUnit[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: OrgUnit[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/**
 * Breadcrumb for one unit: "Direktorat X › Divisi Y › Bagian Z".
 *
 * Throws on a truncated read rather than returning a shorter path: a
 * breadcrumb that silently drops the Direktorat it hangs under does not look
 * incomplete, it looks like a different place in the company.
 */
export async function getOrgUnitAncestors(
  client: DbClient,
  id: string,
): Promise<OrgUnit[]> {
  const read = await listAllOrgUnits(client, { status: "semua" });
  return buildAncestorPath(requireComplete(read, "Unit Organisasi"), id);
}

/**
 * How many Karyawan point at this Unit Organisasi.
 *
 * Used by the merge dialogs ("… Karyawan akan dipindahkan") and by
 * deactivation confirmations. Counts the unit itself; pass `includeChildren`
 * to count the whole subtree.
 */
export async function countEmployeesByOrgUnit(
  client: DbClient,
  orgUnitId: string,
  options?: { status?: StatusFilter; includeChildren?: boolean },
): Promise<number> {
  const ids = options?.includeChildren
    ? await getOrgUnitDescendantIds(client, orgUnitId)
    : [orgUnitId];

  let query = client
    .from("employees")
    .select("id", { count: "exact", head: true })
    .in("org_unit_id", ids);

  const status = options?.status ?? "semua";
  if (status !== "semua") query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw new DbError("Gagal menghitung Karyawan", error);
  return count ?? 0;
}
