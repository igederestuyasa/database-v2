import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ubah Karyawan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Ubah Karyawan"}
      keterangan={"Form ubah data seorang Karyawan, termasuk menandai nonaktif beserta tanggal keluar."}
      fitur={[4, 5]}
    />
  );
}
