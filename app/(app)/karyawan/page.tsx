import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/hc/EmptyState";
import Tombol from "@/components/hc/Tombol";
import DaftarTerpotongAlert from "@/components/shared/DaftarTerpotongAlert";
import { requirePageSession } from "@/lib/auth/session";
import { listEmployees } from "@/lib/db/employees";
import { loadReferenceOptions } from "@/lib/db/referenceOptions";
import {
  DbError,
  IncompleteReadError,
  type DbClient,
  type Paged,
} from "@/lib/db/shared";
import { NAV_LABELS, TERMS } from "@/lib/i18n/terms";
import type { VEmployee } from "@/lib/types/db";

import KaryawanClient from "./_components/KaryawanClient";
import {
  KARYAWAN_PER_PAGE,
  hitungFilterAktif,
  parseKaryawanFilters,
  sortOption,
  type KaryawanFilters,
} from "./_components/karyawanFilters";
import { toKaryawanRows } from "./_components/karyawanRows";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: NAV_LABELS.karyawan };

/**
 * Daftar Karyawan — pencarian dan filter (PRD #2).
 *
 * WHAT THIS PAGE READS. `v_employees`, through `lib/db/employees.ts`, and
 * nothing else. Not `v_employees_private`: that view INNER JOINs
 * `employee_private`, whose RLS is admin-only, so a viewer opening this page
 * would get **zero Karyawan** — an empty database, not a table with blank
 * columns (ADR-005 §10). Both roles read the same list here; Data Pribadi
 * Sensitif belongs to the detail page, which asks for it separately.
 *
 * WHY THE FILTER LISTS ARE READ WHOLE, AND WHY THAT IS CHECKED. The three
 * pickers need every Unit Organisasi, every Jabatan and every Lookup — aktif
 * *and* nonaktif, because a nonaktif unit can still hold Karyawan and someone
 * has to be able to find them. Those reads return `FullRead`, and a `FullRead`
 * can come back short without failing: PostgREST caps a response at
 * `db-max-rows` and reports the cap as success. A truncated picker is the
 * quietest bug this page could have — the missing option is not an error
 * message, it is a Divisi that "has nobody in it". So `truncated` is printed on
 * the page instead of being swallowed.
 *
 * WHY PAGING IS THE QUERY'S JOB. ±1.500 Karyawan, 50 per page, with an exact
 * count from the same query (`listEmployees`). Sorting too: see the note in
 * `KaryawanTable.tsx` about why no column header is clickable.
 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const filters = parseKaryawanFilters(await searchParams);

  // `middleware.ts` is the boundary, and RLS is the wall; this is the door, so
  // that a session that expired between the two shows the login page instead of
  // an empty table. `requirePageSession()` sends "belum login" and "profil
  // belum dibuat" to /login with a notice saying which; the login page renders
  // both states itself, so neither is a dead end.
  const { client, user } = await requirePageSession("/karyawan");

  // Two reads, one round trip: the Karyawan page does not depend on the picker
  // lists, and awaiting it after them would add a full round trip to every
  // filter change. `loadReferenceOptions` reads with `status: "semua"`: a
  // nonaktif Unit Organisasi, Jabatan or Lookup still has Karyawan pointing at
  // it, and this page is where someone goes to find them and move them
  // somewhere alive.
  const [options, hasil] = await Promise.all([
    loadReferenceOptions(client),
    ambilKaryawan(client, filters),
  ]);
  const { daftar, galatHierarki } = hasil;

  return (
    <KaryawanClient
      rows={toKaryawanRows(daftar?.rows ?? [])}
      pesanKosong={
        galatHierarki
          ? `Daftar ${TERMS.karyawan} tidak dimuat karena filter di atas gagal diterapkan.`
          : undefined
      }
      filters={filters}
      page={daftar?.page ?? filters.page}
      perPage={daftar?.perPage ?? KARYAWAN_PER_PAGE}
      total={daftar?.total ?? 0}
      isAdmin={user.role === "admin"}
      unitOptions={options.orgUnit}
      jabatanOptions={options.jabatan}
      lookupOptions={options.lookup}
      /*
        Peringatan dirakit di sini, bukan di dalam KaryawanClient: keduanya
        lahir dari hasil baca di server, dan menyalurkannya sebagai ReactNode
        membuat halaman ini tetap satu-satunya yang tahu soal PostgREST dan
        IncompleteReadError. Yang diterima KaryawanClient cuma "ada yang perlu
        ditampilkan di atas daftar".
      */
      peringatan={
        <>
          <DaftarTerpotongAlert
            daftar={options.terpotong}
            judul="Pilihan filter belum lengkap."
            keterangan={`Ada pilihan yang tidak muncul di daftar filter — dan ${TERMS.karyawan} yang seharusnya ketemu lewat pilihan itu ikut tidak terlihat. Pakai kotak pencarian dulu, dan laporkan ini supaya batasnya dinaikkan.`}
          />


          {/*
            Satu-satunya saat halaman Seed adalah langkah berikutnya yang
            benar: admin, tabel kosong, dan tidak ada filter yang mungkin
            menyembunyikan siapa pun (PRD #23). Dari main, dibentuk ulang
            sebagai EmptyState HC Panel.
          */}
          {user.role === "admin" &&
          !galatHierarki &&
          (daftar?.total ?? 0) === 0 &&
          hitungFilterAktif(filters) === 0 ? (
            <EmptyState
              judul={`Belum ada ${TERMS.karyawan} sama sekali`}
              ajakan={`Data masuk lewat ${TERMS.impor} dari file Excel — boleh diulang kapan saja, dan setiap kali tercatat sebagai satu ${TERMS.batch} yang bisa dikembalikan utuh.`}
              aksi={
                <Tombol asChild>
                  <Link href="/karyawan/impor">
                    {TERMS.impor} dari Excel
                  </Link>
                </Tombol>
              }
            />
          ) : null}

          {galatHierarki ? (
            <div
              role="alert"
              className="hc-permukaan rounded-kartu border border-destructive/40 bg-destructive/5 p-4 text-pendukung"
            >
              <p className="text-label text-foreground">
                Filter {TERMS.unitOrganisasi} tidak bisa diterapkan.
              </p>
              <p className="mt-1 text-muted-foreground">
                {galatHierarki} Hilangkan centang &laquo;Termasuk{" "}
                {TERMS.unitOrganisasi} di bawahnya&raquo; untuk menyaring satu
                unit saja, atau bersihkan filternya.
              </p>
            </div>
          ) : null}
        </>
      }
    />
  );
}

async function ambilKaryawan(
  client: DbClient,
  filters: KaryawanFilters,
): Promise<{ daftar: Paged<VEmployee> | null; galatHierarki: string | null }> {
  const urutan = sortOption(filters.sort);
  const query = (page: number) =>
    listEmployees(client, {
      page,
      perPage: KARYAWAN_PER_PAGE,
      search: filters.q,
      status: filters.status,
      orgUnitId: filters.unitId,
      includeChildren: filters.includeChildren,
      jabatanId: filters.jabatanId,
      lookups: filters.lookups,
      orderBy: urutan.orderBy,
      direction: urutan.direction,
    });

  try {
    const halaman = await query(filters.page);
    if (halaman.page <= halaman.pageCount) {
      return { daftar: halaman, galatHierarki: null };
    }
    // Nothing matched at all: the rows are already right (there are none), so
    // only the page number needs correcting — no second query for an empty set.
    if (halaman.total === 0) {
      return {
        daftar: { ...halaman, page: halaman.pageCount },
        galatHierarki: null,
      };
    }
    return { daftar: await query(halaman.pageCount), galatHierarki: null };
  } catch (error) {
    if (error instanceof IncompleteReadError) {
      return { daftar: null, galatHierarki: error.message };
    }
    // PGRST103: the requested range starts past the exact count. Same cause as
    // the clamp above, reported as an error instead of an empty page.
    if (error instanceof DbError && error.code === "PGRST103" && filters.page > 1) {
      return { daftar: await query(1), galatHierarki: null };
    }
    throw error;
  }
}
