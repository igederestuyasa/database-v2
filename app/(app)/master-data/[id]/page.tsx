import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import { RIWAYAT_DITAMPILKAN } from "@/components/revisions/riwayat";
import RevisionPanel from "@/components/revisions/RevisionPanel";
import DetailCard from "@/components/shared/DetailCard";
import { Badge } from "@/components/ui/badge";
import { requirePageSession } from "@/lib/auth/session";
import { countEmployeesByLookup, getLookupById } from "@/lib/db/lookups";
import type { DbClient } from "@/lib/db/shared";
import { NAV_LABELS, STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import type { Lookup } from "@/lib/types/db";

import { bacaRiwayat } from "../../_lib/riwayat";
import {
  buildLookupFields,
  hrefTabMasterData,
  labelStatusLookup,
  labelTipeLookup,
  type JumlahPemakai,
} from "./_components/lookupDetail";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Detail ${TERMS.lookup}` };

/**
 * Detail Lookup — one value of one daftar pilihan, read-only, with its Riwayat
 * Revisi (PRD #14) and "Kembalikan" for an admin (PRD #15).
 *
 * THREE THINGS THIS PAGE IS CAREFUL ABOUT
 * ---------------------------------------------------------------------------
 *
 * **1. It is read-only, on purpose.** Ubah, Urutan, Gabungkan and
 * Nonaktifkan live on `/master-data`, where `LookupTable` already owns the
 * dialogs and the list of same-tipe candidates a Merge needs. The feature this
 * page closes is the Riwayat, not editing, so it links back to the list.
 *
 * **2. The back link returns to the right tab.** `/master-data` keeps its open
 * tab in the URL (`?tipe=job_grade`), so a bare `/master-data` would drop the
 * reader on the first tipe rather than the one they came from.
 *
 * **3. A nonaktif Lookup renders like any other.** Nothing is ever deleted
 * (PRD §6 Non-Goals); the header marks the status and, when it was the source
 * half of a Merge, names where its Karyawan went.
 */

/** PostgREST rejects a malformed uuid with 22P02; this turns it into a 404. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Karyawan pointing at this Lookup, or `null` when counting failed.
 *
 * `countEmployeesByLookup` throws on a tipe outside the eleven — it refuses to
 * guess which `employees` column to count — so that is caught here rather than
 * taking down a page whose whole job is to show the Riwayat of the odd row.
 */
async function hitungPemakai(
  client: DbClient,
  lookup: Pick<Lookup, "id" | "tipe">,
): Promise<JumlahPemakai> {
  try {
    const [semua, aktif] = await Promise.all([
      countEmployeesByLookup(client, lookup, { status: "semua" }),
      countEmployeesByLookup(client, lookup, { status: "aktif" }),
    ]);
    return { semua, aktif };
  } catch (error) {
    console.error("[master-data/detail] gagal menghitung pemakai", error);
    return null;
  }
}

/** The Merge target's row, or `null` when it is unset or unreadable. */
async function bacaTujuanMerge(
  client: DbClient,
  mergedIntoId: string | null,
): Promise<Lookup | null> {
  if (!mergedIntoId) return null;
  try {
    return await getLookupById(client, mergedIntoId);
  } catch (error) {
    console.error("[master-data/detail] gagal memuat Lookup tujuan Merge", error);
    return null;
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Renders the "tidak ditemukan" page, but with HTTP 200 rather than 404:
  // `loading.tsx` here (and on `/master-data`) flushes the shell before this
  // runs, so the status line is already sent. Measured, deliberate, and
  // explained in docs/adr/ADR-007 — it is NOT caused by `force-dynamic`, and
  // removing that does not change it.
  if (!UUID_RE.test(id)) notFound();

  const { client, user } = await requirePageSession(`/master-data/${id}`);
  const isAdmin = user.role === "admin";

  const lookup = await getLookupById(client, id);
  // Either the Lookup does not exist, or RLS hides it. Both are "tidak
  // ditemukan" for the person looking at the screen.
  if (!lookup) notFound();

  const [jumlahPemakai, tujuanMerge, riwayat] = await Promise.all([
    hitungPemakai(client, lookup),
    bacaTujuanMerge(client, lookup.merged_into_id),
    bacaRiwayat(client, "lookups", id, "master-data/detail"),
  ]);

  const fields = buildLookupFields({
    lookup,
    digabungkanKe: tujuanMerge,
    jumlahPemakai,
  });

  const tipeLabel = labelTipeLookup(lookup.tipe);
  const nonaktif = lookup.status === "nonaktif";

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link
          href={hrefTabMasterData(lookup.tipe)}
          className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Kembali ke {NAV_LABELS["master-data"]}: {tipeLabel}
        </Link>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {lookup.label}
            </h1>
            <Badge variant="outline">{tipeLabel}</Badge>
            <Badge variant={nonaktif ? "secondary" : "default"}>
              {labelStatusLookup(lookup.status)}
            </Badge>
          </div>
          <p className="font-mono text-sm text-muted-foreground">{lookup.kode}</p>
        </div>

        {nonaktif ? (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              {TERMS.lookup} ini berstatus {STATUS_LABELS.nonaktif.toLowerCase()}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {lookup.merged_into_id
                ? `Nilai ini sudah di-${TERMS.merge} ke nilai lain, jadi ${TERMS.karyawan} yang memakainya sudah pindah ke sana. Mengaktifkannya kembali sendirian akan menaruh duplikat kosong di dropdown — batalkan ${TERMS.merge}-nya dari ${NAV_LABELS.log} kalau itu yang dimaksud.`
                : `Nilai ini tidak muncul lagi di dropdown ${tipeLabel}.`}{" "}
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
            judul={TERMS.lookup}
            keterangan={`Satu nilai pilihan berkode di dalam daftar ${tipeLabel}. Mengganti labelnya langsung terbaca di seluruh aplikasi — tidak ada data ${TERMS.karyawan} yang ikut diubah.`}
            fields={fields}
          />

          <p className="text-xs text-muted-foreground">
            Ditambahkan {formatWaktu(lookup.created_at)} · Terakhir diubah{" "}
            {formatWaktu(lookup.updated_at)}. Setiap perubahan tercatat di
            Riwayat Revisi di samping.
            {isAdmin
              ? ` Ubah, Urutan, Gabungkan dan ${
                  nonaktif ? "Aktifkan" : "Nonaktifkan"
                } ada di halaman ${NAV_LABELS["master-data"]}.`
              : ""}
          </p>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {/* PRD #14. `canRevert` only draws the button (PRD #15); the Server
              Action and `assert_admin()` inside the RPC decide whether a revert
              actually happens. A successful revert calls `router.refresh()`,
              so the fields beside it come back with the restored values. */}
          <RevisionPanel
            table="lookups"
            rowId={lookup.id}
            revisions={riwayat}
            canRevert={isAdmin}
            limit={RIWAYAT_DITAMPILKAN}
          />
        </div>
      </div>
    </div>
  );
}
