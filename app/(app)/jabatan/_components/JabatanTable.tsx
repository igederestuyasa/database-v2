"use client";

/**
 * Daftar Jabatan beserta tindakannya (PRD #8, plus tombol Merge dari #10).
 *
 * Semua baris Jabatan dimuat sekali di `page.tsx`; halaman ini hanya memilih
 * mana yang ditampilkan. Jumlahnya ratusan, jadi pencarian, pengurutan, dan
 * halaman diurus `DataTable` di sisi klien — sekaligus membuat daftar Jabatan
 * nonaktif selalu tersedia sebagai calon tujuan Merge, apa pun filternya.
 *
 * Yang sengaja TIDAK ada di tabel ini: kolom "jumlah pemegang" dan segala
 * bentuk kuota. Jabatan adalah nama pekerjaan yang bisa dipegang banyak
 * Karyawan sekaligus; kursi ber-kuota namanya Formasi dan ditunda (ADR-002).
 * Jumlah pemegang tetap ditampilkan, tapi di tempat yang memang memerlukannya:
 * konfirmasi Nonaktifkan dan dialog Merge.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import JabatanForm from "@/components/forms/JabatanForm";
import { DataTable } from "@/components/shared/DataTable";
import { toJabatanOptions } from "@/components/shared/EntityPicker";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { countJabatanHolders, setJabatanStatus } from "@/lib/actions/jabatan";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import type { Jabatan } from "@/lib/types/db";

import {
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  type StatusFilter,
} from "./statusFilter";

/** Hasil `countJabatanHolders`, disimpan bersama id yang dihitung. */
type Pemegang = {
  id: string;
  /** `null` kalau hitungannya gagal — dialognya tetap harus bisa dipakai. */
  jumlah: { total: number; aktif: number } | null;
};

export type JabatanTableProps = {
  /** Seluruh Jabatan, aktif maupun nonaktif. */
  rows: readonly Jabatan[];
  /** Filter yang sedang aktif, dibaca dari URL. */
  status: StatusFilter;
  /** Viewer hanya membaca; tombol tulisan disembunyikan (ARCHITECTURE.md §5). */
  isAdmin: boolean;
};

export function JabatanTable({ rows, status, isAdmin }: JabatanTableProps) {
  const router = useRouter();
  // Dua transisi terpisah: mengganti filter tidak boleh membuat tombol simpan
  // berbunyi "Menyimpan…", dan sebaliknya.
  const [sedangPindahFilter, mulaiPindahFilter] = React.useTransition();
  const [sedangMenyimpan, mulaiMenyimpan] = React.useTransition();

  const [formOpen, setFormOpen] = React.useState(false);
  const [sedangDiubah, setSedangDiubah] = React.useState<Jabatan | null>(null);
  const [targetStatus, setTargetStatus] = React.useState<Jabatan | null>(null);
  const [sumberMerge, setSumberMerge] = React.useState<Jabatan | null>(null);
  const [pemegang, setPemegang] = React.useState<Pemegang | null>(null);

  const namaPerId = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.id, row.nama);
    return map;
  }, [rows]);

  const barisTampil = React.useMemo(
    () => rows.filter((row) => status === "semua" || row.status === status),
    [rows, status],
  );

  /**
   * Hitung pemegang saat dialog dibuka.
   *
   * Dua hal yang gampang terlewat kalau ini sekadar `await`:
   *
   *   * Admin bisa menutup satu dialog dan membuka dialog Jabatan lain sebelum
   *     hitungan pertama sampai. Jawaban yang telat tidak boleh menempel pada
   *     Jabatan yang salah, jadi setiap permintaan membawa nomor urut dan
   *     hanya yang terakhir yang boleh menulis hasilnya.
   *   * Hitungannya bisa gagal (sesi habis, database tak terjangkau). Kalau
   *     kegagalan itu didiamkan, dialognya berhenti di "Sedang memuat…"
   *     selamanya sambil tombol konfirmasinya tetap bisa ditekan. Gagal pun
   *     dicatat, dan dialognya mengatakannya apa adanya.
   */
  const nomorPermintaan = React.useRef(0);
  const muatPemegang = React.useCallback((row: Jabatan) => {
    const nomor = (nomorPermintaan.current += 1);
    setPemegang(null);
    void countJabatanHolders({ id: row.id }).then((result) => {
      if (nomor !== nomorPermintaan.current) return;
      setPemegang({ id: row.id, jumlah: result.ok ? result.data : null });
    });
  }, []);

  const bukaTambah = () => {
    setSedangDiubah(null);
    setFormOpen(true);
  };

  const bukaUbah = React.useCallback((row: Jabatan) => {
    setSedangDiubah(row);
    setFormOpen(true);
  }, []);

  const bukaNonaktifkan = React.useCallback(
    (row: Jabatan) => {
      setTargetStatus(row);
      muatPemegang(row);
    },
    [muatPemegang],
  );

  const bukaMerge = React.useCallback(
    (row: Jabatan) => {
      setSumberMerge(row);
      muatPemegang(row);
    },
    [muatPemegang],
  );

  const ubahStatus = React.useCallback(
    (row: Jabatan, statusBaru: "aktif" | "nonaktif") => {
      mulaiMenyimpan(async () => {
        const result = await setJabatanStatus({
          id: row.id,
          status: statusBaru,
        });
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        toast.success(
          statusBaru === "nonaktif"
            ? `${TERMS.jabatan} "${row.nama}" dinonaktifkan.`
            : `${TERMS.jabatan} "${row.nama}" diaktifkan kembali.`,
        );
        setTargetStatus(null);
        router.refresh();
      });
    },
    [router],
  );

  const gantiFilter = (nilai: string) => {
    mulaiPindahFilter(() => {
      router.push(`/jabatan?status=${nilai}`);
    });
  };

  /**
   * Buka halaman detail satu Jabatan (PRD #14).
   *
   * Barisnya bisa diklik DAN namanya tetap sebuah tautan sungguhan: klik baris
   * nyaman untuk mouse, tautan di dalam sel itulah yang bisa di-Tab, dibuka di
   * tab baru, dan dibacakan pembaca layar. Sama seperti daftar Karyawan.
   */
  const bukaDetail = React.useCallback(
    (row: Jabatan) => {
      router.push(`/jabatan/${row.id}`);
    },
    [router],
  );

  const columns = React.useMemo<ColumnDef<Jabatan>[]>(() => {
    const dasar: ColumnDef<Jabatan>[] = [
      {
        accessorKey: "kode",
        header: "Kode",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.kode}</span>
        ),
      },
      {
        accessorKey: "nama",
        header: `Nama ${TERMS.jabatan}`,
        cell: ({ row }) => (
          <Link
            href={`/jabatan/${row.original.id}`}
            // Barisnya sudah bisa diklik; tanpa ini satu klik pada tautan
            // menjalankan dua navigasi ke alamat yang sama.
            onClick={(event) => event.stopPropagation()}
            className="font-medium underline-offset-2 hover:underline"
          >
            {row.original.nama}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const { status: statusBaris, merged_into_id } = row.original;
          const tujuan = merged_into_id
            ? namaPerId.get(merged_into_id)
            : undefined;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBaris === "aktif" ? "secondary" : "outline"}>
                {STATUS_LABELS[statusBaris === "aktif" ? "aktif" : "nonaktif"]}
              </Badge>
              {merged_into_id ? (
                <span className="text-xs text-muted-foreground">
                  Digabung ke {tujuan ? `"${tujuan}"` : `${TERMS.jabatan} lain`}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ];

    if (!isAdmin) return dasar;

    return [
      ...dasar,
      {
        id: "aksi",
        // Kolomnya tanpa judul terlihat, tapi tetap punya nama yang terbaca
        // pembaca layar — kolom tanpa header sama sekali membingungkan di sana.
        header: () => <span className="sr-only">Tindakan</span>,
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const jabatan = row.original;
          return (
            <div
              className="flex flex-wrap justify-end gap-1"
              // Barisnya membuka halaman detail; tanpa ini setiap tombol di sel
              // ini juga ikut membukanya di belakang dialog yang baru terbuka.
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => bukaUbah(jabatan)}
              >
                {UI.ubah}
                <span className="sr-only"> {jabatan.nama}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => bukaMerge(jabatan)}
              >
                Gabungkan
                <span className="sr-only"> {jabatan.nama} ke Jabatan lain</span>
              </Button>
              {jabatan.status === "aktif" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => bukaNonaktifkan(jabatan)}
                >
                  {UI.nonaktifkan}
                  <span className="sr-only"> {jabatan.nama}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={sedangMenyimpan}
                  onClick={() => ubahStatus(jabatan, "aktif")}
                >
                  {UI.aktifkan}
                  <span className="sr-only"> {jabatan.nama}</span>
                </Button>
              )}
            </div>
          );
        },
      },
    ];
  }, [
    isAdmin,
    namaPerId,
    sedangMenyimpan,
    bukaUbah,
    bukaMerge,
    bukaNonaktifkan,
    ubahStatus,
  ]);

  /**
   * Calon tujuan Merge: semua Jabatan lain, disaring hanya untuk membuang
   * sumbernya sendiri.
   *
   * Sengaja TIDAK menyaring yang nonaktif. Merge ada justru untuk membereskan
   * data kotor, dan kasus yang paling sering adalah ejaan kembar di mana yang
   * "benar" kebetulan sudah dinonaktifkan orang lain; menyembunyikannya dari
   * daftar berarti menutup satu-satunya jalan membereskannya. `EntityPicker`
   * memang dirancang menampilkan yang nonaktif dengan tanda, bukan
   * menghilangkannya. Aturan sahnya sebuah Merge — sumber ≠ tujuan, dan tidak
   * ada yang sudah pernah digabungkan — ditegakkan di dalam `merge_jabatan`,
   * tempat yang tidak bisa dilewati; menebak-nebak aturan tambahan di sini
   * hanya akan memblokir kasus yang seharusnya bisa dibereskan.
   */
  const kandidatMerge = React.useMemo(() => {
    if (!sumberMerge) return [];
    return toJabatanOptions(rows.filter((row) => row.id !== sumberMerge.id));
  }, [rows, sumberMerge]);

  const pemegangTarget =
    targetStatus && pemegang?.id === targetStatus.id ? pemegang : null;
  const pemegangSumber =
    sumberMerge && pemegang?.id === sumberMerge.id ? pemegang : null;

  return (
    <>
      <DataTable
        columns={columns}
        data={barisTampil}
        getRowId={(row) => row.id}
        onRowClick={bukaDetail}
        initialSorting={[{ id: "nama", desc: false }]}
        // Selama pindah filter, barisnya masih baris filter lama; katakan apa
        // adanya daripada membiarkannya terlihat seperti hasil yang baru.
        isLoading={sedangPindahFilter}
        searchPlaceholder={`${UI.cari} kode atau nama ${TERMS.jabatan}…`}
        emptyMessage={
          status === "nonaktif"
            ? `Tidak ada ${TERMS.jabatan} nonaktif.`
            : `Belum ada ${TERMS.jabatan}.`
        }
        toolbar={
          <>
            <Select value={status} onValueChange={gantiFilter}>
              <SelectTrigger
                className="h-9 w-[170px]"
                aria-label={`${UI.filter} status`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((nilai) => (
                  <SelectItem key={nilai} value={nilai}>
                    {STATUS_FILTER_LABELS[nilai]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isAdmin ? (
              <Button type="button" className="ml-auto" onClick={bukaTambah}>
                {UI.tambah} {TERMS.jabatan}
              </Button>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">
                {UI.hanyaAdmin}
              </span>
            )}
          </>
        }
      />

      {/* Tambah / Ubah */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {sedangDiubah
                ? `${UI.ubah} ${TERMS.jabatan}`
                : `${UI.tambah} ${TERMS.jabatan}`}
            </DialogTitle>
            <DialogDescription>
              {sedangDiubah
                ? `Mengganti nama berlaku untuk semua ${TERMS.karyawan} yang memegang ${TERMS.jabatan} ini — tidak ada baris ${TERMS.karyawan} yang perlu disentuh.`
                : `${TERMS.jabatan} adalah nama pekerjaan yang bisa dipegang banyak ${TERMS.karyawan} sekaligus, bukan kursi.`}
            </DialogDescription>
          </DialogHeader>
          <JabatanForm
            // Form baru untuk setiap Jabatan yang dibuka, supaya isinya tidak
            // tertinggal dari dialog sebelumnya.
            key={sedangDiubah?.id ?? "baru"}
            jabatan={sedangDiubah}
            onBatal={() => setFormOpen(false)}
            onSelesai={() => {
              setFormOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Nonaktifkan */}
      <AlertDialog
        open={targetStatus !== null}
        onOpenChange={(open) => {
          if (!open) setTargetStatus(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {UI.nonaktifkan} {TERMS.jabatan} &laquo;{targetStatus?.nama}
              &raquo;?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{kalimatPemegang(pemegangTarget)}</p>
                <p>
                  {TERMS.jabatan} tidak pernah dihapus: barisnya tetap ada,
                  tetap bisa diaktifkan kembali, dan tetap terbaca oleh{" "}
                  {TERMS.konsumen} yang menyimpan id-nya. Kalau sebenarnya ini{" "}
                  {TERMS.jabatan} yang sama dengan yang lain, pakai Gabungkan
                  supaya pemegangnya ikut pindah.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sedangMenyimpan}>{UI.batal}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sedangMenyimpan}
              onClick={(event) => {
                // Dialog ditutup setelah aksinya berhasil, bukan saat diklik.
                event.preventDefault();
                if (targetStatus) ubahStatus(targetStatus, "nonaktif");
              }}
            >
              {sedangMenyimpan ? "Menyimpan…" : UI.nonaktifkan}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Merge (PRD #10). Dialog dan aksinya milik unit Merge
        (`components/shared/MergeDialog.tsx` → `lib/actions/merge.ts` →
        `merge_jabatan`); halaman ini hanya menyerahkan sumber, calon tujuan,
        dan jumlah pemegang yang akan pindah. Seluruh pemindahannya satu
        transaksi di database, tidak pernah ditulis ulang di sini (ADR-006).

        Dipasang hanya saat dibuka, supaya `source` selalu ada dan pilihan
        tujuan tidak tertinggal dari baris sebelumnya.
      */}
      {sumberMerge ? (
        <MergeDialog
          kind="jabatan"
          open
          onOpenChange={(open) => {
            if (!open) setSumberMerge(null);
          }}
          source={toJabatanOptions([sumberMerge])[0]}
          candidates={kandidatMerge}
          affectedCount={pemegangSumber?.jumlah?.total}
          // HANYA menyegarkan. Jangan menutup dialognya di sini: `onMerged`
          // dipanggil tepat sebelum MergeDialog menampilkan layar "Merge
          // selesai", dan layar itulah yang memuat tautan ke Batch yang bisa
          // membatalkan Merge tadi. Menutup dari sini menghapus satu-satunya
          // tempat pemakainya bisa membaca cara mengembalikannya.
          // Penutupan tetap lewat `onOpenChange` di atas.
          onMerged={() => {
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Kalimat pembuka dialog Nonaktifkan: berapa orang yang terdampak. */
function kalimatPemegang(pemegang: Pemegang | null): string {
  if (pemegang === null) return UI.sedangMemuat;
  if (pemegang.jumlah === null) {
    return `Jumlah pemegang ${TERMS.jabatan} ini tidak bisa dihitung sekarang. Muat ulang halaman kalau ingin memastikannya dulu.`;
  }
  if (pemegang.jumlah.total === 0) {
    return `Belum ada ${TERMS.karyawan} yang memegang ${TERMS.jabatan} ini.`;
  }
  return `${pemegang.jumlah.total} ${TERMS.karyawan} memegang ${TERMS.jabatan} ini (${pemegang.jumlah.aktif} di antaranya aktif). Menonaktifkan tidak memindahkan mereka.`;
}

export default JabatanTable;
