import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatWaktu } from "@/components/revisions/revisionDiff";
import RevisionPanel from "@/components/revisions/RevisionPanel";
import { requirePageSession } from "@/lib/auth/session";
import { getEmployeeById, getEmployeePrivate } from "@/lib/db/employees";
import { listRevisionsByRow } from "@/lib/db/revisions";
import type { DbClient } from "@/lib/db/shared";
import { TERMS } from "@/lib/i18n/terms";
import type { LoggedTable } from "@/lib/revisions/tables";
import type { EmployeePrivate, Revision } from "@/lib/types/db";

import DetailCard from "./_components/DetailCard";
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

/** How many Revisi `RevisionPanel` draws before "Tampilkan semua". */
const RIWAYAT_DITAMPILKAN = 10;

/**
 * How many Revisi to hand `RevisionPanel` on the first paint.
 *
 * Five times what is drawn, which is exactly the margin the panel gives itself
 * when it fetches (`max(limit * 5, 50)`, capped at 200). Matching it matters
 * for honesty, not for symmetry: the panel prints "Menampilkan 50 Revisi
 * terbaru. Riwayat selengkapnya ada di Log Perubahan." precisely when the list
 * it holds reaches that ceiling, so a server read with a smaller ceiling would
 * make it claim a Karyawan's Riwayat is complete when it is not.
 *
 * The cost is the RSC payload: `before`/`after` are whole-row snapshots, so a
 * heavily edited Karyawan ships up to 50 of them per panel. Rows with that many
 * Revisi are the exception (seed insert, then a handful of edits), and the
 * alternative — letting the panel fetch — moves the same bytes over a second
 * round trip behind a spinner.
 */
const RIWAYAT_LIMIT = RIWAYAT_DITAMPILKAN * 5;

/**
 * Riwayat Revisi read on the server, or `undefined` if that read failed.
 *
 * Deliberately swallowed rather than thrown: the Riwayat is a side panel, and
 * letting a hiccup on `revisions` replace the whole Karyawan with `error.tsx`
 * would hide the data the visitor actually came for. `undefined` makes
 * `RevisionPanel` load the list itself, with its own retry button. An RLS
 * refusal is not a failure at all — it comes back as a shorter list, and the
 * panel already says so.
 */
async function bacaRiwayat(
  client: DbClient,
  table: LoggedTable,
  rowId: string,
): Promise<Revision[] | undefined> {
  try {
    return await listRevisionsByRow(client, { table, rowId, limit: RIWAYAT_LIMIT });
  } catch (error) {
    console.error("[karyawan/detail] gagal memuat Riwayat Revisi", error);
    return undefined;
  }
}

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
    bacaRiwayat(client, "employees", id),
    isAdmin
      ? bacaRiwayat(client, "employee_private", id)
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
