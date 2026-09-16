import type { Metadata } from "next";
import Link from "next/link";

import Info from "@/components/hc/Info";
import HanyaAdmin from "@/components/shared/HanyaAdmin";
import { requirePageSession } from "@/lib/auth/session";
import { listPersonnelNumbers } from "@/lib/db/employees";
import { TERMS } from "@/lib/i18n/terms";

import { bacaAman } from "../../_lib/bacaAman";

import ImporWizard from "./_components/ImporWizard";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Impor Karyawan" };

/**
 * Impor Karyawan dari Excel (PRD #24, ADR-009).
 *
 * Halaman ini menggantikan "Seed awal", dan bedanya cuma satu tapi menentukan:
 * ia boleh dijalankan BERULANG. Personnel Number adalah kuncinya — yang belum
 * ada ditambah, yang sudah ada diperbarui pada kolom yang berubah, dan sel
 * Excel yang kosong tidak pernah mengosongkan isi yang sudah ada. Karena itu
 * tidak ada lagi jalan buntu "Seed sudah dijalankan": tabel yang sudah berisi
 * adalah keadaan NORMAL halaman ini, bukan alasan menolak.
 *
 * Admin saja, diperiksa berlapis seperti sebelumnya: di sini (supaya seorang
 * viewer membaca kalimat yang jelas), lagi di dalam `jalankanImpor()`, sekali
 * lagi di SQL lewat `assert_admin()` sebagai statement pertama
 * `import_from_payload()`, plus RLS di setiap tabel yang ditulisnya.
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/karyawan/impor");

  if (user.role !== "admin") {
    return (
      <HanyaAdmin
        judul={`${TERMS.impor} ${TERMS.karyawan}`}
        alasan={`${TERMS.impor} menulis ribuan baris sekaligus, jadi hanya ${TERMS.admin} yang bisa menjalankannya.`}
        labelKembali={`Kembali ke daftar ${TERMS.karyawan}`}
      />
    );
  }

  /**
   * Personnel Number yang sudah ada, supaya pratinjau bisa memisahkan "baru"
   * dari "sudah terdaftar" sebelum apa pun ditulis.
   *
   * Lewat `bacaAman()`: kalau pembacaan ini gagal, {TERMS.impor} TETAP boleh
   * jalan — database yang memutuskan baris mana yang ditambah dan mana yang
   * diperbarui, bukan daftar ini. Yang hilang hanya satu baris angka di
   * pratinjau, dan itu bukan alasan menutup halamannya.
   */
  const personnelNumbers = await bacaAman(
    "karyawan/impor",
    "membaca daftar Personnel Number",
    () => listPersonnelNumbers(client),
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
            {TERMS.impor} {TERMS.karyawan} dari Excel
          </h1>
          <Info label={`Keterangan ${TERMS.impor}`}>
            Boleh dijalankan berkali-kali. <strong>Personnel Number</strong>{" "}
            adalah kuncinya: nomor yang belum ada ditambah, yang sudah ada
            diperbarui pada kolom yang berubah. Kolom yang Anda kosongkan di
            Excel <strong>tidak</strong> mengosongkan data yang sudah ada —
            untuk itu pakai form Ubah {TERMS.karyawan}. Data masuk apa adanya,
            termasuk varian nama yang kotor; membereskannya lewat halaman{" "}
            {TERMS.perluDibereskan}.
          </Info>
        </div>
      </header>

      {personnelNumbers === undefined ? (
        <div
          role="status"
          className="hc-permukaan rounded-kartu border border-border bg-card p-4 text-pendukung"
        >
          <p className="text-label text-foreground">
            Daftar Personnel Number yang sudah ada gagal dibaca.
          </p>
          <p className="mt-1 text-muted-foreground">
            {TERMS.impor} tetap bisa dijalankan — database yang memutuskan mana
            yang ditambah dan mana yang diperbarui. Yang hilang hanya angka
            &laquo;baru vs sudah terdaftar&raquo; di pratinjau.
          </p>
        </div>
      ) : null}

      <ImporWizard personnelNumbers={personnelNumbers ?? []} />
    </div>
  );
}
