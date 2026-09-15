import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import { RIWAYAT_DITAMPILKAN } from "@/components/revisions/riwayat";
import RevisionPanel from "@/components/revisions/RevisionPanel";
import DetailCard from "@/components/shared/DetailCard";
import { requirePageSession } from "@/lib/auth/session";
import { getEmployeeById, getEmployeePrivate } from "@/lib/db/employees";
import type { DbClient } from "@/lib/db/shared";
import { TERMS } from "@/lib/i18n/terms";
import type { EmployeePrivate } from "@/lib/types/db";

import { bacaRiwayat } from "../../_lib/riwayat";
import EmployeeHeader from "./_components/EmployeeHeader";
import {
  buildEmployeeSections,
  buildPrivateFields,
  semuaKosong,
} from "./_components/employeeDetailFields";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Detail Karyawan" };

/**
 * Detail Karyawan — every field of one person, read-only (PRD #6, #14, #22).
 *
 * THREE THINGS THIS PAGE IS CAREFUL ABOUT
 * ---------------------------------------------------------------------------
 *
 * **1. It reads `v_employees`, never `v_employees_private`.** The private view
 * INNER JOINs `employee_private`, so for a viewer RLS removes the whole row and
 * the view returns ZERO ROWS — not a row with NULL sensitive columns (ADR-005
 * §10). A page built on it would be blank for every viewer. So the visible half
 * comes from `getEmployeeById()` and the sensitive half from
 * `getEmployeePrivate()`, which simply returns `null` when the reader may not
 * see it (PRD #22).
 *
 * **2. Nothing here writes.** Editing lives at `/karyawan/[id]/edit`, and the
 * link to it is drawn only for an admin — while the Server Action behind that
 * form and RLS are what actually decide (ARCHITECTURE.md §5, CLAUDE.md: check
 * the role in the Server Action *and* in RLS).
 *
 * **3. A nonaktif Karyawan renders like any other.** Nothing is ever deleted
 * (PRD §6 Non-Goals); the header marks the status and shows the Tanggal Keluar.
 */

/** PostgREST rejects a malformed uuid with 22P02; this turns it into a 404. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How many Revisi to draw (`RIWAYAT_DITAMPILKAN`) and how many to read for
// them (`RIWAYAT_LIMIT`, used inside `bacaRiwayat`) both live in
// `components/revisions/riwayat.ts`: the server read has to use the same
// ceiling the panel would have used for itself, or its "Menampilkan N Revisi
// terbaru" footnote lies about whether the Riwayat is complete. Four detail
// pages depend on that, so the number and its reasoning are in one place.

/**
 * Data Pribadi Sensitif, or `gagal` when the read itself broke.
 *
 * Same reasoning as `bacaRiwayat()`: this is one card on the side of the page.
 * A statement timeout on `employee_private` must not cost an admin the name,
 * the Penempatan, the dates and the whole Riwayat of the Karyawan they opened.
 * `null` with `gagal: false` is the ordinary "belum diisi"; `gagal: true` says
 * so on the card instead of pretending the columns are empty.
 */
async function bacaPribadi(
  client: DbClient,
  employeeId: string,
): Promise<{ row: EmployeePrivate | null; gagal: boolean }> {
  try {
    return { row: await getEmployeePrivate(client, employeeId), gagal: false };
  } catch (error) {
    console.error("[karyawan/detail] gagal memuat Data Pribadi Sensitif", error);
    return { row: null, gagal: true };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Renders the "tidak ditemukan" page, but with HTTP 200 rather than 404:
  // `loading.tsx` here (and on `/karyawan`) flushes the shell before this runs,
  // so the status line is already sent. Measured, deliberate, and explained in
  // docs/adr/ADR-007 — it is NOT caused by `force-dynamic`, and removing that
  // does not change it.
  if (!UUID_RE.test(id)) notFound();

  const { client, user } = await requirePageSession(`/karyawan/${id}`);
  const isAdmin = user.role === "admin";

  const karyawan = await getEmployeeById(client, id);
  // Either the Karyawan does not exist, or RLS hides them. Both are "tidak
  // ditemukan" for the person looking at the screen.
  if (!karyawan) notFound();

  // Data Pribadi Sensitif is only ever asked for when the reader is an admin;
  // for anyone else RLS would answer `null` anyway, and not asking keeps the
  // page honest about who it is for (PRD #22).
  const [pribadi, riwayat, riwayatPribadi] = await Promise.all([
    isAdmin
      ? bacaPribadi(client, id)
      : Promise.resolve({ row: null, gagal: false }),
    bacaRiwayat(client, "employees", id, "karyawan/detail"),
    isAdmin
      ? bacaRiwayat(client, "employee_private", id, "karyawan/detail")
      : Promise.resolve(undefined),
  ]);

  const sections = buildEmployeeSections(karyawan);
  const fieldsPribadi = buildPrivateFields(pribadi.row);

  return (
    <div className="space-y-6">
      <EmployeeHeader employee={karyawan} isAdmin={isAdmin} />

      {/* 3/5 + 2/5 rather than 2/3 + 1/3: the Riwayat Revisi panel renders a
          before → after diff, which needs room for two values side by side. */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {sections.map((section) => (
            <DetailCard
              key={section.id}
              judul={section.judul}
              keterangan={section.keterangan}
              fields={section.fields}
            />
          ))}

          <p className="text-xs text-muted-foreground">
            Ditambahkan {formatWaktu(karyawan.created_at)} · Terakhir diubah{" "}
            {formatWaktu(karyawan.updated_at)}. Setiap perubahan tercatat di
            Riwayat Revisi di samping.
          </p>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {isAdmin ? (
            <DetailCard
              judul={TERMS.dataPribadiSensitif}
              keterangan="Hanya admin yang bisa melihat dan mengubahnya, dan kolom ini tidak pernah keluar lewat API."
              fields={fieldsPribadi}
              catatan={
                pribadi.gagal
                  ? "Data Pribadi Sensitif gagal dimuat, jadi kolom di atas kosong bukan karena belum diisi. Muat ulang halaman ini untuk mencoba lagi."
                  : semuaKosong(fieldsPribadi)
                    ? "Belum diisi. Kolom ini memang boleh kosong."
                    : undefined
              }
            />
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">{TERMS.dataPribadiSensitif}</p>
              <p className="mt-1 text-muted-foreground">
                Agama, tanggal &amp; tempat lahir, dan status pernikahan hanya
                bisa dibaca admin. Halaman ini menampilkan selebihnya secara
                lengkap.
              </p>
            </div>
          )}

          {/* PRD #14. `canRevert` only draws the button (PRD #15); the Server
              Action and `assert_admin()` inside the RPC decide whether a revert
              actually happens. A successful revert calls `router.refresh()`,
              so the fields above come back with the restored values. */}
          <RevisionPanel
            table="employees"
            rowId={karyawan.id}
            revisions={riwayat}
            canRevert={isAdmin}
            limit={RIWAYAT_DITAMPILKAN}
          />

          {/* Revisi of `employee_private` live under the same `row_id` but in
              their own table, and RLS keeps them admin-only — so they get their
              own panel rather than being mixed into the one above, where a
              viewer would see a Riwayat with holes in it. */}
          {isAdmin ? (
            <RevisionPanel
              table="employee_private"
              rowId={karyawan.id}
              revisions={riwayatPribadi}
              canRevert
              limit={RIWAYAT_DITAMPILKAN}
              title={`Riwayat ${TERMS.dataPribadiSensitif}`}
              emptyMessage={`Belum ada Revisi ${TERMS.dataPribadiSensitif}.`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
