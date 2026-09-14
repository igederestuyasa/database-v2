"use client";

/**
 * The Log Perubahan list: every Batch, newest first, each one expandable into
 * the Revisi it holds (PRD #16).
 *
 * Why the Revisi load on demand instead of arriving with the page: a `seed`
 * Batch holds ~3.000 of them and a `merge` a few hundred, so fetching every
 * Batch's contents to render twenty collapsed rows would be the slowest page in
 * the application. Expanding one Batch reads that Batch.
 *
 * Why the Batch title is not the whole story: since ADR-006 an ordinary edit is
 * a Batch of jenis `edit` with the keterangan "Perubahan data" — the trigger
 * writes it, not a human. Merge, Revert and Seed still name themselves. So the
 * row leans on what can always be said truthfully (jenis, waktu, pelaku, how
 * many Revisi), and the Revisi themselves say which rows and which columns
 * moved.
 */
import { useCallback, useEffect, useState } from "react";

import RevisionCard from "@/components/revisions/RevisionCard";
import type { ReferenceLabels } from "@/components/revisions/revisionDiff";
import { formatWaktu, actorLabel } from "@/components/revisions/revisionDiff";
import { useReferenceLabels } from "@/components/revisions/useReferenceLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadBatchRevisions } from "@/lib/actions/revisions";
import { BATCH_TYPE_LABELS, UI } from "@/lib/i18n/terms";
import type { BatchJenis } from "@/lib/revisions/tables";
import type { Batch, Revision } from "@/lib/types/db";

import RevertBatchButton from "./RevertBatchButton";

/** One row of the Log Perubahan: a Batch plus how many Revisi it holds. */
export type BatchRow = Batch & { revisionCount: number };

export type BatchListProps = {
  batches: readonly BatchRow[];
  /** Admin only: "Kembalikan seluruh Batch" (ARCHITECTURE.md §5). */
  canRevert: boolean;
  /** Actor emails already resolved on the server, so pelaku shows at once. */
  initialLabels: ReferenceLabels;
  /**
   * Batch to expand on arrival — `/log?batch=<id>`, the link another page hands
   * an admin after a Merge so they can undo it.
   */
  expandedBatchId?: string;
};

const EMPTY_REVISIONS: readonly Revision[] = [];

/** `edit` is the ordinary case and stays quiet; the rest are worth spotting. */
const BADGE_VARIANT: Record<BatchJenis, "default" | "secondary" | "outline"> = {
  edit: "outline",
  create: "secondary",
  deactivate: "secondary",
  merge: "default",
  rename: "secondary",
  seed: "secondary",
  revert: "default",
};

function jenisLabel(jenis: string): string {
  return jenis in BATCH_TYPE_LABELS ? BATCH_TYPE_LABELS[jenis as BatchJenis] : jenis;
}

function badgeVariant(jenis: string): "default" | "secondary" | "outline" {
  return jenis in BADGE_VARIANT ? BADGE_VARIANT[jenis as BatchJenis] : "secondary";
}

export function BatchList({
  batches,
  canRevert,
  initialLabels,
  expandedBatchId,
}: BatchListProps) {
  if (batches.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Belum ada Batch yang cocok dengan filter ini.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {batches.map((batch) => (
        <BatchItem
          key={batch.id}
          batch={batch}
          canRevert={canRevert}
          initialLabels={initialLabels}
          defaultOpen={batch.id === expandedBatchId}
        />
      ))}
    </ul>
  );
}

type Status = "idle" | "memuat" | "gagal";

function BatchItem({
  batch,
  canRevert,
  initialLabels,
  defaultOpen,
}: {
  batch: BatchRow;
  canRevert: boolean;
  initialLabels: ReferenceLabels;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [muat, setMuat] = useState<{ revisions: Revision[]; total: number } | null>(
    null,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [pesanGagal, setPesanGagal] = useState<string | null>(null);

  const revisions = muat?.revisions ?? EMPTY_REVISIONS;
  const { labels, gagal: gagalNama } = useReferenceLabels(revisions, {
    initial: initialLabels,
  });

  const sudahDikembalikan = batch.reverted_by_batch_id !== null;
  const judul = `${jenisLabel(batch.jenis)} — ${batch.keterangan ?? "Tanpa keterangan"}`;

  const muatRevisi = useCallback(async () => {
    setStatus("memuat");
    try {
      const result = await loadBatchRevisions({ batchId: batch.id });
      if (result.ok) {
        setMuat(result.data);
        setPesanGagal(null);
        setStatus("idle");
      } else {
        setPesanGagal(result.error.message);
        setStatus("gagal");
      }
    } catch (error) {
      // A rejected Server Action would otherwise leave this Batch stuck on
      // "Sedang memuat…" with no route back: the retry button only exists in
      // the failed state, and `toggle()` refuses to re-fetch while loading.
      console.error("[log]", error);
      setPesanGagal("Gagal menghubungi server.");
      setStatus("gagal");
    }
  }, [batch.id]);

  // `/log?batch=<id>` arrives expanded, so the link an admin follows after a
  // Merge shows what that Merge changed without another click.
  useEffect(() => {
    if (defaultOpen && muat === null && status === "idle") void muatRevisi();
    // Runs once per Batch: `muatRevisi` is stable and the guards are one-shot.
  }, [defaultOpen, muat, status, muatRevisi]);

  function toggle() {
    const berikutnya = !open;
    setOpen(berikutnya);
    if (berikutnya && muat === null && status !== "memuat") void muatRevisi();
  }

  const panelId = `batch-${batch.id}`;

  return (
    <li className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant(batch.jenis)}>
              {jenisLabel(batch.jenis)}
            </Badge>
            <span className="font-medium">
              {batch.keterangan ?? "Tanpa keterangan"}
            </span>
            {sudahDikembalikan ? (
              <Badge variant="outline">Sudah dikembalikan</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatWaktu(batch.created_at)} · oleh{" "}
            {actorLabel(batch.actor_id, labels)} · {batch.revisionCount} Revisi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={panelId}
          >
            {open ? "Sembunyikan Revisi" : "Lihat Revisi"}
          </Button>
          {canRevert && !sudahDikembalikan ? (
            <RevertBatchButton
              batchId={batch.id}
              judul={judul}
              jumlahRevisi={batch.revisionCount}
            />
          ) : null}
        </div>
      </div>

      {open ? (
        <div id={panelId} className="border-t px-4 py-3">
          {status === "memuat" ? (
            <p className="text-sm text-muted-foreground">{UI.sedangMemuat}</p>
          ) : status === "gagal" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {pesanGagal ?? UI.gagalMemuat}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void muatRevisi()}
              >
                {UI.cobaLagi}
              </Button>
            </div>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada Revisi yang bisa Anda baca di Batch ini. Revisi Data
              Pribadi Sensitif, API Key dan Pengguna dibatasi hak akses.
            </p>
          ) : (
            <>
              <ul className="space-y-3">
                {revisions.map((revision) => (
                  <RevisionCard
                    key={revision.id}
                    revision={revision}
                    labels={labels}
                    showRow
                  />
                ))}
              </ul>
              {muat && muat.total > revisions.length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Menampilkan {revisions.length} dari {muat.total} Revisi.
                  Mengembalikan Batch ini tetap mencakup semuanya.
                </p>
              ) : null}
              {gagalNama ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Sebagian nama Data Referensi tidak bisa dimuat, jadi ada nilai
                  yang tampil sebagai &ldquo;(tidak dikenal)&rdquo;.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default BatchList;
