import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/lib/auth/session";
import { countEmployees } from "@/lib/db/employees";
import { TERMS, UI } from "@/lib/i18n/terms";

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
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{TERMS.seed} awal</h1>
        <p className="mt-2 text-sm text-muted-foreground">{UI.hanyaAdmin}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda masuk sebagai {TERMS.viewer}, jadi hanya bisa membaca data{" "}
          {TERMS.karyawan}.
        </p>
        <Button asChild className="mt-6">
          <Link href="/karyawan">Kembali ke daftar {TERMS.karyawan}</Link>
        </Button>
      </div>
    );
  }

  const jumlah = await bacaAman("karyawan/seed", "menghitung Karyawan", () =>
    countEmployees(client),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/karyawan" className="hover:underline">
            &larr; {TERMS.karyawan}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{TERMS.seed} awal dari Excel</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pemasukan data awal dari workbook &laquo;Demografi Karyawan -
          Posisi&raquo;, <strong>sekali jalan</strong>. Data masuk apa adanya,
          termasuk varian nama yang kotor; membereskannya lewat halaman{" "}
          {TERMS.perluDibereskan}, bukan lewat Excel.
        </p>
      </header>

      {jumlah === undefined ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">Tidak bisa memastikan tabel {TERMS.karyawan} kosong.</p>
          <p className="mt-1 text-muted-foreground">
            Muat ulang halaman ini. Kalau tetap gagal, laporkan; {TERMS.seed}{" "}
            tidak ditawarkan sampai hitungannya terbaca.
          </p>
        </div>
      ) : jumlah > 0 ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          <p className="font-medium">
            {TERMS.seed} sudah dijalankan: ada {jumlah} {TERMS.karyawan} di database.
          </p>
          <p className="mt-1 text-muted-foreground">
            {TERMS.seed} hanya berjalan sekali. Kalau hasilnya salah, buka Log
            Perubahan, cari {TERMS.batch} jenis {TERMS.seed}, dan kembalikan
            seluruhnya; setelah itu pun {TERMS.seed} ulang adalah pekerjaan
            teknis, karena data yang dikembalikan tidak dihapus.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/log?jenis=seed">Buka Log Perubahan</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/karyawan">Daftar {TERMS.karyawan}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <SeedWizard />
      )}
    </div>
  );
}
