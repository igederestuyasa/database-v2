import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Log Perubahan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Log Perubahan"}
      keterangan={"Semua Batch perubahan. Admin bisa mengembalikan satu Batch utuh."}
      fitur={[16]}
    />
  );
}
