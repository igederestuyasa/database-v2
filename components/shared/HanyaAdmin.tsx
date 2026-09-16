import Link from "next/link";

import Info from "@/components/hc/Info";
import Tombol from "@/components/hc/Tombol";
import { TERMS, UI } from "@/lib/i18n/terms";

/**
 * Halaman yang hanya boleh dibuka admin, dilihat oleh viewer.
 *
 * Empat halaman menampilkan hal yang sama — Karyawan baru, Ubah Karyawan, API
 * Key, dan Pengguna — dan sebelumnya keempatnya menulis sendiri blok yang
 * nyaris identik. Satu di sini supaya kalimatnya tidak pelan-pelan berbeda
 * empat versi.
 *
 * INI BUKAN PENJAGA AKSES. Yang menolak viewer adalah RLS dan pemeriksaan role
 * di Server Action; komponen ini hanya menjelaskan kenapa halamannya kosong dan
 * ke mana harus pergi.
 */
export default function HanyaAdmin({
  judul,
  alasan,
  kembaliKe = "/karyawan",
  labelKembali,
}: {
  judul: string;
  /** Kenapa halaman ini admin saja, dalam satu kalimat. */
  alasan: string;
  kembaliKe?: string;
  labelKembali?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12">
      <div className="flex items-center gap-2">
        <h1 className="text-balance text-judul-halaman text-foreground">{judul}</h1>
        <Info label="Kenapa halaman ini tidak bisa dibuka">
          Anda masuk sebagai {TERMS.viewer}. {alasan}
        </Info>
      </div>
      <p className="text-subjudul text-muted-foreground">{UI.hanyaAdmin}</p>
      <Tombol asChild>
        <Link href={kembaliKe}>{labelKembali ?? `Kembali ke ${TERMS.karyawan}`}</Link>
      </Tombol>
    </div>
  );
}
