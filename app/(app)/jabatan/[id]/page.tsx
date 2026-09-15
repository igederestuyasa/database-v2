import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import { RIWAYAT_DITAMPILKAN } from "@/components/revisions/riwayat";
import RevisionPanel from "@/components/revisions/RevisionPanel";
import DetailCard from "@/components/shared/DetailCard";
import { Badge } from "@/components/ui/badge";
import { requirePageSession } from "@/lib/auth/session";
import { countEmployeesByJabatan, getJabatanById } from "@/lib/db/jabatan";
import { NAV_LABELS, STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import { isUuid } from "@/lib/validation/uuid";

import { bacaAman } from "../../_lib/bacaAman";
import { bacaRiwayat } from "../../_lib/riwayat";
import { buildJabatanFields, labelStatusJabatan } from "./_components/jabatanDetail";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Detail ${TERMS.jabatan}` };

/**
 * Detail Jabatan — one nama pekerjaan, read-only, with its Riwayat Revisi
 * (PRD #14) and "Kembalikan" for an admin (PRD #15).
 *
 * THREE THINGS THIS PAGE IS CAREFUL ABOUT
 * ---------------------------------------------------------------------------
 *
 * **1. It is read-only, on purpose.** Ubah, Gabungkan and Nonaktifkan live on
 * `/jabatan`, where `JabatanTable` already owns the dialogs and the full list
 * of Jabatan they need as Merge candidates — a list this page would have to
 * read a second time to offer the same thing. The feature this page closes is
 * the Riwayat, not editing, so it links back to the list instead.
 *
 * **2. Jabatan is not Formasi.** No kuota, no unit, no seat (ADR-002). The
 * holder count is here because Merge and Nonaktifkan both turn on it, and it
 * says out loud that many Karyawan may hold one Jabatan.
 *
 * **3. A nonaktif Jabatan renders like any other.** Nothing is ever deleted
 * (PRD §6 Non-Goals); the header marks the status and, when it was the source
 * half of a Merge, names where its holders went.
 */

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Renders the "tidak ditemukan" page, but with HTTP 200 rather than 404:
  // `loading.tsx` here (and on `/jabatan`) flushes the shell before this runs,
  // so the status line is already sent. Measured, deliberate, and explained in
  // docs/adr/ADR-007 — it is NOT caused by `force-dynamic`, and removing that
  // does not change it.
  if (!isUuid(id)) notFound();

  const { client, user } = await requirePageSession(`/jabatan/${id}`);
  const isAdmin = user.role === "admin";

  const jabatan = await getJabatanById(client, id);
  // Either the Jabatan does not exist, or RLS hides it. Both are "tidak
  // ditemukan" for the person looking at the screen.
  if (!jabatan) notFound();

  // Every side read goes through `bacaAman()`: the Jabatan and its Riwayat are
  // the point, the rest is context, and none of it may take the page down.
  const mergedIntoId = jabatan.merged_into_id;
  const [pemegang, tujuan, riwayat] = await Promise.all([
    bacaAman("jabatan/detail", "menghitung pemegang", async () => {
      const [semua, aktif] = await Promise.all([
        countEmployeesByJabatan(client, id, { status: "semua" }),
        countEmployeesByJabatan(client, id, { status: "aktif" }),
      ]);
      return { semua, aktif };
    }),
    mergedIntoId
      ? bacaAman("jabatan/detail", "memuat Jabatan tujuan Merge", () =>
          getJabatanById(client, mergedIntoId),
        )
      : Promise.resolve(null),
    bacaRiwayat(client, "jabatan", id, "jabatan/detail"),
  ]);
  const jumlahPemegang = pemegang ?? null;
  const tujuanMerge = tujuan ?? null;

  const fields = buildJabatanFields({
    jabatan,
    digabungkanKe: tujuanMerge,
    jumlahPemegang,
  });

  const nonaktif = jabatan.status === "nonaktif";

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link
          href="/jabatan"
          className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Kembali ke daftar {NAV_LABELS.jabatan}
        </Link>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {jabatan.nama}
            </h1>
            <Badge variant={nonaktif ? "secondary" : "default"}>
              {labelStatusJabatan(jabatan.status)}
            </Badge>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {jabatan.kode}
          </p>
        </div>

        {nonaktif ? (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              {TERMS.jabatan} ini berstatus{" "}
              {STATUS_LABELS.nonaktif.toLowerCase()}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {jabatan.merged_into_id
                ? `${TERMS.jabatan} ini sudah di-${TERMS.merge} ke ${TERMS.jabatan} lain, jadi pemegangnya sudah pindah ke sana.`
                : `${TERMS.jabatan} ini tidak muncul lagi di daftar pilihan.`}{" "}
              Datanya tetap tersimpan utuh — di HC Core tidak ada data yang
              dihapus, hanya dinonaktifkan.
            </p>
          </div>
        ) : null}
      </header>

      {/* 3/5 + 2/5 rather than 2/3 + 1/3: the Riwayat Revisi panel renders a
          before → after diff, which needs room for two values side by side. */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <DetailCard
            judul={TERMS.jabatan}
            keterangan={`Nama pekerjaan yang bisa dipegang banyak ${TERMS.karyawan} sekaligus. Mengganti namanya berlaku untuk semua pemegangnya — tidak ada satu pun baris ${TERMS.karyawan} yang ikut diubah.`}
            fields={fields}
          />

          <p className="text-xs text-muted-foreground">
            Ditambahkan {formatWaktu(jabatan.created_at)} · Terakhir diubah{" "}
            {formatWaktu(jabatan.updated_at)}. Setiap perubahan tercatat di
            Riwayat Revisi di samping.
            {isAdmin
              ? ` Ubah, Gabungkan dan ${
                  nonaktif ? "Aktifkan" : "Nonaktifkan"
                } ada di halaman ${NAV_LABELS.jabatan}.`
              : ""}
          </p>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {/* PRD #14. `canRevert` only draws the button (PRD #15); the Server
              Action and `assert_admin()` inside the RPC decide whether a revert
              actually happens. A successful revert calls `router.refresh()`,
              so the fields beside it come back with the restored values. */}
          <RevisionPanel
            table="jabatan"
            rowId={jabatan.id}
            revisions={riwayat}
            canRevert={isAdmin}
            limit={RIWAYAT_DITAMPILKAN}
          />
        </div>
      </div>
    </div>
  );
}
