"use client";

/**
 * RevisionPanel — STUB with a frozen signature.
 *
 * "Riwayat Revisi" appears on the detail page of a Karyawan, a Unit
 * Organisasi, a Jabatan, a Lookup, an API Key and a Pengguna (PRD #14), so its
 * props are fixed in Wave 1 and the body is written by the unit that owns
 * Revisi and Revert. Import it and type against it today; it throws when
 * rendered until then. **Nobody changes these props afterwards.**
 *
 * What the finished panel owes its callers:
 *   * list Revisi newest first, each with pelaku, waktu, Batch and a
 *     before/after diff of the columns that actually changed — `after` is a
 *     whole-row snapshot, so showing every column buries the one that moved;
 *   * offer "Kembalikan" (`UI.kembalikan`) only when `canRevert` — a viewer
 *     reads the log but never reverts (ARCHITECTURE.md §5);
 *   * say plainly when the list may be incomplete: RLS hides Revisi of rows
 *     the reader may not see, so a viewer looking at `profiles` or
 *     `employee_private` sees fewer rows, which is correct and must not read
 *     as data loss (ADR-005 §9);
 *   * never present a revert as "menghapus perubahan" — a revert is a new
 *     Revisi, and the log is never edited (CONTEXT.md).
 */
import type { ReactElement } from "react";

import type { Revision } from "@/lib/types/db";
import type { LoggedTable } from "@/lib/revisions/tables";

export type RevisionPanelProps = {
  /** Which logged table the row lives in — one of the seven (ADR-005 §12). */
  table: LoggedTable;
  /** `revisions.row_id`: `employees.id`, or `employee_private.employee_id`. */
  rowId: string;
  /**
   * Revisi already read on the server (`listRevisionsByRow`). When omitted the
   * panel loads them itself from the browser client.
   */
  revisions?: readonly Revision[];
  /** Show the "Kembalikan" button. Pass the caller's admin check. */
  canRevert?: boolean;
  /** Default: "Riwayat Revisi". */
  title?: string;
  /** Default: "Belum ada Revisi.". */
  emptyMessage?: string;
  /** How many to show before "lihat selengkapnya". Default 10. */
  limit?: number;
  /** Called after a successful revert, so the page can refresh. */
  onReverted?: (result: { batchId: string; revisionId: number }) => void;
};

export function RevisionPanel(props: RevisionPanelProps): ReactElement {
  void props;
  throw new Error(
    "not implemented — owned by unit Revisi & Revert (components/revisions/RevisionPanel.tsx)",
  );
}

export default RevisionPanel;
