import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Master Data" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Master Data"}
      keterangan={"Semua tipe Lookup, satu tab per tipe, beserta CRUD dan Merge."}
      fitur={[9, 10]}
    />
  );
}
