"use server";

/**
 * Merge dua Data Referensi (PRD #10) — STUB with frozen signatures.
 *
 * Three units need to call merge (Struktur Organisasi, Jabatan, Master Data)
 * and a fourth offers it from "Perlu Dibereskan" (PRD #12), so the signatures
 * are fixed here in Wave 1 and the bodies are filled in by the unit that owns
 * merging. Callers may import and type against these today; they throw until
 * then. **Nobody changes these signatures afterwards.**
 *
 * What a merge does, in ONE Batch of jenis `merge` (ARCHITECTURE.md §4B):
 *
 *   1. move every Karyawan from source to target
 *      (`employees.<kolom>_id = target WHERE <kolom>_id = source`);
 *   2. for Unit Organisasi only, re-parent the source's children
 *      (`org_units.parent_id = target WHERE parent_id = source`);
 *   3. deactivate the source and record where it went
 *      (`status = 'nonaktif'`, `merged_into_id = target`).
 *
 * Never a DELETE: the source row stays, nonaktif, pointing at its target, so a
 * Konsumen holding its id still resolves and the whole thing can be reverted
 * (ADR-003).
 *
 * Rules an implementation must keep:
 *   * `requireAdmin()` first, and RLS second — both (CLAUDE.md).
 *   * source ≠ target; refuse merging a row into itself.
 *   * for Lookup, source and target must share the same `tipe` — the FK column
 *     on `employees` is chosen by tipe, so a cross-tipe merge would orphan
 *     every Karyawan it moved.
 *   * for Unit Organisasi, the target must not be a descendant of the source,
 *     or step 2 builds a cycle (the trigger would refuse it mid-merge).
 *   * refuse a source that is already merged (`merged_into_id is not null`).
 *   * see `lib/revisions/batch.ts` on why the three statements may land in
 *     three Batch entries rather than one, and what to do about it.
 */
import type { ActionResult } from "./_guard";

/** Both ids are required and must differ. `keterangan` overrides the default. */
export type MergeInput = {
  /** The entity that will become nonaktif. */
  sourceId: string;
  /** The entity everything moves to. */
  targetId: string;
  /** Optional `batches.keterangan`; a readable default is generated if absent. */
  keterangan?: string;
};

export type MergeResult = {
  /** The `merge` Batch, so the UI can link straight to the Log Perubahan. */
  batchId: string;
  sourceId: string;
  targetId: string;
  /** How many Karyawan were moved from source to target. */
  movedEmployees: number;
  /** How many child Unit Organisasi were re-parented (0 for Jabatan/Lookup). */
  movedChildren: number;
};

/** Merge dua Unit Organisasi. Children are re-parented onto the target. */
export async function mergeOrgUnit(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  void input;
  throw new Error(
    "not implemented — owned by unit Struktur Organisasi (lib/actions/merge.ts:mergeOrgUnit)",
  );
}

/** Merge dua Jabatan. Every holder moves to the target. */
export async function mergeJabatan(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  void input;
  throw new Error(
    "not implemented — owned by unit Jabatan (lib/actions/merge.ts:mergeJabatan)",
  );
}

/** Merge dua Lookup of the same `tipe`. Refuses a cross-tipe merge. */
export async function mergeLookup(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  void input;
  throw new Error(
    "not implemented — owned by unit Master Data (lib/actions/merge.ts:mergeLookup)",
  );
}
