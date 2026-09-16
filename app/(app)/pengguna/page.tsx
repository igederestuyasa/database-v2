import type { Metadata } from "next";

import HanyaAdmin from "@/components/shared/HanyaAdmin";
import { requirePageSession } from "@/lib/auth/session";
import { countAdmins, listProfiles } from "@/lib/db/profiles";
import { NAV_LABELS, TERMS } from "@/lib/i18n/terms";

import { PenggunaTable, type PenggunaRow } from "./_components/PenggunaTable";

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
      <HanyaAdmin
        judul={NAV_LABELS.pengguna}
        alasan={`Pengaturan role hanya bisa dilakukan ${TERMS.admin}.`}
      />
    );
  }

  const [{ rows: profiles, total }, jumlahAdmin] = await Promise.all([
    listProfiles(client),
    countAdmins(client),
  ]);

  const rows: PenggunaRow[] = profiles.map((profile) => ({
    id: profile.id,
    email: profile.email,
    role: profile.role,
    dibuat: formatTanggal(profile.created_at),
  }));

  // PostgREST caps a read at `db-max-rows` (1000 by default) without saying so,
  // so the table can hold fewer rows than the count. Say it rather than let the
  // two numbers disagree silently.
  const terpotong = rows.length < total;

  return (
    <div className="space-y-6">
      <header className="space-y-3 pt-6">
        <h1 className="text-balance text-judul-halaman text-foreground">
          {NAV_LABELS.pengguna}
        </h1>
        <p className="max-w-subjudul text-subjudul text-muted-foreground">
          {TERMS.admin} boleh mengubah apa pun dan melihat{" "}
          {TERMS.dataPribadiSensitif}; {TERMS.viewer} hanya membaca. Setiap
          perubahan role tercatat sebagai {TERMS.revisi} dan bisa dikembalikan
          lewat {NAV_LABELS.log}.
        </p>
      </header>

      <PenggunaTable rows={rows} currentUserId={user.id} />

      <p className="max-w-subjudul text-pendukung text-muted-foreground">
        {total} pengguna, {jumlahAdmin} di antaranya {TERMS.admin}. Akun baru
        selalu mulai sebagai {TERMS.viewer}; naikkan di sini kalau perlu.
        {terpotong
          ? ` Tabel di atas menampilkan ${rows.length} yang pertama.`
          : ""}
      </p>
    </div>
  );
}

function formatTanggal(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : TANGGAL.format(parsed);
}
