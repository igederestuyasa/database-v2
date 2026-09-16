import type { Metadata } from "next";
import Link from "next/link";

import Info from "@/components/hc/Info";
import Tombol from "@/components/hc/Tombol";
import HanyaAdmin from "@/components/shared/HanyaAdmin";
import { requirePageSession } from "@/lib/auth/session";
import { countEmployees } from "@/lib/db/employees";
import { TERMS } from "@/lib/i18n/terms";

import { bacaAman } from "../../_lib/bacaAman";

import SeedWizard from "./_components/SeedWizard";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Seed awal" };

/**
 * Seed awal lewat web (PRD #23, ADR-008).
 *
 * Admin saja, diperiksa dua kali sebelum database disentuh: di sini (supaya
 * seorang viewer membaca kalimat yang jelas) dan lagi di dalam
 * `jalankanSeed()` — dan sekali lagi di SQL, `assert_admin()` sebagai statement
 * pertama `seed_from_payload()`, plus RLS di setiap tabel yang ditulisnya.
 *
 * Halaman ini hanya berguna selama tabel Karyawan kosong. Sesudahnya ia tidak
 * hilang — ia mengatakan Seed sudah berjalan dan menunjuk ke Log Perubahan,
 * karena itulah tempat membatalkannya.
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/karyawan/seed");

  if (user.role !== "admin") {
    return (
      <HanyaAdmin
        judul={`${TERMS.seed} awal`}
        alasan={`${TERMS.seed} menulis ribuan baris sekaligus, jadi hanya ${TERMS.admin} yang bisa menjalankannya.`}
        labelKembali={`Kembali ke daftar ${TERMS.karyawan}`}
      />
    );
  }

  const jumlah = await bacaAman("karyawan/seed", "menghitung Karyawan", () =>
    countEmployees(client),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-3 pt-6">
        <p className="text-pendukung text-muted-foreground">
          <Link
            href="/karyawan"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            &larr; {TERMS.karyawan}
          </Link>
        </p>
        <div className="flex items-center gap-2">
          <h1 className="text-balance text-judul-halaman text-foreground">
            {TERMS.seed} awal dari Excel
          </h1>
          <Info label={`Keterangan ${TERMS.seed} awal`}>
            Pemasukan data awal dari workbook &laquo;Demografi Karyawan -
            Posisi&raquo;, <strong>sekali jalan</strong>. Data masuk apa adanya,
            termasuk varian nama yang kotor; membereskannya lewat halaman{" "}
            {TERMS.perluDibereskan}, bukan lewat Excel.
          </Info>
        </div>
      </header>

      {jumlah === undefined ? (
        <div
          role="alert"
          className="hc-permukaan rounded-kartu border border-destructive/40 bg-destructive/5 p-4 text-pendukung"
        >
          <p className="text-label text-foreground">
            Tidak bisa memastikan tabel {TERMS.karyawan} kosong.
          </p>
          <p className="mt-1 text-muted-foreground">
            Muat ulang halaman ini. Kalau tetap gagal, laporkan; {TERMS.seed}{" "}
            tidak ditawarkan sampai hitungannya terbaca.
          </p>
        </div>
      ) : jumlah > 0 ? (
        <div className="hc-permukaan rounded-kartu border border-border bg-card p-4 text-pendukung">
          <p className="text-label text-foreground">
            {TERMS.seed} sudah dijalankan: ada {jumlah} {TERMS.karyawan} di
            database.
          </p>
          <p className="mt-1 text-muted-foreground">
            {TERMS.seed} hanya berjalan sekali. Kalau hasilnya salah, buka Log
            Perubahan, cari {TERMS.batch} jenis {TERMS.seed}, dan kembalikan
            seluruhnya; setelah itu pun {TERMS.seed} ulang adalah pekerjaan
            teknis, karena data yang dikembalikan tidak dihapus.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Tombol asChild nada="sekunder">
              <Link href="/log?jenis=seed">Buka Log Perubahan</Link>
            </Tombol>
            <Tombol asChild nada="sekunder">
              <Link href="/karyawan">Daftar {TERMS.karyawan}</Link>
            </Tombol>
          </div>
        </div>
      ) : (
        <SeedWizard />
      )}
    </div>
  );
}
