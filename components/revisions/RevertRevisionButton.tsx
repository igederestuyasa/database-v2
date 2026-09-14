"use client";

/**
 * "Kembalikan" for one Revisi (PRD #15), with the confirmation that explains
 * what is about to happen in words staf HC can act on.
 *
 * What it must never let a reader believe:
 *
 *   * that a revert deletes anything. Reverting an `insert` sets
 *     `status = 'nonaktif'` — the row stays, and no code path in HC Core
 *     deletes one (ADR-003). The dialog says so in those words;
 *   * that a revert erases the mistake. It writes new rows, which the
 *     `log_revision` trigger records as new Revisi in a Batch of jenis
 *     `revert`. The log is append-only (CONTEXT.md: "log tidak pernah dihapus
 *     atau diubah").
 *
 * The decision of what a revert would write is not made here: `planRevert()`
 * is the pure, unit-tested planner (`lib/revisions/revert.ts`), and the same
 * function runs again server-side inside `revertRevision`. Calling it here is
 * what lets the dialog say whether this Revisi comes back as a restore or as a
 * deactivation, and what replaces the button — with the planner's own
 * Indonesian reason — for a Revisi that cannot be undone at all.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/sonner";
import { revertRevision } from "@/lib/actions/revisions";
import { planRevert } from "@/lib/revisions/revert";
import { UI } from "@/lib/i18n/terms";
import type { Revision } from "@/lib/types/db";

export type RevertRevisionButtonProps = {
  revision: Revision;
  /** The row this Revisi is about, already named for a human. */
  rowTitle: string;
  /**
   * Indonesian names of the columns this Revisi moved, as the diff above
   * already shows them.
   *
   * A restore writes the whole `before` snapshot back, so counting the columns
   * it touches would say "6 kolom" next to a diff showing one change. Naming
   * what changed is both shorter and true.
   */
  kolomBerubah?: readonly string[];
  /** Called after a successful revert, so the caller can reload its list. */
  onReverted?: (result: { batchId: string; revisionId: number }) => void;
};

/** At most this many column names in the dialog; the rest are counted. */
const MAX_KOLOM_DISEBUT = 5;

function daftarKolom(kolom: readonly string[]): string {
  if (kolom.length <= MAX_KOLOM_DISEBUT) return kolom.join(", ");
  const sisa = kolom.length - MAX_KOLOM_DISEBUT;
  return `${kolom.slice(0, MAX_KOLOM_DISEBUT).join(", ")}, dan ${sisa} kolom lain`;
}

export function RevertRevisionButton({
  revision,
  rowTitle,
  kolomBerubah,
  onReverted,
}: RevertRevisionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const plan = useMemo(() => planRevert([revision]), [revision]);
  const operation = plan.operations[0];
  const alasanTidakBisa = operation ? null : (plan.skipped[0]?.keterangan ?? null);

  if (!operation) {
    return (
      <span className="text-xs text-muted-foreground" role="note">
        Tidak bisa dikembalikan. {alasanTidakBisa}
      </span>
    );
  }

  const kolom = kolomBerubah ?? [];

  async function handleRevert() {
    setPending(true);
    let result;
    try {
      result = await revertRevision({ revisionId: revision.id });
    } catch (error) {
      // A Server Action rejects, rather than returning a failure, when the call
      // itself does not arrive: offline, a 500, a deploy that moved the action
      // id. Without this the dialog would keep both buttons disabled and say
      // "Mengembalikan…" until the page is reloaded.
      console.error("[revert]", error);
      toast.error("Gagal menghubungi server. Coba lagi.");
      return;
    } finally {
      setPending(false);
    }

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    setOpen(false);

    // `applied = 0` means the write matched no row. `apply_revert_operation`
    // shouts for the six data tables, but `profiles` rows can vanish with their
    // `auth.users` row, so a Revisi there can legitimately write nothing. Saying
    // "dikembalikan" for that would be the one thing a revert must never do:
    // report a change that did not happen.
    if (result.data.applied === 0) {
      toast.warning("Tidak ada baris yang berubah.", {
        description:
          "Revisi ini tidak mengubah baris mana pun — barisnya mungkin sudah tidak ada. Log Perubahan tetap mencatat percobaan ini.",
      });
    } else {
      const dilewati = result.data.skipped.length;
      toast.success("Revisi dikembalikan.", {
        description:
          dilewati > 0
            ? `${dilewati} Revisi dilewati. Perubahan ini tercatat sebagai Revisi baru.`
            : "Perubahan ini tercatat sebagai Revisi baru di Batch berjenis Revert.",
      });
    }

    onReverted?.({ batchId: result.data.batchId, revisionId: revision.id });
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`${UI.kembalikan} Revisi #${revision.id}`}
      >
        {UI.kembalikan}
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kembalikan ke versi sebelum Revisi ini?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{rowTitle}</span> —
                Revisi #{revision.id}.
              </p>
              {operation.kind === "deactivate" ? (
                <p>
                  Baris ini <strong>dibuat</strong> oleh Revisi tersebut, jadi
                  mengembalikannya berarti menjadikannya{" "}
                  <strong>Nonaktif</strong>. Baris tidak pernah dihapus permanen,
                  sehingga aplikasi lain yang sudah menyimpan ID-nya tetap aman.
                </p>
              ) : (
                <p>
                  Baris ini dikembalikan ke keadaan sebelum Revisi tersebut
                  {kolom.length > 0 ? (
                    <>
                      . Yang berubah pada Revisi ini:{" "}
                      <span className="text-foreground">{daftarKolom(kolom)}</span>
                    </>
                  ) : null}
                  .
                </p>
              )}
              <p>
                Tindakan ini tercatat sebagai <strong>Revisi baru</strong> di
                dalam Batch berjenis Revert. Log tidak pernah dihapus atau
                diubah, dan revert ini sendiri masih bisa dikembalikan lagi.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{UI.batal}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open while the Server Action runs, so the
              // button can show progress and an error has somewhere to land.
              event.preventDefault();
              void handleRevert();
            }}
            disabled={pending}
          >
            {pending ? "Mengembalikan…" : UI.kembalikan}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default RevertRevisionButton;
