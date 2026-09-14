import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Karyawan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Karyawan"}
      keterangan={"Daftar Karyawan dengan pencarian (nama, NIP, Personnel Number) dan filter Unit Organisasi, Jabatan, status, dan Lookup apa pun."}
      fitur={[2]}
    />
  );
}
