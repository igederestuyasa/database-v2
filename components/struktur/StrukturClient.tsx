"use client";

/**
 * StrukturClient — everything interactive on `/struktur` (PRD #7, and the
 * Merge entry point of PRD #10).
 *
 * The page reads the whole hierarchy on the server and hands it down once;
 * this component filters it, and owns the three dialogs that write:
 *
 *   * tambah / ubah  → `OrgUnitForm`, which calls `lib/actions/orgUnits.ts`;
 *   * nonaktifkan / aktifkan → a confirmation, then the matching action;
 *   * Merge → the shared `MergeDialog`, which calls `mergeOrgUnit()` in
 *     `lib/actions/merge.ts`. Merge is the only operation here that moves
 *     Karyawan rows, it is one Postgres-side Batch, and it is deliberately
 *     **not** reimplemented in this unit.
 *
 * Renaming is not in that list of "moves Karyawan rows" for a reason: the nama
 * lives only in `org_units`, `employees.org_unit_id` is a uuid FK, and
 * `v_employees` joins the current nama back out. One row changes; every
 * Karyawan below it reads the new name on the next page load (ADR-002).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";

import { OrgUnitForm } from "@/components/forms/OrgUnitForm";
import { toOrgUnitOptions } from "@/components/shared/EntityPicker";
import { MergeDialog } from "@/components/shared/MergeDialog";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { activateOrgUnit, deactivateOrgUnit } from "@/lib/actions/orgUnits";
import { ORG_UNIT_TYPE_LABELS, STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { isOrgUnitType, type OrgUnitType } from "@/lib/validation/orgUnit";

import { OrgUnitTree, type OrgUnitTreeAction } from "./OrgUnitTree";
import { filterStrukturNodes, subtreeIds, type StrukturNode } from "./strukturNodes";

export type StrukturClientProps = {
  /** The whole hierarchy, pre-order, every status. */
  nodes: readonly StrukturNode[];
  isAdmin: boolean;
};

/** Which dialog is open, and about what. */
type FormState =
  | { mode: "tambah"; parentId: string | null; tipe?: OrgUnitType }
  | { mode: "ubah"; node: StrukturNode };

type KonfirmasiState = {
  node: StrukturNode;
  aksi: "nonaktifkan" | "aktifkan";
};

/**
 * One level down from `tipe`, as a starting point for "tambah di bawah ini" —
 * a suggestion the form can still override, not a rule.
 *
 * `proyek` is not a rung on that ladder: it is a tipe of unit that sits under
 * a Divisi, at roughly the Bagian level (ADR-002, and the seed mapping in
 * ARCHITECTURE.md §4E), so what goes below one is a Sub Bagian.
 */
const TIPE_DI_BAWAH: Record<OrgUnitType, OrgUnitType> = {
  direktorat: "divisi",
  divisi: "departemen",
  departemen: "bagian",
  bagian: "sub_bagian",
  sub_bagian: "sub_bagian",
  proyek: "sub_bagian",
};

export function StrukturClient({ nodes, isAdmin }: StrukturClientProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [query, setQuery] = React.useState("");
  const [tampilkanNonaktif, setTampilkanNonaktif] = React.useState(false);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [konfirmasi, setKonfirmasi] = React.useState<KonfirmasiState | null>(null);
  const [mergeSource, setMergeSource] = React.useState<StrukturNode | null>(null);

  const terlihat = React.useMemo(
    () => filterStrukturNodes(nodes, { query, tampilkanNonaktif }),
    [nodes, query, tampilkanNonaktif],
  );

  const jumlah = React.useMemo(() => {
    const aktif = nodes.filter((node) => node.status === "aktif").length;
    return { total: nodes.length, aktif, nonaktif: nodes.length - aktif };
  }, [nodes]);

  /**
   * Units that may be picked as induk. When editing, the unit itself and
   * everything below it are dropped — choosing one of those is the cycle the
   * `org_units_no_cycle` trigger refuses, and it reads far better as an
   * option that was never offered than as an error after saving.
   */
  const parentOptions = React.useMemo(() => {
    const terlarang =
      form?.mode === "ubah" ? subtreeIds(nodes, form.node.id) : new Set<string>();
    return toOrgUnitOptions(
      nodes.filter((node) => !terlarang.has(node.id)),
      ORG_UNIT_TYPE_LABELS,
    );
  }, [nodes, form]);

  /**
   * Merge targets: aktif, not already merged away, and never inside the
   * source's own subtree — re-parenting the source's children onto one of its
   * descendants is the cycle `merge_org_unit` refuses.
   *
   * Deliberately NOT narrowed to the same `tipe`. The SQL does not require it,
   * and the dirty seed data this page exists to clean up is full of units
   * filed at the wrong level — a "Divisi" that is really a Bagian is exactly
   * the pair someone needs to merge. The picker shows each candidate's tipe so
   * the choice is still an informed one.
   */
  const mergeCandidates = React.useMemo(() => {
    if (!mergeSource) return [];
    const subtree = subtreeIds(nodes, mergeSource.id);
    return toOrgUnitOptions(
      nodes.filter(
        (node) =>
          !subtree.has(node.id) &&
          node.status === "aktif" &&
          node.mergedIntoId === null,
      ),
      ORG_UNIT_TYPE_LABELS,
    );
  }, [nodes, mergeSource]);

  const anakAktif = React.useMemo(() => {
    if (!konfirmasi) return 0;
    return nodes.filter(
      (node) => node.parentId === konfirmasi.node.id && node.status === "aktif",
    ).length;
  }, [nodes, konfirmasi]);

  const handleAction = (action: OrgUnitTreeAction, node: StrukturNode) => {
    switch (action) {
      case "ubah":
        setForm({ mode: "ubah", node });
        break;
      case "tambah-anak":
        setForm({
          mode: "tambah",
          parentId: node.id,
          tipe: isOrgUnitType(node.tipe) ? TIPE_DI_BAWAH[node.tipe] : undefined,
        });
        break;
      case "merge":
        setMergeSource(node);
        break;
      case "nonaktifkan":
      case "aktifkan":
        setKonfirmasi({ node, aksi: action });
        break;
    }
  };

  const jalankanKonfirmasi = () => {
    if (!konfirmasi) return;
    const { node, aksi } = konfirmasi;

    startTransition(async () => {
      const result =
        aksi === "nonaktifkan"
          ? await deactivateOrgUnit({ id: node.id })
          : await activateOrgUnit({ id: node.id });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        aksi === "nonaktifkan"
          ? `"${node.nama}" dinonaktifkan. Datanya tetap tersimpan, tidak dihapus.`
          : `"${node.nama}" diaktifkan kembali.`,
      );
      setKonfirmasi(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cari-unit">{UI.cari}</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              />
              <Input
                id="cari-unit"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nama atau kode unit…"
                className="w-72 pl-8"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pb-2.5">
            <Checkbox
              id="tampilkan-nonaktif"
              checked={tampilkanNonaktif}
              onCheckedChange={(checked) => setTampilkanNonaktif(checked === true)}
            />
            <Label htmlFor="tampilkan-nonaktif" className="font-normal">
              Tampilkan unit {STATUS_LABELS.nonaktif.toLowerCase()}
            </Label>
          </div>
        </div>

        {isAdmin ? (
          <Button onClick={() => setForm({ mode: "tambah", parentId: null })}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Tambah {TERMS.unitOrganisasi}
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {jumlah.total} {TERMS.unitOrganisasi} · {jumlah.aktif}{" "}
        {STATUS_LABELS.aktif.toLowerCase()} · {jumlah.nonaktif}{" "}
        {STATUS_LABELS.nonaktif.toLowerCase()}
        {terlihat.length !== jumlah.total ? ` · ${terlihat.length} ditampilkan` : ""}
        {isAdmin ? "" : ` · ${UI.hanyaAdmin}`}
      </p>

      {nodes.length === 0 ? (
        // "Tidak ada yang cocok" is the tree's empty state; "belum ada apa-apa
        // sama sekali" is a different situation with a different next step, so
        // it is answered here rather than letting the tree offer to widen a
        // filter over an empty table.
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Belum ada {TERMS.unitOrganisasi}. Tambahkan Direktorat pertama, atau jalankan{" "}
          {TERMS.seed} awal dari Excel.
        </p>
      ) : (
        <OrgUnitTree
          nodes={terlihat}
          isAdmin={isAdmin}
          paksaTerbuka={query.trim().length > 0}
          onAction={handleAction}
        />
      )}

      {/* Tambah / ubah */}
      <Dialog open={form !== null} onOpenChange={(open) => (open ? null : setForm(null))}>
        {/* The frozen DialogContent is centred and unscrolled, and this form is
            taller than a laptop viewport once the "tanpa induk" warning shows —
            so Simpan would sit below the fold with no way to reach it. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.mode === "ubah"
                ? `${UI.ubah} ${TERMS.unitOrganisasi}`
                : `Tambah ${TERMS.unitOrganisasi}`}
            </DialogTitle>
            <DialogDescription>
              {form?.mode === "ubah"
                ? "Nama boleh berubah kapan saja; kode tetap. Tidak ada baris Karyawan yang ikut diubah."
                : "Unit baru masuk ke hierarki yang sama — pilih induknya dari daftar."}
            </DialogDescription>
          </DialogHeader>

          {form ? (
            <OrgUnitForm
              // Remount on a different row so the fields reset instead of
              // keeping the previous unit's values.
              key={form.mode === "ubah" ? form.node.id : `tambah-${form.parentId ?? "akar"}`}
              mode={form.mode}
              unit={
                form.mode === "ubah"
                  ? {
                      id: form.node.id,
                      kode: form.node.kode,
                      nama: form.node.nama,
                      tipe: isOrgUnitType(form.node.tipe) ? form.node.tipe : "divisi",
                      parent_id: form.node.parentId,
                    }
                  : undefined
              }
              defaultParentId={form.mode === "tambah" ? form.parentId : null}
              defaultTipe={form.mode === "tambah" ? form.tipe : undefined}
              parentOptions={parentOptions}
              onSelesai={() => {
                setForm(null);
                router.refresh();
              }}
              onBatal={() => setForm(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Nonaktifkan / aktifkan */}
      <AlertDialog
        open={konfirmasi !== null}
        onOpenChange={(open) => (open ? null : setKonfirmasi(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {konfirmasi?.aksi === "aktifkan"
                ? `${UI.aktifkan} "${konfirmasi.node.nama}"?`
                : `${UI.nonaktifkan} "${konfirmasi?.node.nama ?? ""}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {konfirmasi?.aksi === "aktifkan" ? (
                  <p>
                    Unit ini akan muncul lagi di semua daftar pilihan dan bisa dipakai
                    sebagai penempatan {TERMS.karyawan}.
                  </p>
                ) : (
                  <p>
                    {TERMS.unitOrganisasi} tidak pernah dihapus — unit ini hanya ditandai{" "}
                    {STATUS_LABELS.nonaktif.toLowerCase()} dan hilang dari daftar pilihan.
                    Perubahannya tercatat sebagai satu {TERMS.batch} yang bisa
                    dikembalikan.
                  </p>
                )}

                {konfirmasi?.aksi === "nonaktifkan" && anakAktif > 0 ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                    Unit ini masih punya {anakAktif} turunan aktif. Nonaktifkan atau
                    pindahkan turunannya lebih dulu — kalau tidak, penyimpanan akan
                    ditolak.
                  </p>
                ) : null}

                {konfirmasi?.aksi === "nonaktifkan" &&
                (konfirmasi.node.karyawanAktifLangsung ?? 0) > 0 ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                    {konfirmasi.node.karyawanAktifLangsung} {TERMS.karyawan} aktif masih
                    ditempatkan di sini. Pindahkan mereka dulu, atau pakai {TERMS.merge}{" "}
                    supaya semuanya ikut pindah sekaligus.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{UI.batal}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                // Keep the dialog open until the action answers, so a refusal
                // is read next to what it refused.
                event.preventDefault();
                jalankanKonfirmasi();
              }}
            >
              {pending
                ? "Menyimpan…"
                : konfirmasi?.aksi === "aktifkan"
                  ? UI.aktifkan
                  : UI.nonaktifkan}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Merge belongs to the shared dialog and to `mergeOrgUnit()`, not to this
        unit — it is the one operation here that moves Karyawan rows, it is
        three UPDATEs across two tables, and it therefore lives in the
        `merge_org_unit` Postgres function so the whole thing is one Batch that
        can be reverted whole (ADR-006). Nothing about it is reimplemented
        here; this only names the source and offers the candidates.
      */}
      {mergeSource ? (
        <MergeDialog
          kind="org_unit"
          open
          onOpenChange={(open) => (open ? null : setMergeSource(null))}
          source={{
            id: mergeSource.id,
            label: mergeSource.nama,
            keterangan: `${mergeSource.kode} · ${
              ORG_UNIT_TYPE_LABELS[mergeSource.tipe as OrgUnitType] ?? mergeSource.tipe
            }`,
            status: mergeSource.status === "nonaktif" ? "nonaktif" : "aktif",
          }}
          candidates={mergeCandidates}
          // Karyawan pointing straight at the source, any status — that is
          // exactly the set `merge_org_unit` re-points
          // (`where org_unit_id = source`). The units below are only
          // re-parented, so their Karyawan keep their own org_unit_id and must
          // not be counted here.
          affectedCount={mergeSource.karyawanPindahSaatMerge ?? undefined}
          // Refresh only — do NOT close the dialog here. MergeDialog calls
          // `onMerged` and then shows its "Merge selesai" screen, which is
          // where the link to the Batch that undoes the merge lives. Closing
          // from here would take away the one screen telling someone how to
          // undo a bulk move of hundreds of Karyawan. `onOpenChange` closes it.
          onMerged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

export default StrukturClient;
