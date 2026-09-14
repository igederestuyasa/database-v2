import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Detail Karyawan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Detail Karyawan"}
      keterangan={"Data lengkap seorang Karyawan, kolom turunan, dan Riwayat Revisi-nya."}
      fitur={[6, 14, 15, 22]}
    />
  );
}
