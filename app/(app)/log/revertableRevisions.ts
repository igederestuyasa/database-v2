/**
 * Which of the Revisi on screen can be put back one at a time, and one
 * sentence for the rest (PRD #15 on the Log Perubahan).
 *
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `RevertRevisionButton` does not render nothing for a Revisi that cannot be
 * reverted — it renders "Tidak bisa dikembalikan. <alasan>", which is right on
 * a detail page where one Revisi is in front of you and wrong on `/log`, where
 * an expanded `seed` Batch draws up to 100 Revisi at once. A Seed inserts a
 * row of `employee_private` per Karyawan, and an `insert` on a table with no
 * `status` column is exactly the case the planner skips — so the same
 * paragraph would appear a hundred times down one Batch.
 *
 * So the decision is made here instead: the card gets `canRevert` only for the
 * Revisi the planner would really act on, and everything it would skip is
 * counted into one line under the list. Same information, once.
 *
 * The decision itself is NOT re-implemented here. `planRevert()` is the pure,
 * unit-tested planner (`lib/revisions/revert.ts`), the same function
 * `RevertRevisionButton` calls for the button it draws and `revertRevision`
 * calls again on the server before anything is written. One call over the
 * whole list answers for every row: the planner never merges or drops rows —
 * every Revisi handed in comes back either as an operation or as a skip.
 *
 * A PLAIN module: no JSX, no hooks, no database, so `revertableRevisions.test.ts`
 * can cover it without a browser.
 */
import { planRevert, type RevertableRevision } from "@/lib/revisions/revert";

/** One reason a revert was skipped, and how many Revisi it applies to. */
export type AlasanTidakBisa = {
  /** The planner's own Indonesian wording, shown as-is. */
  keterangan: string;
  jumlah: number;
};

export type Revertability = {
  /** `revisions.id` of every Revisi "Kembalikan" should be offered for. */
  bisa: ReadonlySet<number>;
  /** How many of the Revisi handed in cannot be reverted one at a time. */
  jumlahTidakBisa: number;
  /** Why, grouped; most common first, then alphabetically so it is stable. */
  alasan: AlasanTidakBisa[];
};

/**
 * Split a list of Revisi into "can be reverted on its own" and "cannot, and
 * here is why".
 */
export function ringkasRevertability(
  revisions: readonly RevertableRevision[],
): Revertability {
  const plan = planRevert(revisions);

  const bisa = new Set<number>(plan.operations.map((op) => op.revisionId));

  const perKeterangan = new Map<string, number>();
  for (const dilewati of plan.skipped) {
    perKeterangan.set(
      dilewati.keterangan,
      (perKeterangan.get(dilewati.keterangan) ?? 0) + 1,
    );
  }

  const alasan = [...perKeterangan.entries()]
    .map(([keterangan, jumlah]) => ({ keterangan, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || a.keterangan.localeCompare(b.keterangan));

  return { bisa, jumlahTidakBisa: plan.skipped.length, alasan };
}

/**
 * The one line that replaces up to a hundred repeated notes, or `null` when
 * every Revisi on screen can be reverted.
 *
 * The caller decides whether to draw it at all: a viewer never sees
 * "Kembalikan", so telling them which Revisi they could not have pressed it on
 * is noise about a button that was never there.
 */
export function kalimatTidakBisa({
  jumlahTidakBisa,
  alasan,
}: Revertability): string | null {
  if (jumlahTidakBisa === 0 || alasan.length === 0) return null;

  const pembuka = `${jumlahTidakBisa} Revisi di bawah tidak bisa dikembalikan satu per satu.`;

  if (alasan.length === 1) return `${pembuka} ${alasan[0].keterangan}`;

  const rincian = alasan
    .map((item) => `${item.keterangan} (${item.jumlah} Revisi)`)
    .join(" ");
  return `${pembuka} ${rincian}`;
}
