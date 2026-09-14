"use client";

/**
 * OrgUnitTree — the hierarchy on `/struktur`, drawn from one flat pre-order
 * list.
 *
 * No pagination and no lazy loading: there are a few hundred Unit Organisasi
 * and the whole tree is meant to be on screen at once (ARCHITECTURE.md §7).
 * That is also what lets the toolbar filter instantly and what lets a merge
 * dialog know, without another round trip, how many Karyawan are about to
 * move.
 *
 * This component owns exactly one piece of state — which branches are
 * collapsed. Filtering belongs to the toolbar above it, and every write
 * belongs to `StrukturClient`, which owns the dialogs.
 */
import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORG_UNIT_TYPE_LABELS, STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import type { OrgUnitType } from "@/lib/validation/orgUnit";
import { cn } from "@/lib/utils";

import {
  collapseStrukturNodes,
  isYatim,
  type StrukturNode,
} from "./strukturNodes";

export type OrgUnitTreeAction =
  | "ubah"
  | "tambah-anak"
  | "merge"
  | "nonaktifkan"
  | "aktifkan";

export type OrgUnitTreeProps = {
  /** Already filtered, still in pre-order with the original `depth`. */
  nodes: readonly StrukturNode[];
  /** Admin sees the row menu; a viewer reads the tree (ARCHITECTURE.md §5). */
  isAdmin: boolean;
  /** While the toolbar is filtering, collapsing would hide the matches. */
  paksaTerbuka?: boolean;
  onAction: (action: OrgUnitTreeAction, node: StrukturNode) => void;
};

function labelTipe(tipe: string): string {
  return ORG_UNIT_TYPE_LABELS[tipe as OrgUnitType] ?? tipe;
}

export function OrgUnitTree({
  nodes,
  isAdmin,
  paksaTerbuka = false,
  onAction,
}: OrgUnitTreeProps) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const rows = React.useMemo(
    () => (paksaTerbuka ? [...nodes] : collapseStrukturNodes(nodes, collapsed)),
    [nodes, collapsed, paksaTerbuka],
  );

  /**
   * Which units have children *under the current filter*.
   *
   * Computed from `nodes` — the filtered but NOT yet collapsed list — because
   * collapsing a branch removes its children from `rows`, and a chevron
   * derived from `rows` would therefore disappear the instant it was used,
   * leaving the branch shut for good. In pre-order a node has children exactly
   * when the row after it sits deeper, which is the same rule
   * `collapseStrukturNodes` hides by.
   */
  const punyaAnakIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i + 1 < nodes.length; i += 1) {
      if (nodes[i + 1].depth > nodes[i].depth) ids.add(nodes[i].id);
    }
    return ids;
  }, [nodes]);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {UI.tidakDitemukan} Ubah kata kunci, atau tampilkan unit nonaktif.
      </p>
    );
  }

  return (
    // A plain list, not `role="tree"`: that role promises arrow-key navigation
    // and a selection model, and half-implementing it is worse for a screen
    // reader than not claiming it. The nesting is announced per row instead.
    <ul aria-label={`Hierarki ${TERMS.unitOrganisasi}`} className="divide-y rounded-md border">
      {rows.map((node) => {
        const punyaAnak = punyaAnakIds.has(node.id);
        const tertutup = !paksaTerbuka && collapsed.has(node.id);
        // While the toolbar is filtering, the tree is held open; offering a
        // chevron that does nothing would be worse than offering none.
        const bisaDilipat = punyaAnak && !paksaTerbuka;
        const nonaktif = node.status !== "aktif";

        return (
          <li
            key={node.id}
            className="flex items-center gap-2 px-2 py-2 hover:bg-muted/50"
          >
            <span className="sr-only">Tingkat {node.depth + 1}.</span>
            <div
              className="flex min-w-0 flex-1 items-center gap-2"
              style={{ paddingLeft: `${node.depth * 20}px` }}
            >
              {bisaDilipat ? (
                <button
                  type="button"
                  onClick={() => toggle(node.id)}
                  aria-expanded={!tertutup}
                  aria-label={`${tertutup ? "Buka" : "Tutup"} turunan ${node.nama}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {tertutup ? (
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span aria-hidden="true" className="inline-block h-5 w-5" />
              )}

              <Badge variant="outline" className="shrink-0 font-normal">
                {labelTipe(node.tipe)}
              </Badge>

              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      "truncate font-medium",
                      nonaktif && "text-muted-foreground line-through",
                    )}
                  >
                    {node.nama}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {node.kode}
                  </span>
                  {nonaktif ? (
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {STATUS_LABELS.nonaktif}
                    </Badge>
                  ) : null}
                  {isYatim(node) ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-xs text-amber-700"
                      title={`Tanpa induk — muncul sebagai ${TERMS.temuan} di halaman ${TERMS.perluDibereskan}.`}
                    >
                      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                      Tanpa induk
                    </span>
                  ) : null}
                </span>
                {node.mergedIntoNama ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    Sudah di-{TERMS.merge} ke &laquo;{node.mergedIntoNama}&raquo;
                  </span>
                ) : null}
              </span>
            </div>

            <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
              {node.karyawanAktifLangsung === null ? (
                <span title="Jumlah Karyawan tidak dihitung di halaman ini.">—</span>
              ) : (
                <span>
                  {node.karyawanAktifLangsung} {TERMS.karyawan}
                  {punyaAnak &&
                  node.karyawanAktifTotal !== null &&
                  node.karyawanAktifTotal !== node.karyawanAktifLangsung
                    ? ` · ${node.karyawanAktifTotal} dengan turunan`
                    : ""}
                </span>
              )}
            </span>

            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={`Aksi untuk ${node.nama}`}
                  >
                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onAction("ubah", node)}>
                    {UI.ubah}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("tambah-anak", node)}>
                    Tambah unit di bawah ini
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAction("merge", node)}>
                    {TERMS.merge} ke unit lain…
                  </DropdownMenuItem>
                  {nonaktif ? (
                    <DropdownMenuItem onSelect={() => onAction("aktifkan", node)}>
                      {UI.aktifkan}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onAction("nonaktifkan", node)}
                    >
                      {UI.nonaktifkan}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default OrgUnitTree;
