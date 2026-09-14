"use client";

/**
 * Tabel satu tipe Lookup di halaman Master Data (PRD #9, #10).
 *
 * Everything an admin can do to a Lookup is here: tambah, ubah label/kode,
 * atur urutan, nonaktifkan/aktifkan, dan Merge. A viewer sees exactly the same
 * table without the controls (ARCHITECTURE.md §5).
 *
 * TWO THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT
 * ---------------------------------------------------------------------------
 * 1. **Urutan is typed, not dragged.** Reordering by dragging — or by "naik
 *    satu baris" — renumbers at least two rows, and over PostgREST every
 *    statement lands in its own Batch, so "kembalikan Batch ini" would undo
 *    half a reorder (ADR-006). A multi-row reorder would have to be a Postgres
 *    function, and the migration directory is frozen at two files. Writing one
 *    row's `urutan` is one statement, one Batch, and fully revertable — so
 *    that is what this does.
 * 2. **Merge is not implemented here.** It moves every Karyawan pointing at
 *    the source, which is why it lives in the `merge_lookup` Postgres function
 *    behind `lib/actions/merge.ts`. This file only opens the shared dialog.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import DataTable from "@/components/shared/DataTable";
import { toLookupOptions, type EntityOption } from "@/components/shared/EntityPicker";
import MergeDialog from "@/components/shared/MergeDialog";
import LookupForm from "@/components/forms/LookupForm";
import { countKaryawanByLookup, updateLookup } from "@/lib/actions/lookups";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { LOOKUP_TYPE_LABELS, type LookupType } from "@/lib/validation/lookupTypes";

/** One row of the active tab, already flattened by the Server Component. */
export type MasterDataRow = {
  id: string;
  tipe: LookupType;
  kode: string;
  label: string;
  urutan: number | null;
  status: "aktif" | "nonaktif";
  /** Set when this Lookup was the source half of a Merge. */
  mergedIntoId: string | null;
  /** Label of `mergedIntoId`, when it is in the same tab. */
  mergedIntoLabel: string | null;
};

export type LookupTableProps = {
  tipe: LookupType;
  rows: readonly MasterDataRow[];
  isAdmin: boolean;
};

type StatusFilter = "aktif" | "nonaktif" | "semua";

/**
 * How many Karyawan point at one Lookup, and which one was asked about.
 *
 * "gagal" is a state of its own rather than a silent `null`: both dialogs say
 * out loud how many Karyawan a decision touches, so "belum berhasil dihitung"
 * has to read differently from "sedang dihitung".
 */
type Pemakai =
  | { id: string; status: "memuat" }
  | { id: string; status: "ada"; total: number }
  | { id: string; status: "gagal" };

function urutanAsText(urutan: number | null): string {
  return urutan === null ? "" : String(urutan);
}

export function LookupTable({ tipe, rows, isAdmin }: LookupTableProps) {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("aktif");
  const [formRow, setFormRow] = React.useState<MasterDataRow | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<MasterDataRow | null>(null);
  const [mergeSource, setMergeSource] = React.useState<MasterDataRow | null>(null);
  const [pemakai, setPemakai] = React.useState<Pemakai | null>(null);
  const [sedangGantiStatus, setSedangGantiStatus] = React.useState(false);

  const tipeLabel = LOOKUP_TYPE_LABELS[tipe];

  /**
   * Ask how many Karyawan point at one Lookup, for the dialog about to open.
   * A late answer is harmless: every reader compares `pemakai.id` with the row
   * it is rendering.
   */
  const muatPemakai = React.useCallback((id: string) => {
    setPemakai({ id, status: "memuat" });
    countKaryawanByLookup(id)
      .then((result) => {
        setPemakai(
          result.ok
            ? { id, status: "ada", total: result.data.total }
            : { id, status: "gagal" },
        );
      })
      .catch((error: unknown) => {
        console.error("[master-data] gagal menghitung pemakai Lookup", error);
        setPemakai({ id, status: "gagal" });
      });
  }, []);

  const barisTampil = React.useMemo(
    () =>
      statusFilter === "semua"
        ? [...rows]
        : rows.filter((row) => row.status === statusFilter),
    [rows, statusFilter],
  );

  /** Merge targets: same tipe, still aktif, never the source itself. */
  const kandidatMerge: EntityOption[] = React.useMemo(() => {
    if (!mergeSource) return [];
    return toLookupOptions(
      rows.filter((row) => row.status === "aktif" && row.id !== mergeSource.id),
    );
  }, [rows, mergeSource]);

  const adaKandidatMerge = React.useMemo(
    () => rows.filter((row) => row.status === "aktif").length > 1,
    [rows],
  );

  const bukaTambah = React.useCallback(() => {
    setFormRow(null);
    setFormOpen(true);
  }, []);

  const bukaUbah = React.useCallback((row: MasterDataRow) => {
    setFormRow(row);
    setFormOpen(true);
  }, []);

  const bukaKonfirmasiStatus = React.useCallback(
    (row: MasterDataRow) => {
      setStatusTarget(row);
      muatPemakai(row.id);
    },
    [muatPemakai],
  );

  const bukaMerge = React.useCallback(
    (row: MasterDataRow) => {
      setMergeSource(row);
      muatPemakai(row.id);
    },
    [muatPemakai],
  );

  /**
   * Write one row's `urutan`. Answers whether it landed, so the cell can put
   * itself back to the stored value when it did not — a refresh alone cannot,
   * because a rejected save leaves the row exactly as the cell already has it.
   */
  const simpanUrutan = React.useCallback(
    async (row: MasterDataRow, nilai: string): Promise<boolean> => {
      const bersih = nilai.trim();
      if (bersih === urutanAsText(row.urutan)) return true;

      try {
        const result = await updateLookup({
          id: row.id,
          // A non-numeric entry becomes NaN, which `urutanSchema` refuses with
          // "Urutan harus berupa angka bulat." — the same message the form
          // shows, from the same schema.
          urutan: bersih === "" ? null : Number(bersih),
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }
        toast.success(`Urutan "${result.data.label}" disimpan.`);
        router.refresh();
        return true;
      } catch (error) {
        console.error("[master-data] gagal menyimpan urutan", error);
        toast.error("Gagal menyimpan urutan. Coba lagi.");
        return false;
      }
    },
    [router],
  );

  const gantiStatus = React.useCallback(async () => {
    if (!statusTarget) return;
    const berikutnya = statusTarget.status === "aktif" ? "nonaktif" : "aktif";

    setSedangGantiStatus(true);
    try {
      const result = await updateLookup({ id: statusTarget.id, status: berikutnya });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        berikutnya === "nonaktif"
          ? `"${result.data.label}" dinonaktifkan.`
          : `"${result.data.label}" diaktifkan kembali.`,
      );
      setStatusTarget(null);
      setPemakai(null);
      router.refresh();
    } catch (error) {
      // A rejected call (transport, deployment skew) must not leave both
      // dialog buttons disabled forever — hence `finally`, not a trailing
      // `setSedangGantiStatus(false)` on the happy path.
      console.error("[master-data] gagal mengubah status Lookup", error);
      toast.error("Gagal mengubah status. Coba lagi.");
    } finally {
      setSedangGantiStatus(false);
    }
  }, [router, statusTarget]);

  const columns = React.useMemo<ColumnDef<MasterDataRow>[]>(() => {
    const dasar: ColumnDef<MasterDataRow>[] = [
      {
        accessorKey: "kode",
        header: "Kode",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.kode}</span>
        ),
      },
      {
        accessorKey: "label",
        header: "Label",
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="font-medium">{row.original.label}</span>
            {row.original.mergedIntoId ? (
              <span className="block text-xs text-muted-foreground">
                {row.original.mergedIntoLabel
                  ? `Digabungkan ke "${row.original.mergedIntoLabel}"`
                  : "Digabungkan ke Lookup lain"}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "urutan",
        header: "Urutan",
        cell: ({ row }) =>
          isAdmin ? (
            <UrutanCell row={row.original} onSimpan={simpanUrutan} />
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {row.original.urutan ?? "—"}
            </span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "aktif" ? "secondary" : "outline"}>
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
    ];

    if (!isAdmin) return dasar;

    return [
      ...dasar,
      {
        id: "aksi",
        header: () => <span className="sr-only">Aksi</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const baris = row.original;
          // A merged-away Lookup stays nonaktif: reactivating it alone would
          // put an empty duplicate back in the dropdown while its Karyawan sit
          // on the target. Undo the Merge from the Log Perubahan instead.
          const terkunciKarenaMerge =
            baris.status === "nonaktif" && baris.mergedIntoId !== null;

          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <span className="sr-only">{`Aksi untuk ${baris.label}`}</span>
                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => bukaUbah(baris)}>
                    {UI.ubah}
                  </DropdownMenuItem>
                  {baris.status === "aktif" && adaKandidatMerge ? (
                    <DropdownMenuItem onSelect={() => bukaMerge(baris)}>
                      {`${TERMS.merge}…`}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => bukaKonfirmasiStatus(baris)}
                    disabled={terkunciKarenaMerge}
                  >
                    {baris.status === "aktif" ? UI.nonaktifkan : UI.aktifkan}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [isAdmin, adaKandidatMerge, simpanUrutan, bukaUbah, bukaMerge, bukaKonfirmasiStatus]);

  /** The count for one row, or `null` while it is unknown. */
  const pemakaiUntuk = (row: MasterDataRow | null): Pemakai | null =>
    row && pemakai?.id === row.id ? pemakai : null;

  const pemakaiTarget = pemakaiUntuk(statusTarget);
  const pemakaiSumber = pemakaiUntuk(mergeSource);

  return (
    <div className="space-y-3">
      <DataTable<MasterDataRow, unknown>
        columns={columns}
        data={barisTampil}
        getRowId={(row) => row.id}
        searchPlaceholder={`Cari kode atau label ${tipeLabel}…`}
        emptyMessage={
          statusFilter === "aktif"
            ? `Belum ada ${TERMS.lookup} aktif untuk ${tipeLabel}.`
            : UI.tidakAdaData
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-status" className="text-sm text-muted-foreground">
                Status
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(nilai) => setStatusFilter(nilai as StatusFilter)}
              >
                <SelectTrigger id="filter-status" className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aktif">{STATUS_LABELS.aktif}</SelectItem>
                  <SelectItem value="nonaktif">{STATUS_LABELS.nonaktif}</SelectItem>
                  <SelectItem value="semua">Semua</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isAdmin ? (
              <Button type="button" size="sm" onClick={bukaTambah}>
                {`${UI.tambah} ${TERMS.lookup}`}
              </Button>
            ) : null}
          </div>
        }
      />

      {isAdmin ? (
        <p className="text-xs text-muted-foreground">
          Urutan diketik langsung di tabel: angka kecil tampil lebih dulu di
          dropdown, yang dikosongkan tampil paling bawah menurut Label. Satu
          angka yang disimpan = satu {TERMS.revisi} yang bisa dikembalikan.
        </p>
      ) : null}

      {/* Tambah / Ubah */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setFormRow(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formRow ? `${UI.ubah} ${TERMS.lookup}` : `${UI.tambah} ${TERMS.lookup}`}
            </DialogTitle>
            <DialogDescription>
              {formRow
                ? `Mengganti label berlaku untuk semua ${TERMS.karyawan} yang memakainya, tanpa mengubah satu pun data ${TERMS.karyawan}.`
                : `Nilai baru untuk daftar ${tipeLabel}.`}
            </DialogDescription>
          </DialogHeader>
          {formOpen ? (
            <LookupForm
              // Remount on a different row, so the inputs reset.
              key={formRow?.id ?? "baru"}
              tipe={tipe}
              lookup={formRow}
              onCancel={() => {
                setFormOpen(false);
                setFormRow(null);
              }}
              onSaved={(lookup) => {
                toast.success(
                  formRow
                    ? `"${lookup.label}" disimpan.`
                    : `"${lookup.label}" ditambahkan.`,
                );
                setFormOpen(false);
                setFormRow(null);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Nonaktifkan / Aktifkan */}
      <AlertDialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStatusTarget(null);
            setPemakai(null);
          }
        }}
      >
        <AlertDialogContent>
          {statusTarget ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {statusTarget.status === "aktif"
                    ? `${UI.nonaktifkan} "${statusTarget.label}"?`
                    : `${UI.aktifkan} "${statusTarget.label}"?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {statusTarget.status === "aktif" ? (
                    <>
                      {TERMS.lookup} ini tidak muncul lagi di dropdown, tetapi
                      tidak dihapus:{" "}
                      {pemakaiTarget?.status === "ada"
                        ? `${pemakaiTarget.total} ${TERMS.karyawan} yang memakainya`
                        : pemakaiTarget?.status === "gagal"
                          ? `${TERMS.karyawan} yang memakainya (jumlahnya gagal dihitung)`
                          : `${TERMS.karyawan} yang sudah memakainya`}{" "}
                      tetap menunjuk nilai ini. Kalau yang Anda maksud adalah
                      menyatukan dua nilai kembar, pakai {TERMS.merge} supaya
                      mereka ikut pindah.
                    </>
                  ) : (
                    <>
                      {TERMS.lookup} ini akan muncul lagi di dropdown {tipeLabel}.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sedangGantiStatus}>
                  {UI.batal}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={sedangGantiStatus}
                  onClick={(event) => {
                    // Keep the dialog open until the action answers, so a
                    // failure is reported against what the user was looking at.
                    event.preventDefault();
                    void gantiStatus();
                  }}
                >
                  {statusTarget.status === "aktif" ? UI.nonaktifkan : UI.aktifkan}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge — the dialog and the RPC behind it belong to another unit. */}
      {mergeSource ? (
        <MergeDialog
          kind="lookup"
          open
          onOpenChange={(open) => {
            if (!open) {
              setMergeSource(null);
              setPemakai(null);
            }
          }}
          source={toLookupOptions([mergeSource])[0]}
          candidates={kandidatMerge}
          // Only when it is really known: the dialog contract says the number
          // is what turns a Merge from a typo into a decision, so a guess is
          // worse than leaving it out.
          {...(pemakaiSumber?.status === "ada"
            ? { affectedCount: pemakaiSumber.total }
            : {})}
          // Refresh only — do NOT close. A finished Merge leaves the dialog on
          // its "Merge selesai" screen, which is where the link to the Batch
          // that undoes it lives; closing from here would take that away
          // before anyone had read it. The user closes it themselves, and
          // `onOpenChange` above does the clearing.
          onMerged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

/**
 * The `urutan` cell: a number box that saves one row on blur.
 *
 * Local state so typing does not fight the server-rendered value, and an
 * effect that re-syncs whenever the row comes back changed — after a save of
 * its own, or after someone else's edit lands on a refresh.
 */
function UrutanCell({
  row,
  onSimpan,
}: {
  row: MasterDataRow;
  onSimpan: (row: MasterDataRow, nilai: string) => Promise<boolean>;
}) {
  const [nilai, setNilai] = React.useState(() => urutanAsText(row.urutan));
  const [menyimpan, setMenyimpan] = React.useState(false);

  React.useEffect(() => {
    setNilai(urutanAsText(row.urutan));
  }, [row.urutan]);

  return (
    <Input
      // Deliberately `text`, not `number`: `<input type="number">` reports an
      // empty value for content it cannot parse ("1e", "--"), which is
      // indistinguishable from the admin clearing the box — and clearing it
      // means "hapus urutan". As text, whatever was typed reaches
      // `urutanSchema` and comes back as a readable Indonesian message.
      type="text"
      inputMode="numeric"
      className="h-8 w-24 tabular-nums"
      aria-label={`Urutan ${row.label}`}
      value={nilai}
      disabled={menyimpan}
      onChange={(event) => setNilai(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setNilai(urutanAsText(row.urutan));
        }
      }}
      onBlur={() => {
        if (nilai.trim() === urutanAsText(row.urutan)) return;
        setMenyimpan(true);
        void onSimpan(row, nilai)
          .then((tersimpan) => {
            // Rejected: the stored row never moved, so the effect above will
            // not fire and the box would keep showing what was refused.
            if (!tersimpan) setNilai(urutanAsText(row.urutan));
          })
          .finally(() => setMenyimpan(false));
      }}
    />
  );
}

export default LookupTable;
