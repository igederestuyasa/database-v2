"use client";

/**
 * Daftar API Key beserta tindakannya (PRD #19).
 *
 * Halaman ini memegang tiga dialog, dan yang pertama adalah alasan seluruh
 * berkas ini ditulis dengan hati-hati:
 *
 *   1. **Key baru, sekali tampil.** Setelah `createApiKey` berhasil, key
 *      penuhnya ada di satu tempat saja di seluruh sistem: layar ini. Yang
 *      tersimpan di database hanya SHA-256-nya, dan tidak ada jalan
 *      mengembalikan key dari hash. Karena itu dialognya dibuat sulit
 *      ditutup tanpa sengaja — bukan dari kerewelan, melainkan karena admin
 *      yang menutupnya sambil mengira "nanti bisa dilihat lagi" sudah
 *      kehilangan key itu.
 *   2. **Ubah** — nama Konsumen dan whitelist kolomnya.
 *   3. **Nonaktifkan / Aktifkan** — tidak pernah hapus.
 *
 * Yang tidak pernah ada di layar ini, dan tidak pernah sampai ke browser
 * sama sekali: `key_hash`. `lib/db/apiKeys.ts` tidak pernah memilih kolom itu
 * dan `lib/actions/apiKeys.ts` juga tidak, jadi baris yang tiba di sini
 * memang tidak memuatnya.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/shared/DataTable";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { setApiKeyStatus, type ApiKeyBaru } from "@/lib/actions/apiKeys";
import { TOTAL_API_FIELDS, sortApiFields } from "@/lib/apiKeys/fieldGroups";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";

import { ApiKeyForm } from "./ApiKeyForm";

/**
 * Satu baris API Key seperti yang dilihat layar.
 *
 * Tanggalnya sudah berupa string jadi — diformat di `page.tsx` (Server
 * Component) supaya zona waktunya pasti Asia/Jakarta dan React tidak
 * melaporkan hydration mismatch.
 */
export type ApiKeyRow = {
  id: string;
  nama_konsumen: string;
  key_prefix: string | null;
  allowed_fields: string[];
  status: "aktif" | "nonaktif";
  dibuat: string;
  /** `null` = belum pernah dipakai Konsumen. */
  terakhirDipakai: string | null;
};

export type ApiKeyTableProps = {
  /** Seluruh key, aktif maupun nonaktif; `page.tsx` tidak menyaring apa pun. */
  rows: ApiKeyRow[];
};

export function ApiKeyTable({ rows }: ApiKeyTableProps) {
  const router = useRouter();
  const [sedangMenyimpan, mulaiMenyimpan] = React.useTransition();

  const [formOpen, setFormOpen] = React.useState(false);
  const [sedangDiubah, setSedangDiubah] = React.useState<ApiKeyRow | null>(null);
  const [targetStatus, setTargetStatus] = React.useState<ApiKeyRow | null>(null);
  /** Key penuh yang baru dibuat. Ada di memori hanya selama dialognya terbuka. */
  const [keyBaru, setKeyBaru] = React.useState<ApiKeyBaru | null>(null);

  const bukaTambah = () => {
    setSedangDiubah(null);
    setFormOpen(true);
  };

  const bukaUbah = React.useCallback((row: ApiKeyRow) => {
    setSedangDiubah(row);
    setFormOpen(true);
  }, []);

  const ubahStatus = React.useCallback(
    (row: ApiKeyRow, statusBaru: "aktif" | "nonaktif") => {
      mulaiMenyimpan(async () => {
        const result = await setApiKeyStatus({ id: row.id, status: statusBaru });
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        toast.success(
          statusBaru === "nonaktif"
            ? `${TERMS.apiKey} "${row.nama_konsumen}" dinonaktifkan. Permintaan dengan key itu sekarang dijawab 401.`
            : `${TERMS.apiKey} "${row.nama_konsumen}" diaktifkan kembali.`,
        );
        setTargetStatus(null);
        router.refresh();
      });
    },
    [router],
  );

  const columns = React.useMemo<ColumnDef<ApiKeyRow>[]>(
    () => [
      {
        accessorKey: "nama_konsumen",
        header: `Nama ${TERMS.konsumen}`,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium">{row.original.nama_konsumen}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {row.original.key_prefix ?? "—"}
              <span aria-hidden="true">…</span>
              <span className="sr-only">
                {" "}
                (delapan karakter pertama key; selebihnya tidak disimpan)
              </span>
            </div>
          </div>
        ),
      },
      {
        id: "kolom",
        accessorFn: (row) => row.allowed_fields.join(" "),
        header: "Kolom yang boleh diambil",
        cell: ({ row }) => {
          const fields = sortApiFields(row.original.allowed_fields);
          const cuplikan = fields.slice(0, 3);
          const sisa = fields.length - cuplikan.length;
          return (
            <div className="max-w-xs space-y-1">
              <div className="text-xs">
                {fields.length} dari {TOTAL_API_FIELDS} kolom
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {fields.length === 0
                  ? "belum ada kolom yang diizinkan"
                  : `${cuplikan.join(", ")}${sisa > 0 ? `, +${sisa} lainnya` : ""}`}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "aktif" ? "secondary" : "outline"}
          >
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "terakhirDipakai",
        header: "Terakhir dipakai",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.terakhirDipakai ?? "Belum pernah"}
          </span>
        ),
      },
      {
        accessorKey: "dibuat",
        header: "Dibuat",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.dibuat}
          </span>
        ),
      },
      {
        id: "aksi",
        // Tanpa judul yang terlihat, tapi tetap punya nama yang terbaca
        // pembaca layar — kolom tanpa header sama sekali membingungkan di sana.
        header: () => <span className="sr-only">Tindakan</span>,
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const apiKey = row.original;
          return (
            <div className="flex flex-wrap justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => bukaUbah(apiKey)}
              >
                {UI.ubah}
                <span className="sr-only"> {apiKey.nama_konsumen}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={sedangMenyimpan}
                onClick={() => setTargetStatus(apiKey)}
              >
                {apiKey.status === "aktif" ? UI.nonaktifkan : UI.aktifkan}
                <span className="sr-only"> {apiKey.nama_konsumen}</span>
              </Button>
            </div>
          );
        },
      },
    ],
    [bukaUbah, sedangMenyimpan],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        initialSorting={[{ id: "nama_konsumen", desc: false }]}
        searchPlaceholder={`${UI.cari} nama ${TERMS.konsumen}…`}
        emptyMessage={`Belum ada ${TERMS.apiKey}.`}
        toolbar={
          <Button type="button" className="ml-auto" onClick={bukaTambah}>
            {UI.tambah} {TERMS.apiKey}
          </Button>
        }
      />

      {/* Tambah / Ubah */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {sedangDiubah
                ? `${UI.ubah} ${TERMS.apiKey}`
                : `${UI.tambah} ${TERMS.apiKey}`}
            </DialogTitle>
            <DialogDescription>
              {sedangDiubah
                ? `Mengubah daftar kolom langsung berlaku pada permintaan ${TERMS.konsumen} berikutnya. Key-nya sendiri tidak berubah dan tidak bisa ditampilkan lagi.`
                : `Key akan dibuat server dan ditampilkan SEKALI setelah disimpan. Salin saat itu juga — tidak ada cara melihatnya lagi.`}
            </DialogDescription>
          </DialogHeader>
          <ApiKeyForm
            // Form baru untuk setiap key yang dibuka, supaya isinya tidak
            // tertinggal dari dialog sebelumnya.
            key={sedangDiubah?.id ?? "baru"}
            apiKey={sedangDiubah}
            onBatal={() => setFormOpen(false)}
            onDiubah={() => {
              setFormOpen(false);
              router.refresh();
            }}
            onDibuat={(hasil) => {
              // Tutup form, lalu tampilkan key penuhnya. Penyegaran daftar
              // menunggu sampai dialog key ditutup: `router.refresh()` di sini
              // akan merender ulang pohon ini sementara satu-satunya salinan
              // key itu ada di state-nya.
              setFormOpen(false);
              setKeyBaru(hasil);
            }}
          />
        </DialogContent>
      </Dialog>

      {/*
        Dipasang hanya saat ada key baru, dan dengan begitu SELALU mulai dari
        keadaan awal: kotak "sudah saya simpan" yang masih tercentang dari key
        sebelumnya akan membuat tombol Tutup key berikutnya bisa ditekan
        sebelum orangnya sempat membaca — persis kecelakaan yang dicegah
        seluruh dialog ini. Mengosongkannya lewat `useEffect` tidak cukup:
        efek berjalan setelah frame pertama dicat.
      */}
      {keyBaru ? (
        <KeyBaruDialog
          hasil={keyBaru}
          onSelesai={() => {
            setKeyBaru(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* Nonaktifkan / Aktifkan */}
      <AlertDialog
        open={targetStatus !== null}
        onOpenChange={(open) => {
          if (!open) setTargetStatus(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {targetStatus?.status === "aktif"
                ? `${UI.nonaktifkan} ${TERMS.apiKey} «${targetStatus?.nama_konsumen}»?`
                : `${UI.aktifkan} kembali ${TERMS.apiKey} «${targetStatus?.nama_konsumen}»?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {targetStatus?.status === "aktif" ? (
                  <>
                    <p>
                      Mulai saat itu juga setiap permintaan yang memakai key ini
                      dijawab <code>401</code>. Kalau {TERMS.konsumen} itu masih
                      berjalan, halamannya akan berhenti menampilkan data{" "}
                      {TERMS.karyawan}.
                    </p>
                    <p>
                      Key tidak pernah dihapus: barisnya tetap ada, tetap
                      terbaca di {TERMS.revisi}, dan bisa diaktifkan kembali.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Key lama yang masih dipegang {TERMS.konsumen} akan berlaku
                      lagi beserta daftar kolomnya yang sekarang.
                    </p>
                    <p>
                      Kalau key ini dinonaktifkan karena bocor, jangan
                      diaktifkan: buat key baru, pasang di {TERMS.konsumen},
                      lalu biarkan yang ini nonaktif.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sedangMenyimpan}>
              {UI.batal}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={sedangMenyimpan}
              onClick={(event) => {
                // Dialog ditutup setelah aksinya berhasil, bukan saat diklik.
                event.preventDefault();
                if (targetStatus) {
                  ubahStatus(
                    targetStatus,
                    targetStatus.status === "aktif" ? "nonaktif" : "aktif",
                  );
                }
              }}
            >
              {sedangMenyimpan
                ? "Menyimpan…"
                : targetStatus?.status === "aktif"
                  ? UI.nonaktifkan
                  : UI.aktifkan}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Satu-satunya kali key penuh terlihat.
 *
 * `AlertDialog`, bukan `Dialog`, dan itu bukan soal selera: `Dialog` punya
 * tombol silang di pojok dan menutup saat latar diklik, dua cara membuang
 * kredensial yang tidak bisa diambil kembali dengan gerakan refleks. Radix
 * `AlertDialog` tidak punya keduanya; Escape ditutup di sini juga. Jalan
 * keluarnya satu: mencentang "sudah saya simpan", lalu menekan tombolnya.
 */
function KeyBaruDialog({
  hasil,
  onSelesai,
}: {
  hasil: ApiKeyBaru;
  onSelesai: () => void;
}) {
  const [sudahDisimpan, setSudahDisimpan] = React.useState(false);
  const [tersalin, setTersalin] = React.useState(false);
  const konfirmasiId = React.useId();

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(hasil.key);
      setTersalin(true);
    } catch {
      // Clipboard bisa ditolak browser (izin, konteks tidak aman). Jangan
      // diam: key-nya tetap terlihat dan bisa diblok lalu disalin manual.
      toast.error(
        "Browser menolak menyalin otomatis. Blok teks key-nya lalu salin sendiri.",
      );
    }
  };

  return (
    <AlertDialog open={hasil !== null}>
      <AlertDialogContent
        className="sm:max-w-xl"
        // Escape tidak menutup: satu tekan tombol yang salah tidak boleh
        // menghapus satu-satunya salinan key ini.
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {TERMS.apiKey} untuk «{hasil.apiKey.nama_konsumen}» berhasil
            dibuat
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 font-medium text-foreground">
                Salin key ini sekarang. Ini satu-satunya kali key-nya
                ditampilkan — yang tersimpan hanya sidik SHA-256-nya, dan tidak
                ada cara mengembalikan key dari sidik itu. Kalau hilang, satu-
                satunya jalan adalah membuat key baru dan memasangnya lagi di{" "}
                {TERMS.konsumen}.
              </p>

              <div className="space-y-2">
                <code className="block select-all break-all rounded-md border bg-muted p-3 font-mono text-sm text-foreground">
                  {hasil.key}
                </code>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={salin}>
                    {tersalin ? "Tersalin" : "Salin key"}
                  </Button>
                  <span className="text-xs" aria-live="polite">
                    {tersalin
                      ? "Key sudah ada di papan klip. Tempel ke konfigurasi Konsumen sekarang."
                      : ""}
                  </span>
                </div>
              </div>

              <p className="text-xs">
                {TERMS.konsumen} memakainya sebagai header{" "}
                <code>Authorization: Bearer {hasil.apiKey.key_prefix}…</code>.
                Yang tetap bisa dilihat di daftar hanya delapan karakter
                pertama itu, untuk mencocokkan key mana yang dipasang di mana.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center gap-2">
          <Checkbox
            id={konfirmasiId}
            checked={sudahDisimpan}
            onCheckedChange={(checked) => setSudahDisimpan(checked === true)}
          />
          <Label htmlFor={konfirmasiId} className="cursor-pointer font-normal">
            Saya sudah menyimpan key ini di tempat yang aman.
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction disabled={!sudahDisimpan} onClick={onSelesai}>
            Tutup
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ApiKeyTable;
