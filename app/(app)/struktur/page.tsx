import type { Metadata } from "next";

import DaftarTerpotongAlert from "@/components/shared/DaftarTerpotongAlert";
import { StrukturClient } from "@/components/struktur/StrukturClient";
import { requirePageSession } from "@/lib/auth/session";
import { NAV_LABELS } from "@/lib/i18n/terms";

import { loadStrukturNodes } from "./_lib/strukturData";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: NAV_LABELS.struktur };

export default async function Page() {
  // Both, not either (CLAUDE.md): this decides what the page offers, and RLS
  // decides what the database will actually do about it.
  const { client, user } = await requirePageSession("/struktur");
  const { nodes, terpotong } = await loadStrukturNodes(client);

  return (
    <StrukturClient
      nodes={nodes}
      isAdmin={user.role === "admin"}
      peringatan={
        <DaftarTerpotongAlert
          daftar={terpotong}
          judul="Pohon ini belum lengkap."
          keterangan="Unit yang induknya ikut terpotong akan tampil seolah-olah tidak punya induk, jadi hierarki di bawah ini bisa keliru — jangan memakainya untuk memutuskan Merge sampai batas itu dinaikkan."
        />
      }
    />
  );
}
