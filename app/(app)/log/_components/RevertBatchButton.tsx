"use client";

/**
 * "Kembalikan seluruh Batch" (PRD #16).
 *
 * A Batch is one action — one simpan, one Merge, one Seed, one Revert
 * (CONTEXT.md) — and this is the button that undoes the whole of it. The
 * confirmation spells out the two things a reader must not get wrong:
 *
 *   * rows the Batch created are **deactivated**, never deleted;
 *   * the undo is itself a new Batch of jenis Revert, so nothing is erased
 *     from the log — and a Batch can only be undone once, which is why the
 *     button disappears afterwards.
 *
 * Everything runs inside `revert_batch` (`0002_batch_operations.sql`): one
 * transaction, one Batch, the Revisi applied in descending id order so a Merge
 * comes back in one piece. This component only asks and reports.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

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
import Tombol from "@/components/hc/Tombol";
import { toast } from "@/components/ui/sonner";
import { revertBatch } from "@/lib/actions/revisions";
import { UI } from "@/lib/i18n/terms";

export type RevertBatchButtonProps = {
  batchId: string;
  /** What the Batch was, in words: "Merge — Merge Jabatan: …". */
  judul: string;
  /** How many Revisi it holds, as far as this reader may see them. */
  jumlahRevisi: number;
};

export function RevertBatchButton({
  batchId,
  judul,
  jumlahRevisi,
}: RevertBatchButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleRevert() {
    setPending(true);
    let result;
    try {
      result = await revertBatch({ batchId });
    } catch (error) {
      // A rejected Server Action never returns a failure to show. Leaving
      // `pending` set would disable both this button and Batal for good, and an
      // admin would be left unable to tell whether the revert ran.
      console.error("[revert-batch]", error);
      toast.error(
        "Gagal menghubungi server. Muat ulang halaman ini untuk melihat apakah Batch sudah dikembalikan.",
      );
      return;
    } finally {
      setPending(false);
    }

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    setOpen(false);
    const dilewati = result.data.skipped.length;
    if (result.data.applied === 0) {
      toast.warning("Tidak ada baris yang berubah.", {
        description:
          "Batch ini ditandai sudah dikembalikan, tapi tidak ada baris yang ikut berubah.",
      });
    } else {
      toast.success("Batch dikembalikan.", {
        description:
          `${result.data.applied} baris dikembalikan` +
          (dilewati > 0 ? `, ${dilewati} Revisi dilewati` : "") +
          ". Tercatat sebagai Batch baru berjenis Revert.",
      });
    }
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tombol
        type="button"
        nada="sekunder"
        ukuran="ringkas"
        onClick={() => setOpen(true)}
      >
        {UI.kembalikanBatch}
      </Tombol>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kembalikan seluruh Batch ini?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-pendukung text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{judul}</span> —{" "}
                {jumlahRevisi} Revisi.
              </p>
              <p>
                Semua baris yang diubah Batch ini kembali ke keadaan sebelumnya.
                Baris yang <strong>dibuat</strong> oleh Batch ini menjadi{" "}
                <strong>Nonaktif</strong>, bukan dihapus — data Karyawan dan Data
                Referensi tidak pernah dihapus permanen.
              </p>
              <p>
                Hasilnya dicatat sebagai <strong>Batch baru berjenis Revert</strong>.
                Log tidak pernah dihapus, dan satu Batch hanya bisa dikembalikan
                sekali.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{UI.batal}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Stay open while the RPC runs: it can refuse (a Batch reverted
              // in another tab), and that message needs somewhere to land.
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

export default RevertBatchButton;
