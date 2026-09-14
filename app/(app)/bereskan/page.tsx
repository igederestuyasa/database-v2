import type { Metadata } from "next";

import PagePlaceholder from "@/components/PagePlaceholder";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Perlu Dibereskan" };

export default function Page() {
  return (
    <PagePlaceholder
      judul={"Perlu Dibereskan"}
      keterangan={"Temuan data kotor: nama mirip, Unit Organisasi tanpa induk, Karyawan tanpa unit atau Jabatan, sub bagian senama induknya."}
      fitur={[11, 12]}
    />
  );
}
