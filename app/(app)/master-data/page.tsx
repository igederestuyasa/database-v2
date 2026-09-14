import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  requireUser,
  UnauthenticatedError,
  type GuardContext,
} from "@/lib/actions/_guard";
import { getLookupsGroupedByType } from "@/lib/db/lookups";
import { NAV_LABELS, TERMS } from "@/lib/i18n/terms";
import type { Lookup } from "@/lib/types/db";
import {
  isLookupType,
  LOOKUP_TYPES,
  LOOKUP_TYPE_LABELS,
  type LookupType,
} from "@/lib/validation/lookupTypes";

import LookupTable, { type MasterDataRow } from "./LookupTable";
import LookupTypeTabs from "./LookupTypeTabs";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: NAV_LABELS["master-data"] };

/**
 * Master Data — semua tipe Lookup, satu tab per tipe (PRD #9, #10).
 *
 * "Master Data" is the name of THIS PAGE and nothing else; the umbrella term
 * for Unit Organisasi + Jabatan + Lookup is Data Referensi, and Karyawan data
 * is never called master data (CONTEXT.md).
 *
 * One read serves the whole page: all eleven tipe come back in a single query,
 * which is what gives the tab strip its counts. Only the rows of the open tab
 * are handed to the browser.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const diminta = Array.isArray(params.tipe) ? params.tipe[0] : params.tipe;
  const tipe: LookupType = isLookupType(diminta) ? diminta : LOOKUP_TYPES[0];

  // No middleware yet (ADR-005 §11), so the page itself sends a signed-out
  // visitor to /login rather than rendering an empty table. Only that one case
  // redirects: `requireUser()` distinguishes "belum login" from "login tapi
  // profil belum dibuat", and sending the second to a login form would be a
  // dead end — signing in again cannot create the missing `profiles` row. That
  // one falls through to `error.tsx`, which shows its "Hubungi admin" message.
  let session: GuardContext;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }
  const { client, user } = session;

  // `semua`: nonaktif rows must stay visible here — this is the one page where
  // a value is taken out of circulation and, if that was a mistake, put back.
  const grouped = await getLookupsGroupedByType(client, { status: "semua" });

  const counts = Object.fromEntries(
    LOOKUP_TYPES.map((t) => [t, grouped[t].length]),
  ) as Record<LookupType, number>;

  const rows = toRows(grouped[tipe]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {NAV_LABELS["master-data"]}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Daftar pilihan berkode yang dirujuk {TERMS.karyawan} lewat ID: setiap{" "}
          {TERMS.lookup} punya kode yang tetap dan label yang boleh berubah.
          Mengganti label di sini langsung terbaca di seluruh aplikasi — tidak
          ada data {TERMS.karyawan} yang ikut diubah.
        </p>
      </header>

      <LookupTypeTabs active={tipe} counts={counts} />

      <section aria-label={`Daftar ${LOOKUP_TYPE_LABELS[tipe]}`} className="space-y-3">
        <h2 className="text-lg font-medium">{LOOKUP_TYPE_LABELS[tipe]}</h2>
        <LookupTable tipe={tipe} rows={rows} isAdmin={user.role === "admin"} />
      </section>
    </div>
  );
}

/**
 * `lookups` rows → what the table renders.
 *
 * The one piece of work here is resolving `merged_into_id` to a label: a
 * nonaktif row that says "Digabungkan ke «Pratama III - 13»" explains itself,
 * where a bare uuid explains nothing. Both halves of a Merge share a tipe, so
 * the target is always in the same list.
 */
function toRows(rows: readonly Lookup[]): MasterDataRow[] {
  const labelById = new Map(rows.map((row) => [row.id, row.label]));

  return rows.map((row) => ({
    id: row.id,
    // Narrowed by the CHECK constraint on `lookups.tipe`; the grouping in
    // `getLookupsGroupedByType` already dropped anything outside the eleven.
    tipe: row.tipe as LookupType,
    kode: row.kode,
    label: row.label,
    urutan: row.urutan,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
    mergedIntoId: row.merged_into_id,
    mergedIntoLabel: row.merged_into_id
      ? (labelById.get(row.merged_into_id) ?? null)
      : null,
  }));
}
