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
import Link from "next/link";
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
import { toast } from "@/components/ui/sonner";
import DetailPanel from "@/components/hc/DetailPanel";
import FilterTabs from "@/components/hc/FilterTabs";
import PembukaLayar from "@/components/hc/PembukaLayar";
import SearchField from "@/components/hc/SearchField";
import StatusLabel from "@/components/hc/StatusLabel";
import TataLetakDaftarDetail from "@/components/hc/TataLetakDaftarDetail";
import Tombol from "@/components/hc/Tombol";
import useDaftarDetail from "@/components/hc/useDaftarDetail";
import DataTable from "@/components/shared/DataTable";
import { toLookupOptions, type EntityOption } from "@/components/shared/EntityPicker";
import MergeDialog from "@/components/shared/MergeDialog";
import LookupForm from "@/components/forms/LookupForm";
import { countKaryawanByLookup, updateLookup } from "@/lib/actions/lookups";
import { NAV_LABELS, STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { LOOKUP_TYPES, LOOKUP_TYPE_LABELS, type LookupType } from "@/lib/validation/lookupTypes";

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
  /** Jumlah baris per tipe, untuk angka di tab. */
  jumlahPerTipe: Readonly<Record<LookupType, number>>;
  /** Peringatan dari halaman — daftar yang terbaca tidak lengkap. */
  peringatan?: React.ReactNode;
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

export function LookupTable({
  tipe,
  rows,
  isAdmin,
  jumlahPerTipe,
  peringatan,
}: LookupTableProps) {
  const router = useRouter();
  const [cari, setCari] = React.useState("");

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

  const barisTampil = React.useMemo(() => {
    const kunci = cari.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "semua" && row.status !== statusFilter) return false;
      if (kunci === "") return true;
      return (
        row.label.toLowerCase().includes(kunci) ||
        row.kode.toLowerCase().includes(kunci)
      );
    });
  }, [rows, statusFilter, cari]);

  /** Pola daftar-detail; penyaringnya di browser, jadi Enter membuka teratas. */
  const dd = useDaftarDetail({
    items: barisTampil,
    idDari: (row) => row.id,
    kunciPencarian: cari,
  });
  const terpilih = dd.terpilih;

  const jumlahStatus = React.useMemo(() => {
    const aktif = rows.filter((row) => row.status === "aktif").length;
    return { aktif, nonaktif: rows.length - aktif, semua: rows.length };
  }, [rows]);

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
          <span className="tabular-nums">{row.original.kode}</span>
        ),
      },
      {
        accessorKey: "label",
        header: "Label",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/master-data/${row.original.id}`}
              // Barisnya sudah bisa diklik; tanpa ini satu klik pada tautan
              // menjalankan dua navigasi ke alamat yang sama.
              onClick={(event) => event.stopPropagation()}
              className="font-medium underline-offset-2 hover:underline"
            >
              {row.original.label}
            </Link>
            {row.original.mergedIntoId ? (
              <span className="block text-mikro font-normal text-muted-foreground">
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
          <StatusLabel nada={row.original.status === "aktif" ? "sukses" : "netral"}>
            {STATUS_LABELS[row.original.status]}
          </StatusLabel>
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
            <div
              className="text-right"
              // Barisnya membuka halaman detail; tanpa ini membuka menu aksi
              // juga ikut menavigasi ke sana.
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Tombol nada="halus" ukuran="ringkas" className="h-8 w-8 p-0">
                    <span className="sr-only">{`Aksi untuk ${baris.label}`}</span>
                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                  </Tombol>
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
    <>
      <TataLetakDaftarDetail
        panelTerlihat={dd.panelTerlihat}
        pembuka={
          <PembukaLayar
            salam="Data Referensi"
            judul={NAV_LABELS["master-data"]}
            subjudul={`Daftar pilihan berkode yang dirujuk ${TERMS.karyawan} lewat ID. Kode tetap; label boleh berubah kapan saja.`}
          >
            <SearchField
              id="cari-lookup"
              label={`${UI.cari} ${tipeLabel}`}
              nilai={cari}
              onNilaiChange={setCari}
              placeholder={`Kode atau label ${tipeLabel}…`}
              onSubmit={() => {
                if (dd.teratas) router.push(`/master-data/${dd.teratas.id}`);
              }}
              onPanahBawah={dd.fokusItemPertama}
            />
          </PembukaLayar>
        }
        panel={
          <DetailPanel
            entitas={TERMS.lookup}
            nama={terpilih?.label ?? null}
            kategori={tipeLabel}
            status={
              terpilih ? (
                <StatusLabel nada={terpilih.status === "aktif" ? "sukses" : "netral"}>
                  {STATUS_LABELS[terpilih.status]}
                </StatusLabel>
              ) : null
            }
            deskripsi={
              terpilih?.mergedIntoLabel
                ? `Digabung ke "${terpilih.mergedIntoLabel}".`
                : null
            }
            baris={
              terpilih
                ? [
                    { label: "Kode", nilai: terpilih.kode },
                    { label: "Tipe", nilai: tipeLabel },
                    {
                      label: "Urutan",
                      nilai: terpilih.urutan === null ? null : String(terpilih.urutan),
                    },
                    { label: "Status", nilai: STATUS_LABELS[terpilih.status] },
                  ]
                : undefined
            }
            pesanKosong={`Tidak ada ${tipeLabel} yang cocok. Ubah kata kunci, atau ganti filter status.`}
            aksi={
              terpilih ? (
                <Tombol
                  ukuran="panel"
                  onClick={() => router.push(`/master-data/${terpilih.id}`)}
                >
                  Buka detail {TERMS.lookup}
                </Tombol>
              ) : null
            }
          />
        }
      >
        <div className="space-y-6">
          {peringatan}

          {/* Sebelas tipe Lookup. Tiap tipe punya alamatnya sendiri, jadi
              tabnya tautan ber-aria-current, bukan tombol. */}
          <FilterTabs
            label={`Tipe ${TERMS.lookup}`}
            aktif={tipe}
            items={LOOKUP_TYPES.map((satu) => ({
              nilai: satu,
              label: LOOKUP_TYPE_LABELS[satu],
              jumlah: jumlahPerTipe[satu],
              href: `/master-data?tipe=${satu}`,
            }))}
          />

          <section aria-label={`Daftar ${tipeLabel}`} className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-judul-bagian text-foreground">{tipeLabel}</h2>
                <p className="mt-1 text-pendukung text-muted-foreground">
                  {jumlahStatus.semua} {TERMS.lookup} · {jumlahStatus.aktif}{" "}
                  {STATUS_LABELS.aktif.toLowerCase()} · {jumlahStatus.nonaktif}{" "}
                  {STATUS_LABELS.nonaktif.toLowerCase()}
                </p>
              </div>

              <FilterTabs
                label={`${UI.filter} status ${tipeLabel}`}
                aktif={statusFilter}
                items={[
                  { nilai: "aktif", label: STATUS_LABELS.aktif, jumlah: jumlahStatus.aktif },
                  { nilai: "nonaktif", label: STATUS_LABELS.nonaktif, jumlah: jumlahStatus.nonaktif },
                  { nilai: "semua", label: "Semua", jumlah: jumlahStatus.semua },
                ]}
                onPilih={(nilai) => setStatusFilter(nilai as StatusFilter)}
                className="border-b-0"
              />
            </div>

            <DataTable<MasterDataRow, unknown>
              columns={columns}
              data={barisTampil}
              getRowId={(row) => row.id}
              // Barisnya bisa diklik DAN labelnya tetap sebuah tautan
              // sungguhan: klik baris nyaman untuk mouse, tautan di dalam sel
              // itulah yang bisa dibuka di tab baru dan dibacakan pembaca
              // layar (PRD #14).
              onRowClick={(row) => router.push(`/master-data/${row.id}`)}
              cari={cari}
              emptyMessage={
                cari.trim() !== ""
                  ? `Tidak ada ${tipeLabel} yang cocok dengan pencarian ini.`
                  : statusFilter === "aktif"
                    ? `Belum ada ${TERMS.lookup} aktif untuk ${tipeLabel}.`
                    : UI.tidakAdaData
              }
              propsDaftar={dd.propsDaftar()}
              propsBaris={(row) => ({
                ...dd.propsItem(row),
                tabIndex: 0,
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                  event.preventDefault();
                  router.push(`/master-data/${row.id}`);
                },
              })}
              toolbar={
                isAdmin ? (
                  <Tombol className="ml-auto" onClick={bukaTambah}>
                    {`${UI.tambah} ${TERMS.lookup}`}
                  </Tombol>
                ) : (
                  <span className="ml-auto text-mikro font-normal text-muted-foreground">
                    {UI.hanyaAdmin}
                  </span>
                )
              }
            />
          </section>
        </div>
      </TataLetakDaftarDetail>

      {isAdmin ? (
        <p className="text-mikro font-normal text-muted-foreground">
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
    </>
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
      // Barisnya membuka halaman detail; tanpa ini mengklik kotak angka
      // memindahkan halaman di tengah pengetikan.
      onClick={(event) => event.stopPropagation()}
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
