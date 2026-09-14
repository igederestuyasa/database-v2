import type { Metadata } from "next";

import { isAdmin } from "@/lib/actions/_guard";
import { listAllJabatan } from "@/lib/db/jabatan";
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
  // Semua baris sekaligus, aktif maupun nonaktif: jumlah Jabatan hanya ratusan,
  // dan daftar utuh itu juga yang menjadi calon tujuan Merge — filter di layar
  // tidak boleh membuat sebuah Jabatan hilang dari pilihan.
  const [rows, admin] = await Promise.all([
    listAllJabatan(client, { status: "semua" }),
    isAdmin(),
  ]);

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

      <JabatanTable rows={rows} status={status} isAdmin={admin} />
    </div>
  );
}
