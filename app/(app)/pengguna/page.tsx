import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listProfiles } from "@/lib/auth/profiles";
import { requirePageSession } from "@/lib/auth/session";
import { NAV_LABELS, TERMS, UI } from "@/lib/i18n/terms";

import { PenggunaTable, type PenggunaRow } from "./PenggunaTable";

// Live data only — never prerendered at build time. See ADR-005 §6.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pengguna" };

const TANGGAL = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Pengguna — who can open HC Core, and as what (PRD #21).
 *
 * Admin only, checked three times over: `middleware.ts` requires a session,
 * `requirePageSession()` re-reads the verified user here, and RLS narrows
 * `profiles` so a viewer would see nothing but their own row anyway.
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/pengguna");

  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {NAV_LABELS.pengguna}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{UI.hanyaAdmin}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda masuk sebagai {TERMS.viewer}. Minta admin HC Core kalau Anda
          perlu mengatur role pengguna.
        </p>
        <Button asChild className="mt-6">
          <Link href="/karyawan">Kembali ke {TERMS.karyawan}</Link>
        </Button>
      </div>
    );
  }

  const profiles = await listProfiles(client);

  const rows: PenggunaRow[] = profiles.map((profile) => ({
    id: profile.id,
    email: profile.email,
    role: profile.role,
    dibuat: formatTanggal(profile.created_at),
  }));

  const jumlahAdmin = rows.filter((row) => row.role === "admin").length;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {NAV_LABELS.pengguna}
        </h1>
        <p className="text-sm text-muted-foreground">
          {TERMS.admin} boleh mengubah apa pun dan melihat{" "}
          {TERMS.dataPribadiSensitif}; {TERMS.viewer} hanya membaca. Setiap
          perubahan role tercatat sebagai {TERMS.revisi} dan bisa dikembalikan
          lewat {NAV_LABELS.log}.
        </p>
      </header>

      <PenggunaTable rows={rows} currentUserId={user.id} />

      <p className="text-xs text-muted-foreground">
        {rows.length} pengguna, {jumlahAdmin} di antaranya {TERMS.admin}. Akun
        baru selalu mulai sebagai {TERMS.viewer}; naikkan di sini kalau perlu.
      </p>
    </div>
  );
}

function formatTanggal(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : TANGGAL.format(parsed);
}
