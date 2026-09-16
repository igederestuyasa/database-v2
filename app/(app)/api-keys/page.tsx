import type { Metadata } from "next";
import Link from "next/link";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import DaftarTerpotongAlert from "@/components/shared/DaftarTerpotongAlert";
import HanyaAdmin from "@/components/shared/HanyaAdmin";
import { requirePageSession } from "@/lib/auth/session";
import { listApiKeys } from "@/lib/db/apiKeys";
import { NAV_LABELS, TERMS } from "@/lib/i18n/terms";

import { ApiKeyTable, type ApiKeyRow } from "./_components/ApiKeyTable";

// Live data only — never prerendered at build time. See ADR-005 §6.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "API Key" };

/**
 * Satu halaman memuat seluruh daftar key.
 *
 * Konsumen HC Core dihitung dengan jari — aplikasi perf/KPI, survei EMX-EE,
 * WLA (ADR-004) — jadi 200 baris adalah kelonggaran yang besar, bukan batas
 * yang akan tersentuh. Kalau toh tersentuh, halaman ini mengatakannya
 * daripada diam-diam memendekkan daftar (lihat `terpotong` di bawah).
 */
const PER_PAGE = 200;

/**
 * API Key — kredensial per Konsumen, beserta kolom yang boleh diambilnya
 * (PRD #19).
 *
 * Admin saja, dijaga berlapis: `middleware.ts` menuntut sesi,
 * `requirePageSession()` membaca ulang user yang terverifikasi di sini, dan
 * RLS `api_keys_select` hanya melepas barisnya untuk admin — seorang viewer
 * yang lolos dua lapis pertama tetap melihat tabel kosong. Pesan di bawah ada
 * supaya ia membaca alasannya, bukan menyimpulkan datanya hilang.
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/api-keys");

  if (user.role !== "admin") {
    return (
      <HanyaAdmin
        judul={NAV_LABELS["api-keys"]}
        alasan={`Halaman ini memuat kredensial ${TERMS.konsumen}, jadi hanya ${TERMS.admin} yang bisa membukanya.`}
      />
    );
  }

  const { rows: keys, total } = await listApiKeys(client, {
    status: "semua",
    perPage: PER_PAGE,
  });

  /**
   * Tanggal diformat DI SINI, di Server Component, dan yang menyeberang ke
   * klien hanya string jadi.
   *
   * Dua alasan. Pertama, `formatWaktu()` mengunci zona waktu ke Asia/Jakarta,
   * jadi angka yang sama muncul di server dan di browser dan React tidak
   * melaporkan hydration mismatch. Kedua, pemetaan baris seperti ini memang
   * tempatnya di modul yang BUKAN `"use client"`: sebuah mapper yang dipanggil
   * Server Component dari file client hanya gagal saat build produksi.
   */
  const rows: ApiKeyRow[] = keys.map((key) => ({
    id: key.id,
    nama_konsumen: key.nama_konsumen,
    key_prefix: key.key_prefix,
    allowed_fields: key.allowed_fields,
    status: key.status === "aktif" ? "aktif" : "nonaktif",
    dibuat: formatWaktu(key.created_at),
    terakhirDipakai: key.last_used_at ? formatWaktu(key.last_used_at) : null,
  }));

  /**
   * Apakah daftar ini utuh?
   *
   * Dua sebab bisa memendekkannya, dan halaman ini tidak perlu membedakannya:
   * jendela `PER_PAGE` miliknya sendiri, dan `db-max-rows` milik PostgREST
   * (bawaan 1000) yang memotong DULUAN dan melaporkannya sebagai sukses.
   * Yang penting sama di kedua kasus: baris yang tidak termuat tidak bisa
   * diubah atau dinonaktifkan dari sini, jadi katakan, jangan diamkan.
   */
  const terpotong = rows.length < total;

  // Dihitung dari baris yang benar-benar dimuat. Kalau daftarnya terpotong,
  // angka ini bukan jumlah key aktif di database — karena itu kalimat di
  // bawah menyebut "dari yang dimuat", bukan menempelkannya ke `total`.
  const jumlahAktif = rows.filter((row) => row.status === "aktif").length;

  return (
    <ApiKeyTable
      rows={rows}
      peringatan={
        <DaftarTerpotongAlert
          daftar={terpotong ? [{ nama: TERMS.apiKey, dibaca: rows.length, total }] : []}
          keterangan={`Halaman ini juga mengambil paling banyak ${PER_PAGE} baris sekali jalan. Sisanya tidak bisa diubah atau dinonaktifkan dari sini, dan jangan menyimpulkan sebuah key sudah tidak ada karena tidak terlihat di daftar ini.`}
        />
      }
      catatan={
        <p className="max-w-subjudul text-pendukung text-muted-foreground">
          {terpotong
            ? `${total} ${TERMS.apiKey}; dari ${rows.length} yang dimuat di halaman ini, ${jumlahAktif} aktif.`
            : `${total} ${TERMS.apiKey}, ${jumlahAktif} di antaranya aktif.`}{" "}
          {TERMS.konsumen} memakainya sebagai header{" "}
          <code className="font-mono text-mikro font-normal">
            Authorization: Bearer hck_…
          </code>
          . Key penuh hanya ditampilkan sekali saat dibuat dan tidak bisa
          dilihat lagi — yang tersimpan hanya sidik SHA-256-nya. Setiap
          perubahan di halaman ini tercatat sebagai {TERMS.revisi} dan bisa
          dikembalikan lewat{" "}
          <Link href="/log" className="underline underline-offset-4 hover:text-foreground">
            {NAV_LABELS.log}
          </Link>
          .
        </p>
      }
    />
  );
}
