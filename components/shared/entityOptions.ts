/**
 * Row → `EntityOption` mappers, and the option shape itself.
 *
 * WHY THIS IS A SEPARATE FILE FROM `EntityPicker.tsx`.
 *
 * These functions are pure, and they were written to be called from a Server
 * Component before handing rows to the picker — their old home said so in a
 * comment. But their old home is `EntityPicker.tsx`, which starts with
 * `"use client"`, and that directive applies to the **module**, not to the
 * component: every export of a client module that a server module imports
 * becomes a client *reference*, a stub the server may pass along but must never
 * call. In a dev build nothing complains. In a production build the call throws
 *
 *     Attempted to call toOrgUnitOptions() from the server but
 *     toOrgUnitOptions is on the client.
 *
 * which is how `app/(app)/bereskan/data.ts` took down `/bereskan` — but only
 * once the page actually had a Temuan to build Merge candidates for, since the
 * call sits behind that condition. A page whose whole job is finding dirty data
 * worked perfectly until it found some.
 *
 * So the mappers live here, with no directive, and `EntityPicker.tsx` re-exports
 * them unchanged: client components keep importing from either module, and
 * server code imports from this one.
 *
 * Every mapper puts the kode in `keterangan`: two Unit Organisasi really can
 * share a nama, and the kode is the half that never changes (ADR-002).
 */

/** One choosable row. `id` is what gets stored; everything else is display. */
export type EntityOption = {
  id: string;
  /** What the user reads and searches: a nama, a label, a kode + nama. */
  label: string;
  /** Second line: the kode, the induk, the tipe — whatever disambiguates. */
  keterangan?: string;
  /** Nonaktif options are shown greyed and sorted last, never hidden. */
  status?: "aktif" | "nonaktif";
  /** Indent level, for a Unit Organisasi tree flattened into a list. */
  depth?: number;
  disabled?: boolean;
};

type OrgUnitLike = {
  id: string;
  kode: string;
  nama: string;
  tipe: string;
  status: string;
  depth?: number;
};

export function toOrgUnitOptions(
  rows: readonly OrgUnitLike[],
  labels?: Record<string, string>,
): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.nama,
    keterangan: `${row.kode} · ${labels?.[row.tipe] ?? row.tipe}`,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
    depth: row.depth,
  }));
}

type JabatanLike = { id: string; kode: string; nama: string; status: string };

export function toJabatanOptions(rows: readonly JabatanLike[]): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.nama,
    keterangan: row.kode,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}

type LookupLike = { id: string; kode: string; label: string; status: string };

export function toLookupOptions(rows: readonly LookupLike[]): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    keterangan: row.kode,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}
