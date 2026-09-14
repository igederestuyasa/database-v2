import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tambah Karyawan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Tambah Karyawan"}
      keterangan={"Form tambah Karyawan baru. Kolom referensi dipilih dari daftar, tidak diketik bebas."}
      fitur={[3]}
    />
  );
}
