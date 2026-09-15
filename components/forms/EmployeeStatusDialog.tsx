"use client";

/**
 * Nonaktifkan / aktifkan kembali seorang Karyawan (PRD #5).
 *
 * **Tidak pernah menghapus.** Tidak ada DELETE ke tabel data di HC Core
 * (ARCHITECTURE.md §6): Karyawan yang keluar ditandai `status = 'nonaktif'`
 * beserta `tanggal_keluar`, barisnya tetap ada selamanya, dan Revisi lama
 * maupun Konsumen yang menyimpan id-nya tetap bisa diselesaikan. Karena itu
 * tombolnya berbunyi "Nonaktifkan", bukan "Hapus", dan jalan kembalinya
 * (Aktifkan kembali) selalu ada di layar yang sama.
 *
 * Tanggal keluar **wajib** di sini, meski kolomnya nullable. PRD #5 berbunyi
 * "menandai karyawan sebagai nonaktif **beserta tanggal keluar**", dan tanpa
 * tanggal itu seorang Karyawan nonaktif tidak bisa dibedakan dari data seed
 * yang memang kotor. Aturannya ditegakkan `employeeDeactivateSchema` — schema
 * beku yang sama yang dipakai Server Action-nya.
 *
 * Dialog yang sama juga dipakai untuk **memperbaiki** tanggal keluar yang
 * salah ketik: menjalankannya ulang pada Karyawan yang sudah nonaktif hanya
 * menggeser tanggalnya, tanpa perlu mengaktifkan orangnya kembali dulu.
 *
 * **Dialog ini hanya menyentuh `status` dan `tanggal_keluar`** — dua kolom
 * yang justru TIDAK ada di `EmployeeForm`, sehingga kedua form di halaman
 * Ubah Karyawan tidak pernah menulis kolom yang sama. Itu bukan kerapian
 * belaka: keduanya terpasang bersamaan, dan `EmployeeForm` memuat nilai
 * awalnya sekali saja saat pertama dipasang. Kalau dialog ini ikut menulis
 * `keterangan`, isian form di bawah yang sudah telanjur memegang versi lama
 * akan menuliskannya kembali pada penyimpanan berikutnya — catatan yang baru
 * saja dibuat lenyap, di dalam Batch yang terlihat seperti edit biasa.
 * `employeeDeactivateSchema` memang mengizinkan `keterangan`; yang dikirim ke
 * sana dari sini selalu nilai yang sekarang, jadi tidak pernah masuk patch.
 */
import * as React from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { deactivateEmployee, reactivateEmployee } from "@/lib/actions/employees";
import { today } from "@/lib/derived";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { formatZodErrors } from "@/lib/validation/common";
import { employeeDeactivateSchema } from "@/lib/validation/employee";

export type EmployeeStatusDialogProps = {
  employee: {
    id: string;
    full_name: string;
    status: string;
    tanggal_keluar: string | null;
    keterangan: string | null;
  };
};

/** `YYYY-MM-DD` untuk hari ini menurut jam pengguna, bukan menurut UTC. */
function hariIni(): string {
  const { year, month, day } = today();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Panggilan Server Action yang ditolak — bukan tulisan yang gagal, melainkan
 * permintaan yang tidak pernah sampai.
 *
 * Dijawab dalam bentuk yang sama dengan `ActionResult` yang gagal supaya
 * pemanggilnya tidak perlu membedakan keduanya, dan supaya tidak ada janji
 * yang ditolak tanpa penanganan.
 */
function gagalMemanggil(error: unknown) {
  console.error("[EmployeeStatusDialog] panggilan Server Action ditolak", error);
  return {
    ok: false as const,
    error: {
      code: "GAGAL" as const,
      message:
        "Perubahan tidak terkirim — jaringan atau server sedang bermasalah. Coba lagi; kalau tetap gagal, muat ulang halaman dulu untuk melihat status yang sebenarnya.",
    },
  };
}

export function EmployeeStatusDialog({ employee }: EmployeeStatusDialogProps) {
  const router = useRouter();
  const nonaktif = employee.status === "nonaktif";

  const [dialogKeluar, setDialogKeluar] = React.useState(false);
  const [dialogAktif, setDialogAktif] = React.useState(false);
  const [sedangMenyimpan, setSedangMenyimpan] = React.useState(false);

  const [tanggalKeluar, setTanggalKeluar] = React.useState("");
  const [pesanKesalahan, setPesanKesalahan] = React.useState<string | null>(null);

  const bukaDialogKeluar = () => {
    // Tanggal keluar yang sudah ada dipakai apa adanya supaya "perbaiki
    // tanggal" tidak diam-diam menggantinya dengan hari ini; yang belum punya
    // diberi hari ini sebagai tebakan yang paling sering benar.
    setTanggalKeluar(employee.tanggal_keluar ?? hariIni());
    setPesanKesalahan(null);
    setDialogKeluar(true);
  };

  const simpanNonaktif = async () => {
    const input = {
      id: employee.id,
      tanggal_keluar: tanggalKeluar,
      // Nilai yang sekarang, bukan `null`: schema-nya menuntut kolom ini
      // hadir, dan `null` berarti "kosongkan". Karena sama dengan yang di
      // database, ia tidak pernah masuk patch — lihat catatan di atas.
      keterangan: employee.keterangan,
    };

    // Schema beku yang sama dengan yang dipakai Server Action-nya
    // (ARCHITECTURE.md §1) — satu aturan, dua tempat.
    const parsed = employeeDeactivateSchema.safeParse(input);
    if (!parsed.success) {
      // Pesan per-field, bukan `messages[0]`: yang terakhir itu diawali nama
      // kolomnya ("tanggal_keluar: …"), yang berguna di log dan janggal di
      // layar staf HC.
      const { fieldErrors, messages } = formatZodErrors(parsed.error);
      setPesanKesalahan(
        fieldErrors.tanggal_keluar ??
          messages[0] ??
          "Tanggal keluar wajib diisi lengkap sebelum Karyawan dinonaktifkan.",
      );
      return;
    }

    setSedangMenyimpan(true);
    // `finally`, bukan sekadar baris sesudahnya: Server Action mengembalikan
    // kegagalan alih-alih melempar, tapi PANGGILANNYA tetap bisa ditolak
    // (koneksi putus, deploy di tengah jalan). Tanpa ini, penolakan semacam
    // itu meninggalkan dialog terkunci di "Menyimpan…" dengan tombol Batal
    // ikut mati, dan pemakainya tidak tahu tulisannya jadi atau tidak.
    const result = await deactivateEmployee(input)
      .catch(gagalMemanggil)
      .finally(() => setSedangMenyimpan(false));

    if (!result.ok) {
      setPesanKesalahan(result.error.message);
      return;
    }

    toast.success(
      nonaktif
        ? `Tanggal keluar "${result.data.full_name}" diperbarui.`
        : `${TERMS.karyawan} "${result.data.full_name}" ditandai nonaktif.`,
    );
    setDialogKeluar(false);
    router.refresh();
  };

  const simpanAktif = async () => {
    setSedangMenyimpan(true);
    // Keterangan dikirim apa adanya, bukan `null`: `employeeReactivateSchema`
    // menuntut kolomnya hadir, dan `null` di sana berarti "kosongkan" — yang
    // akan menghapus catatan yang tidak ada hubungannya dengan pengaktifan
    // ini. Nilai yang sama dengan sekarang tidak masuk patch sama sekali.
    const result = await reactivateEmployee({
      id: employee.id,
      keterangan: employee.keterangan,
    })
      .catch(gagalMemanggil)
      .finally(() => setSedangMenyimpan(false));

    if (!result.ok) {
      setPesanKesalahan(result.error.message);
      return;
    }

    toast.success(`${TERMS.karyawan} "${result.data.full_name}" diaktifkan kembali.`);
    setDialogAktif(false);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={nonaktif ? "outline" : "secondary"}>
          {STATUS_LABELS[nonaktif ? "nonaktif" : "aktif"]}
        </Badge>
        {employee.tanggal_keluar ? (
          <span className="text-sm text-muted-foreground">
            Tanggal keluar: {employee.tanggal_keluar}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {nonaktif ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPesanKesalahan(null);
                setDialogAktif(true);
              }}
            >
              {UI.aktifkan} kembali
            </Button>
            <Button type="button" variant="ghost" onClick={bukaDialogKeluar}>
              Perbaiki tanggal keluar
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={bukaDialogKeluar}>
            {UI.nonaktifkan}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {TERMS.karyawan} tidak pernah dihapus. Menonaktifkan hanya mengubah
        status dan mengisi tanggal keluar; seluruh datanya, {TERMS.revisi}-nya,
        dan id-nya tetap utuh — termasuk untuk {TERMS.konsumen} yang sudah
        menyimpannya.
      </p>

      {/* Nonaktifkan / perbaiki tanggal keluar */}
      <AlertDialog
        open={dialogKeluar}
        onOpenChange={(open) => {
          if (!open && !sedangMenyimpan) setDialogKeluar(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {nonaktif
                ? `Perbaiki tanggal keluar ${employee.full_name}?`
                : `${UI.nonaktifkan} ${employee.full_name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {nonaktif
                ? `${TERMS.karyawan} ini sudah nonaktif; yang berubah hanya tanggal keluarnya.`
                : `${TERMS.karyawan} ini akan hilang dari daftar aktif, tetapi datanya tidak dihapus dan bisa diaktifkan kembali kapan saja.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tanggal-keluar">Tanggal Keluar</Label>
              <Input
                id="tanggal-keluar"
                type="date"
                value={tanggalKeluar}
                onChange={(event) => setTanggalKeluar(event.currentTarget.value)}
              />
              <p className="text-xs text-muted-foreground">
                Wajib diisi lengkap. Tanpa tanggal keluar, {TERMS.karyawan}{" "}
                nonaktif tidak bisa dibedakan dari data yang belum dibereskan.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Yang berubah hanya status dan tanggal keluar. Kalau alasannya
              perlu dicatat, tulis di kolom Keterangan pada form Ubah{" "}
              {TERMS.karyawan} di bawah — kolom itu milik form tersebut, supaya
              dua layar tidak saling menimpa catatan yang sama.
            </p>

            {pesanKesalahan ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {pesanKesalahan}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={sedangMenyimpan}>{UI.batal}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sedangMenyimpan}
              onClick={(event) => {
                // Dialog ditutup setelah aksinya berhasil, bukan saat diklik —
                // kalau gagal, pesannya harus terbaca di tempat yang sama.
                event.preventDefault();
                void simpanNonaktif();
              }}
            >
              {sedangMenyimpan
                ? "Menyimpan…"
                : nonaktif
                  ? "Simpan tanggal keluar"
                  : UI.nonaktifkan}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aktifkan kembali */}
      <AlertDialog
        open={dialogAktif}
        onOpenChange={(open) => {
          if (!open && !sedangMenyimpan) setDialogAktif(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {UI.aktifkan} kembali {employee.full_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Statusnya kembali menjadi Aktif dan tanggal keluarnya dikosongkan,
              karena seseorang yang aktif tidak punya tanggal keluar. Perubahan
              ini tercatat sebagai {TERMS.revisi} baru dan bisa dikembalikan
              lewat Log Perubahan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pesanKesalahan ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {pesanKesalahan}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={sedangMenyimpan}>{UI.batal}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sedangMenyimpan}
              onClick={(event) => {
                event.preventDefault();
                void simpanAktif();
              }}
            >
              {sedangMenyimpan ? "Menyimpan…" : `${UI.aktifkan} kembali`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default EmployeeStatusDialog;
