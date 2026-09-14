import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Jabatan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Jabatan"}
      keterangan={"Daftar Jabatan berkode, beserta CRUD dan Merge. Jabatan adalah nama pekerjaan, bukan kursi."}
      fitur={[8, 10]}
    />
  );
}
