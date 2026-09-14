import type { Metadata } from "next";

import { isAdmin } from "@/lib/actions/_guard";
import { listAllJabatan, listJabatan } from "@/lib/db/jabatan";
import { NAV_LABELS, TERMS } from "@/lib/i18n/terms";
import { createClient } from "@/lib/supabase/server";

import JabatanTable from "./JabatanTable";
import { bacaStatusFilter } from "./statusFilter";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Jabatan" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  // `?status=` ada di URL supaya tautan ke daftar nonaktif bisa dibagikan dan
  // bertahan setelah halaman dimuat ulang.
  const status = bacaStatusFilter((await searchParams).status);

  const client = await createClient();
  const [rows, halamanPertama, admin] = await Promise.all([
    // Semua baris sekaligus, aktif maupun nonaktif: jumlah Jabatan hanya
    // ratusan, dan daftar utuh itu juga yang menjadi calon tujuan Merge —
    // filter di layar tidak boleh membuat sebuah Jabatan hilang dari pilihan.
    listAllJabatan(client, { status: "semua" }),
    // Satu baris saja, diambil hanya untuk `total`-nya: `count: "exact"` dari
    // PostgREST dihitung di database dan tidak ikut dipotong batas baris.
    listJabatan(client, { status: "semua", perPage: 1 }),
    isAdmin(),
  ]);

  /**
   * Apakah daftar di atas utuh?
   *
   * PostgREST punya batas `db-max-rows` sendiri (bawaan 1000) yang berlaku
   * SEBELUM `.limit()` milik pemanggil, dan pemotongannya **dilaporkan sebagai
   * sukses**. `listAllJabatan` meminta 5001 baris dan baru mengeluh kalau
   * menerima lebih dari 5000, jadi potongan di angka 1000 lolos tanpa suara:
   * daftarnya pendek, filternya pendek, dan — yang paling berbahaya — daftar
   * calon tujuan Merge ikut pendek tanpa ada yang tahu.
   *
   * Karena itu jumlah baris yang benar-benar diterima dibandingkan dengan
   * hitungan pasti dari database. Kalau kurang, halaman mengatakannya alih-alih
   * memajang daftar yang diam-diam tidak lengkap.
   */
  const totalJabatan = halamanPertama.total;
  const terpotong = rows.length < totalJabatan;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {NAV_LABELS.jabatan}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Nama pekerjaan yang bisa dipegang banyak {TERMS.karyawan} sekaligus.
          Mengganti nama sebuah {TERMS.jabatan} langsung berlaku untuk semua
          pemegangnya. {TERMS.jabatan} bukan {TERMS.formasi}: tidak ada kursi,
          kuota, atau unit di halaman ini.
        </p>
      </header>

      {terpotong ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">Daftar ini belum lengkap.</p>
          <p className="mt-1 text-muted-foreground">
            Baru {rows.length} dari {totalJabatan} {TERMS.jabatan} yang berhasil
            dimuat, karena database membatasi jumlah baris per permintaan.
            Pencarian, filter, dan terutama daftar tujuan Gabungkan di halaman
            ini ikut tidak lengkap — jangan memakainya untuk memutuskan Merge
            sampai batas itu dinaikkan atau daftarnya dibuat berhalaman.
          </p>
        </div>
      ) : null}

      <JabatanTable rows={rows} status={status} isAdmin={admin} />
    </div>
  );
}
