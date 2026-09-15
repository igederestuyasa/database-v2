import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import { RIWAYAT_DITAMPILKAN } from "@/components/revisions/riwayat";
import RevisionPanel from "@/components/revisions/RevisionPanel";
import DetailCard from "@/components/shared/DetailCard";
import { Badge } from "@/components/ui/badge";
import { requirePageSession } from "@/lib/auth/session";
import {
  countEmployeesByOrgUnit,
  getOrgUnitAncestors,
  getOrgUnitById,
} from "@/lib/db/orgUnits";
import { NAV_LABELS, STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import { isUuid } from "@/lib/validation/uuid";

import { bacaAman } from "../../_lib/bacaAman";
import { bacaRiwayat } from "../../_lib/riwayat";
import {
  buildOrgUnitFields,
  hrefUnit,
  labelStatusUnit,
  labelTipeUnit,
} from "./_components/orgUnitDetail";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Detail ${TERMS.unitOrganisasi}` };

/**
 * Detail Unit Organisasi — one node of the hierarchy, read-only, with its
 * Riwayat Revisi (PRD #14) and "Kembalikan" for an admin (PRD #15).
 *
 * THREE THINGS THIS PAGE IS CAREFUL ABOUT
 * ---------------------------------------------------------------------------
 *
 * **1. It is read-only, on purpose.** Ubah, Tambah, Gabungkan and
 * Nonaktifkan all live on `/struktur`, where `StrukturClient` already owns the
 * dialogs and — the part that matters — the data they need: the whole tree for
 * the induk picker, and the subtree exclusion that keeps a Merge from creating
 * a cycle. Re-opening those dialogs here would mean re-reading the tree and
 * re-deriving those rules in a second place. The feature this page closes is
 * the Riwayat, not editing, so it links back to `/struktur` instead.
 *
 * **2. A failed breadcrumb does not take the page down.**
 * `getOrgUnitAncestors()` throws `IncompleteReadError` when the flat read of
 * `org_units` comes back short, because a breadcrumb that silently drops the
 * Direktorat it hangs under does not look incomplete — it looks like a
 * different place in the company. That is the right call for the helper and
 * the wrong one for this page: the ancestor chain is context, the Revisi are
 * the point. So it is caught, and the page says the chain could not be read
 * rather than replacing the unit with `error.tsx`.
 *
 * **3. A nonaktif unit renders like any other.** Nothing is ever deleted
 * (PRD §6 Non-Goals); the header marks the status and, when it was the source
 * half of a Merge, names where its Karyawan went.
 */

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Renders the "tidak ditemukan" page, but with HTTP 200 rather than 404:
  // `loading.tsx` here (and on `/struktur`) flushes the shell before this runs,
  // so the status line is already sent. Measured, deliberate, and explained in
  // docs/adr/ADR-007 — it is NOT caused by `force-dynamic`, and removing that
  // does not change it.
  if (!isUuid(id)) notFound();

  const { client, user } = await requirePageSession(`/struktur/${id}`);
  const isAdmin = user.role === "admin";

  const unit = await getOrgUnitById(client, id);
  // Either the unit does not exist, or RLS hides it. Both are "tidak
  // ditemukan" for the person looking at the screen.
  if (!unit) notFound();

  // Every side read goes through `bacaAman()`: the unit and its Riwayat are the
  // point, the rest is context, and none of it may take the page down.
  const mergedIntoId = unit.merged_into_id;
  const [rantai, jumlah, tujuanMerge, riwayat] = await Promise.all([
    // Path from the topmost ancestor down to this unit, inclusive.
    bacaAman("struktur/detail", "memuat rantai induk", () =>
      getOrgUnitAncestors(client, id),
    ),
    bacaAman("struktur/detail", "menghitung Karyawan", async () => {
      const [semua, aktif] = await Promise.all([
        countEmployeesByOrgUnit(client, id, { status: "semua" }),
        countEmployeesByOrgUnit(client, id, { status: "aktif" }),
      ]);
      return { semua, aktif };
    }),
    mergedIntoId
      ? bacaAman("struktur/detail", "memuat unit tujuan Merge", () =>
          getOrgUnitById(client, mergedIntoId),
        )
      : Promise.resolve(null),
    bacaRiwayat(client, "org_units", id, "struktur/detail"),
  ]);

  // `getOrgUnitAncestors` includes the unit itself as the last element.
  const rantaiGagal = rantai === undefined;
  const leluhur = (rantai ?? []).slice(0, -1);
  const induk =
    unit.parent_id === null
      ? null
      : (leluhur.find((row) => row.id === unit.parent_id) ?? null);

  const fields = buildOrgUnitFields({
    unit,
    induk,
    indukGagal: rantaiGagal,
    digabungkanKe: tujuanMerge ?? null,
    jumlahKaryawan: jumlah ?? null,
  });

  const nonaktif = unit.status === "nonaktif";

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link
          href="/struktur"
          className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {/* The sidebar calls this page "Struktur Organisasi"; "Unit
              Organisasi" is one node in it (CONTEXT.md), so naming the page
              after the node would send a reader looking for a menu item that
              is not there. */}
          ← Kembali ke {NAV_LABELS.struktur}
        </Link>

        {leluhur.length > 0 ? (
          <nav aria-label={`Induk ${TERMS.unitOrganisasi}`}>
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              {leluhur.map((row) => (
                <li key={row.id} className="flex items-center gap-1.5">
                  <Link
                    href={hrefUnit(row.id)}
                    className="underline-offset-4 hover:underline"
                  >
                    {row.nama}
                  </Link>
                  <span aria-hidden="true">›</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{unit.nama}</h1>
            <Badge variant="outline">{labelTipeUnit(unit.tipe)}</Badge>
            <Badge variant={nonaktif ? "secondary" : "default"}>
              {labelStatusUnit(unit.status)}
            </Badge>
          </div>
          <p className="font-mono text-sm text-muted-foreground">{unit.kode}</p>
        </div>

        {rantaiGagal ? (
          <div role="alert" className="rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">Rantai induk belum bisa ditampilkan.</p>
            <p className="mt-1 text-muted-foreground">
              Hierarki di atas unit ini tidak berhasil dibaca lengkap, jadi tidak
              ditampilkan sama sekali — rantai yang bolong akan terlihat seperti
              tempat lain di perusahaan. Data unit ini sendiri dan Riwayat
              Revisinya di bawah tetap utuh.
            </p>
          </div>
        ) : null}

        {nonaktif ? (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              {TERMS.unitOrganisasi} ini berstatus{" "}
              {STATUS_LABELS.nonaktif.toLowerCase()}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {unit.merged_into_id
                ? `Unit ini sudah di-${TERMS.merge} ke unit lain, jadi ${TERMS.karyawan}-nya sudah pindah ke sana.`
                : "Unit ini tidak muncul lagi di daftar pilihan."}{" "}
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
            judul={TERMS.unitOrganisasi}
            keterangan={`${TERMS.karyawan} menunjuk unit terendah tempatnya ditempatkan; jenjang di atasnya diturunkan dari hierarki, bukan disimpan di baris ${TERMS.karyawan}.`}
            fields={fields}
          />

          <p className="text-xs text-muted-foreground">
            Ditambahkan {formatWaktu(unit.created_at)} · Terakhir diubah{" "}
            {formatWaktu(unit.updated_at)}. Setiap perubahan tercatat di Riwayat
            Revisi di samping.
            {isAdmin
              ? ` Ubah, Gabungkan dan ${
                  nonaktif ? "Aktifkan" : "Nonaktifkan"
                } ada di halaman ${NAV_LABELS.struktur}.`
              : ""}
          </p>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {/* PRD #14. `canRevert` only draws the button (PRD #15); the Server
              Action and `assert_admin()` inside the RPC decide whether a revert
              actually happens. A successful revert calls `router.refresh()`,
              so the fields beside it come back with the restored values. */}
          <RevisionPanel
            table="org_units"
            rowId={unit.id}
            revisions={riwayat}
            canRevert={isAdmin}
            limit={RIWAYAT_DITAMPILKAN}
          />
        </div>
      </div>
    </div>
  );
}
