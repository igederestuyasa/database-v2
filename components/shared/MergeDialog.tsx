"use client";

/**
 * MergeDialog — STUB with a frozen signature.
 *
 * Four pages open this dialog (Struktur Organisasi, Jabatan, Master Data and
 * "Perlu Dibereskan", PRD #10 and #12), so its props are fixed in Wave 1 and
 * the body is written by the unit that owns merging. Import it and type against
 * it today; it throws when rendered until then.
 * **Nobody changes these props afterwards.**
 *
 * What the finished dialog owes its callers:
 *   * name both sides in full, in CONTEXT.md vocabulary — "Gabungkan
 *     «Divisi QHSSE» ke «Divisi QHSSE (baru)»";
 *   * say how many Karyawan will move (`affectedCount`) before asking for
 *     confirmation — that number is why this is not an undo-able typo;
 *   * pick the target with `EntityPicker`, never a free-text box (ADR-002);
 *   * call the matching action in `lib/actions/merge.ts`, render the
 *     `ActionResult` failure message in place, and only then `onMerged`;
 *   * make clear that the source becomes nonaktif and is never deleted, and
 *     that the whole thing is one Batch that can be reverted (PRD #16).
 */
import type { ReactElement } from "react";

import type { EntityOption } from "./EntityPicker";

/** Which kind of Data Referensi is being merged. */
export type MergeEntityKind = "org_unit" | "jabatan" | "lookup";

export type MergeDialogProps = {
  kind: MergeEntityKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entity that will become nonaktif. */
  source: EntityOption;
  /** Possible targets — already filtered to the same tipe, minus the source. */
  candidates: readonly EntityOption[];
  /** Pre-selected target, e.g. the other half of a Temuan pair. */
  defaultTargetId?: string | null;
  /** How many Karyawan point at `source` and will be moved. */
  affectedCount?: number;
  /** Called after a successful merge, so the page can refresh. */
  onMerged?: (result: { sourceId: string; targetId: string; batchId: string }) => void;
};

export function MergeDialog(props: MergeDialogProps): ReactElement {
  void props;
  throw new Error(
    "not implemented — owned by unit Merge (components/shared/MergeDialog.tsx)",
  );
}

export default MergeDialog;
