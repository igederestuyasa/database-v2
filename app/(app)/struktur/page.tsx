import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Struktur Organisasi" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Struktur Organisasi"}
      keterangan={"Pohon Unit Organisasi berkode, beserta CRUD dan Merge dua unit menjadi satu."}
      fitur={[7, 10]}
    />
  );
}
