import type { Metadata } from "next";

import DaftarTerpotongAlert from "@/components/shared/DaftarTerpotongAlert";
import { requirePageSession } from "@/lib/auth/session";
import { listAllJabatan } from "@/lib/db/jabatan";
import { terpotongDari } from "@/lib/db/shared";
import { TERMS } from "@/lib/i18n/terms";

import JabatanTable from "./_components/JabatanTable";
import { bacaStatusFilter } from "./_components/statusFilter";

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

  // Pintu yang sama dengan halaman lain. Dulu halaman ini tidak memeriksa sesi
  // dan mengandalkan middleware plus RLS — yang untuk tamu berarti daftar
  // kosong, bukan halaman login.
  const { client, user } = await requirePageSession("/jabatan");
  const admin = user.role === "admin";

  // Semua baris sekaligus, aktif maupun nonaktif: jumlah Jabatan hanya
  // ratusan, dan daftar utuh itu juga yang menjadi calon tujuan Merge —
  // filter di layar tidak boleh membuat sebuah Jabatan hilang dari pilihan.
  const daftar = await listAllJabatan(client, { status: "semua" });
  const { rows } = daftar;

  return (
    <JabatanTable
      rows={rows}
      status={status}
      isAdmin={admin}
      peringatan={
        /* `listAllJabatan()` asks for `count: "exact"` on the same query and
           reports `truncated` from it — a daftar calon tujuan Merge that is
           quietly short is the one thing this page must never present as
           whole. */
        <DaftarTerpotongAlert
          daftar={terpotongDari(TERMS.jabatan, daftar)}
          keterangan="Pencarian, filter, dan terutama daftar tujuan Gabungkan di halaman ini ikut tidak lengkap — jangan memakainya untuk memutuskan Merge sampai batas itu dinaikkan atau daftarnya dibuat berhalaman."
        />
      }
    />
  );
}
