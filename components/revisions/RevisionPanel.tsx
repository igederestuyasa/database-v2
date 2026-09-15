"use client";

/**
 * RevisionPanel — Riwayat Revisi for one row (PRD #14), with "Kembalikan" for
 * an admin (PRD #15).
 *
 * FROZEN SIGNATURE. "Riwayat Revisi" appears on the detail page of a Karyawan,
 * a Unit Organisasi, a Jabatan, a Lookup, an API Key and a Pengguna, so
 * `RevisionPanelProps` was fixed in Wave 1 and is unchanged here — only the
 * body was written. **Nobody changes these props.**
 *
 * What it owes its callers, and how each is kept:
 *
 *   * **Newest first, with pelaku, waktu and a before/after diff of the columns
 *     that actually changed.** `after` is a whole-row snapshot, so `RevisionCard`
 *     shows only the columns that moved, and resolves the FK uuids inside them
 *     to names first — a diff reading `org_unit_id: 3f2a… → 9b1c…` tells staf HC
 *     nothing.
 *   * **"Kembalikan" only when `canRevert`.** A viewer reads the log and never
 *     reverts (ARCHITECTURE.md §5). The Server Action checks the role again and
 *     so does RLS; this prop only decides whether the button is drawn.
 *   * **Say plainly when the list may be incomplete.** RLS hides Revisi of rows
 *     the reader may not see, so a viewer looking at Data Pribadi Sensitif,
 *     API Key or Pengguna sees fewer rows. That is correct, and the note below
 *     the list makes sure it does not read as data loss.
 *   * **Never present a revert as deleting the change.** A revert is a new
 *     Revisi inside a new Batch; the log is append-only (CONTEXT.md).
 *
 * `revisions` is optional on purpose: a Server Component that already read them
 * passes them in (no second round trip, no spinner), and anything else lets the
 * panel load its own. Either way the panel reloads the list itself after a
 * successful revert, so the new Revisi appears without waiting for the host
 * page to refresh.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadRowRevisions } from "@/lib/actions/revisions";
import { UI } from "@/lib/i18n/terms";
import type { LoggedTable } from "@/lib/revisions/tables";
import type { Revision } from "@/lib/types/db";

import RevisionCard from "./RevisionCard";
import { panelFetchLimit } from "./riwayat";
import { useReferenceLabels } from "./useReferenceLabels";

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

const EMPTY_REVISIONS: readonly Revision[] = [];

/**
 * Tables whose Riwayat RLS deliberately shortens (ARCHITECTURE.md §3).
 *
 * Shown as a note rather than hidden: a viewer who sees an empty list on a
 * Pengguna page must know it means "not yours to read", not "nothing happened".
 */
const CATATAN_AKSES: Partial<Record<LoggedTable, string>> = {
  employee_private:
    "Riwayat Data Pribadi Sensitif hanya bisa dibaca admin, jadi daftar ini kosong untuk viewer.",
  api_keys:
    "Riwayat API Key hanya bisa dibaca admin, jadi daftar ini kosong untuk viewer.",
  profiles:
    "Riwayat Pengguna hanya bisa dibaca admin atau pemilik akun itu sendiri.",
};

type Status = "siap" | "memuat" | "gagal";

export function RevisionPanel(props: RevisionPanelProps): ReactElement {
  const {
    table,
    rowId,
    revisions,
    canRevert = false,
    title,
    emptyMessage,
    limit = 10,
    onReverted,
  } = props;

  const controlled = revisions !== undefined;
  // Fetch a healthy margin over what is shown, so "Tampilkan semua" needs no
  // second round trip; the Server Action caps this at 200 either way. The
  // expression lives in `riwayat.ts` because every detail page that reads the
  // Riwayat on the server has to use the same ceiling — see the note there.
  const fetchLimit = panelFetchLimit(limit);

  const [fetched, setFetched] = useState<Revision[] | null>(null);
  const [status, setStatus] = useState<Status>(controlled ? "siap" : "memuat");
  const [pesanGagal, setPesanGagal] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const propKey = useMemo(
    () => (revisions ?? EMPTY_REVISIONS).map((revision) => revision.id).join(","),
    [revisions],
  );

  // The host re-rendered with a different set of Revisi: its copy is now the
  // fresher one, so stop shadowing it with the list fetched here.
  useEffect(() => {
    setFetched(null);
  }, [propKey]);

  useEffect(() => {
    // Nothing to fetch while the host supplies the list — until a revert here
    // makes that list stale (`reload`).
    if (controlled && reload === 0) return;

    let cancelled = false;
    setStatus("memuat");
    void (async () => {
      try {
        const result = await loadRowRevisions({ table, rowId, limit: fetchLimit });
        if (cancelled) return;
        if (result.ok) {
          setFetched(result.data.revisions);
          setPesanGagal(null);
          setStatus("siap");
        } else {
          setPesanGagal(result.error.message);
          setStatus("gagal");
        }
      } catch (error) {
        // A Server Action rejects when the call never lands (offline, a 500, a
        // deploy that moved the action id). Without this the panel would sit on
        // "Sedang memuat…" for good, with its retry button unreachable inside
        // the failed state.
        if (cancelled) return;
        console.error("[RevisionPanel]", error);
        setPesanGagal("Gagal menghubungi server.");
        setStatus("gagal");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [controlled, table, rowId, fetchLimit, reload]);

  const items = fetched ?? revisions ?? EMPTY_REVISIONS;
  const shown = showAll ? items : items.slice(0, limit);
  const { labels, gagal: gagalNama } = useReferenceLabels(shown);

  function handleReverted(result: { batchId: string; revisionId: number }) {
    // Re-read this row's Riwayat: the revert just added a Revisi to it.
    setReload((value) => value + 1);
    onReverted?.(result);
  }

  const catatanAkses = CATATAN_AKSES[table];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title ?? UI.riwayatRevisi}</CardTitle>
          <CardDescription>
            Perubahan terbaru di atas. Mengembalikan sebuah Revisi tidak menghapus
            apa pun — ia dicatat sebagai Revisi baru.
          </CardDescription>
        </div>
        {items.length > 0 ? (
          <Badge variant="secondary" className="shrink-0">
            {/* "50+" when the read hit its ceiling: this row may well have more
                Revisi, and a flat number would claim otherwise. */}
            {items.length}
            {items.length >= fetchLimit ? "+" : ""} Revisi
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* A failed reload never hides Revisi that are already on screen: after
            a revert the host's list is still real history, and replacing it
            with an error would look like the row lost its Riwayat. */}
        {status === "gagal" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {pesanGagal ?? UI.gagalMemuat}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReload((value) => value + 1)}
            >
              {UI.cobaLagi}
            </Button>
          </div>
        ) : null}

        {status === "memuat" && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{UI.sedangMemuat}</p>
        ) : items.length === 0 ? (
          status === "gagal" ? null : (
            <p className="text-sm text-muted-foreground">
              {emptyMessage ?? "Belum ada Revisi."}
            </p>
          )
        ) : (
          <>
            {status === "memuat" ? (
              <p className="text-xs text-muted-foreground">{UI.sedangMemuat}</p>
            ) : null}

            <ul className="space-y-3">
              {shown.map((revision) => (
                <RevisionCard
                  key={revision.id}
                  revision={revision}
                  labels={labels}
                  canRevert={canRevert}
                  onReverted={handleReverted}
                />
              ))}
            </ul>

            {items.length > shown.length ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAll(true)}
              >
                Tampilkan semua ({items.length})
              </Button>
            ) : null}

            {items.length >= fetchLimit ? (
              <p className="text-xs text-muted-foreground">
                Menampilkan {fetchLimit} Revisi terbaru. Riwayat selengkapnya ada
                di Log Perubahan.
              </p>
            ) : null}
          </>
        )}

        {catatanAkses ? (
          <p className="text-xs text-muted-foreground">{catatanAkses}</p>
        ) : null}

        {gagalNama ? (
          <p className="text-xs text-muted-foreground">
            Sebagian nama Data Referensi tidak bisa dimuat, jadi ada nilai yang
            tampil sebagai &ldquo;(tidak dikenal)&rdquo;.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default RevisionPanel;
