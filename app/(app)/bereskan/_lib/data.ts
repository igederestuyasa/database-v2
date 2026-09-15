/**
 * Baca data untuk halaman "Perlu Dibereskan" dan susun Temuan-nya (PRD #11).
 *
 * The detection rules themselves are pure and live in `lib/cleaning/**`, where
 * they are unit-tested without a database. This module is the other half: it
 * reads the rows, hands them to those rules, and shapes the result for the
 * page — nothing here decides what is dirty.
 *
 * Reads only. Every write from this page goes through a Server Action
 * (`./actions.ts` for rename, `lib/actions/merge.ts` for Merge).
 */
// From `lib/entityOptions`, NOT from `EntityPicker`: this module runs on the
// server, and every export of a `"use client"` module reaches the server as a
// reference that throws when called. Same functions, same signatures.
import {
  toJabatanOptions,
  toLookupOptions,
  toOrgUnitOptions,
  type EntityOption,
} from "@/lib/entityOptions";
import {
  findEmployeesMissingReference,
  findOrphanOrgUnits,
  findUnitsNamedLikeParent,
  type EmployeeRow,
  type OrgUnitRow,
  type TemuanKaryawanTanpaReferensi,
  type TemuanUnitSenamaInduk,
  type TemuanUnitTanpaInduk,
} from "@/lib/cleaning/findOrphans";
import {
  findSimilarNames,
  type ReferenceRow,
  type TemuanNamaMirip,
} from "@/lib/cleaning/findSimilar";
import { listEmployees, type EmployeeListParams } from "@/lib/db/employees";
import { listAllJabatan } from "@/lib/db/jabatan";
import { listAllLookups } from "@/lib/db/lookups";
import { listAllOrgUnits } from "@/lib/db/orgUnits";
import { DbError, type DbClient } from "@/lib/db/shared";
import type { VEmployee } from "@/lib/types/db";
import { ORG_UNIT_TYPE_LABELS, TERMS } from "@/lib/i18n/terms";
import {
  isLookupType,
  LOOKUP_TYPE_LABELS,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
} from "@/lib/validation/lookupTypes";

/** Everything the page can show. One discriminated union, one list. */
export type Temuan =
  | TemuanNamaMirip
  | TemuanUnitTanpaInduk
  | TemuanUnitSenamaInduk
  | TemuanKaryawanTanpaReferensi;

export type TemuanJenis = Temuan["jenis"];

export type BereskanData = {
  temuan: Temuan[];
  /** How many Temuan of each jenis, for the section headers. */
  ringkasan: Record<TemuanJenis, number>;
  total: number;
  /** Merge targets, by kind. Lookup targets are grouped by tipe. */
  kandidat: {
    org_unit: EntityOption[];
    jabatan: EntityOption[];
    lookup: Record<string, EntityOption[]>;
  };
  /**
   * `id` → how many Karyawan point at it, every status included, because that
   * is what a Merge moves. `0` means counted-and-empty; a missing key means
   * not counted at all.
   */
  jumlahKaryawan: Record<string, number>;
  /** Anything the page must admit it could not show in full. */
  catatan: string[];
};

/**
 * Hard ceiling on the "tanpa referensi" lists.
 *
 * There are ~1.500 Karyawan in total, so reaching this would mean nearly every
 * one of them is missing a reference. If it ever is reached the page says so
 * out loud (`catatan`) instead of presenting a prefix as the whole answer —
 * the point of this page is knowing how much work is left.
 */
const MAX_KARYAWAN = 2000;

/**
 * Rows per request when paging Karyawan.
 *
 * Kept **below PostgREST's `db-max-rows`** (1000 by default). That cap is
 * applied server-side before any `limit` we ask for and comes back as a short
 * array with no error — so a single 1.500-row read would look like a complete
 * answer while quietly hiding 500 Karyawan. On a page whose whole job is to say
 * whether the data is clean, "clean" must never come from a read that was cut
 * short, so we ask for less than the cap and page instead.
 */
const PER_PAGE = 500;

/** `in(...)` chunk size — keeps the PostgREST query string well under any URL cap. */
const CHUNK = 100;

/**
 * Ceiling on one tally read.
 *
 * There are ~1.500 Karyawan in total, so a chunk can never legitimately come
 * close. The limit exists so that a server-side row cap shows up as an error
 * instead of as a number that is quietly too small — see `assertLengkap()`.
 */
const MAX_COUNT_ROWS = 5000;

function chunked<T>(values: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Count Karyawan per FK value, for the ids given — paged, and verified.
 *
 * WHY IT PAGES
 * PostgREST applies `db-max-rows` (1000 by default) before any range we ask
 * for, and a capped answer is a short array with no error. One chunk of ids can
 * easily match more Karyawan than that, so a single read would tally only part
 * of them and report a number that is quietly too low — right where the user is
 * about to press Merge. So: read a window below the cap, keep going until the
 * exact `count` is accounted for, and throw if we ever stop short of it.
 *
 * WHY EVERY STATUS COUNTS
 * `merge_org_unit` / `merge_jabatan` / `merge_lookup` move rows with
 * `where <kolom> = p_source` and no status predicate
 * (`0002_batch_operations.sql`), so a tally that skipped nonaktif Karyawan
 * would promise to move fewer people than the Merge actually moves.
 *
 * Ids with no Karyawan are seeded to `0`, so "0 Karyawan" — the safest merge
 * there is — reads differently from "belum dihitung".
 *
 * `column` is never caller text: it is `org_unit_id`, `jabatan_id`, or the
 * column the frozen `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map assigns to a tipe.
 */
async function tallyByColumn(
  client: DbClient,
  column: string,
  ids: readonly string[],
  konteks: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const chunk of chunked(ids)) {
    let dibaca = 0;
    let total = 0;

    for (;;) {
      // hc-check-columns-ignore — `column` is an employees FK column chosen by
      // the caller from a frozen list, never from user input.
      const { data, count, error } = await client
        .from("employees")
        .select(column, { count: "exact" })
        .in(column, chunk)
        // Stable order, or a range-paged read can show one row twice and miss
        // another as Postgres re-orders equal keys.
        .order("id", { ascending: true })
        .range(dibaca, dibaca + PER_PAGE - 1);
      if (error) throw new DbError(konteks, error);

      const rows = (data ?? []) as unknown as Record<string, string | null>[];
      total = count ?? rows.length;
      for (const row of rows) {
        const id = row[column];
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      dibaca += rows.length;

      if (rows.length === 0) break;
      if (dibaca >= total) break;
      if (dibaca >= MAX_COUNT_ROWS) break;
    }

    if (dibaca < total) {
      // Never show a number we know is short: this one is read immediately
      // before a Merge that moves people (same reasoning as
      // `getOrgUnitDescendantIds()` in `lib/db/orgUnits.ts`).
      throw new Error(
        `${konteks}: baru ${dibaca} dari ${total} baris yang terbaca, jadi hitungan "akan dipindahkan" tidak bisa dipercaya. Tambahkan pagination sebelum melanjutkan.`,
      );
    }
  }

  return counts;
}

/** Karyawan per `employees.org_unit_id`. */
async function countByOrgUnit(
  client: DbClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  return tallyByColumn(
    client,
    "org_unit_id",
    ids,
    "Gagal menghitung Karyawan per Unit Organisasi",
  );
}

/** Karyawan per `employees.jabatan_id`. */
async function countByJabatan(
  client: DbClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  return tallyByColumn(client, "jabatan_id", ids, "Gagal menghitung Karyawan per Jabatan");
}

/**
 * Karyawan per Lookup, one tally per tipe involved.
 *
 * The `employees` column is chosen by tipe through the frozen
 * `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map, so this can only ever reach the column
 * that tipe owns — the same rule `merge_lookup` follows in SQL.
 */
async function countByLookup(
  client: DbClient,
  idsByTipe: Map<string, string[]>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const [tipe, ids] of idsByTipe) {
    if (!isLookupType(tipe) || ids.length === 0) continue;
    const perTipe = await tallyByColumn(
      client,
      LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[tipe],
      ids,
      "Gagal menghitung Karyawan per Lookup",
    );
    for (const [id, jumlah] of perTipe) counts.set(id, jumlah);
  }
  return counts;
}

/**
 * Every matching Karyawan, paged until the exact count is accounted for.
 *
 * `Paged.total` comes from PostgREST's `count: "exact"`, which is **not**
 * subject to `db-max-rows` — so comparing what arrived against it is how a
 * truncated read is detected at all. `lengkap: false` means the caller must say
 * so on screen rather than present the list as the complete answer: a
 * data-cleaning page that reports "bersih" for rows it never read is worse than
 * one that admits it cannot see them.
 *
 * The order (`full_name`, then `personnel_number` as a tie-break inside
 * `listEmployees`) is stable, so paging cannot show one row twice and miss
 * another.
 */
async function listEmployeesAll(
  client: DbClient,
  filter: Pick<EmployeeListParams, "orgUnitId" | "jabatanId">,
): Promise<{ rows: VEmployee[]; total: number; lengkap: boolean }> {
  const rows: VEmployee[] = [];
  let total = 0;

  for (let page = 1; ; page += 1) {
    const halaman = await listEmployees(client, {
      ...filter,
      status: "aktif",
      orderBy: "full_name",
      page,
      perPage: PER_PAGE,
    });
    total = halaman.total;
    rows.push(...halaman.rows);

    // Nothing came back, everything is accounted for, or the server handed
    // back less than asked (the `db-max-rows` signature) — stop either way.
    if (halaman.rows.length === 0) break;
    if (rows.length >= total) break;
    if (halaman.rows.length < PER_PAGE) break;
    if (rows.length >= MAX_KARYAWAN) break;
  }

  return { rows, total, lengkap: rows.length >= total };
}

/**
 * Say so when a Data Referensi read came back short.
 *
 * This used to be a heuristic — "a read that stopped on exactly 1000 rows was
 * probably capped" — because `lib/db/**` handed back a bare array and there was
 * nothing else to go on. `listAll*()` now asks for `count: "exact"` on the same
 * query and reports `truncated` from it, so this is no longer a guess: the
 * database says how many rows match, and we say how many arrived.
 */
function peringatanTerpotong(
  read: { rows: readonly unknown[]; total: number; truncated: boolean },
  label: string,
): string | null {
  if (!read.truncated) return null;
  return `Baru ${read.rows.length} dari ${read.total} ${label} yang terbaca — database membatasi jumlah baris per permintaan (db-max-rows). ${TERMS.temuan} di bawah belum lengkap.`;
}

/** Read everything, run the rules, and shape the page's props. */
export async function loadBereskan(client: DbClient): Promise<BereskanData> {
  // Status "semua": the orphan rules need every row to tell "induk tidak ada"
  // from "induk nonaktif". Which rows are *reported* is decided by the rules.
  const [unitRead, jabatanRead, lookupRead] = await Promise.all([
    listAllOrgUnits(client, { status: "semua" }),
    listAllJabatan(client, { status: "semua" }),
    listAllLookups(client, { status: "semua", orderBy: "label" }),
  ]);
  const orgUnits = unitRead.rows;
  const jabatan = jabatanRead.rows;
  const lookups = lookupRead.rows;

  const [tanpaUnit, tanpaJabatan] = await Promise.all([
    listEmployeesAll(client, { orgUnitId: null }),
    listEmployeesAll(client, { jabatanId: null }),
  ]);

  const catatan: string[] = [];
  if (!tanpaUnit.lengkap) {
    catatan.push(
      `Menampilkan ${tanpaUnit.rows.length} dari ${tanpaUnit.total} ${TERMS.karyawan} tanpa ${TERMS.unitOrganisasi} — daftar di bawah belum lengkap.`,
    );
  }
  if (!tanpaJabatan.lengkap) {
    catatan.push(
      `Menampilkan ${tanpaJabatan.rows.length} dari ${tanpaJabatan.total} ${TERMS.karyawan} tanpa ${TERMS.jabatan} — daftar di bawah belum lengkap.`,
    );
  }
  for (const [read, label] of [
    [unitRead, TERMS.unitOrganisasi],
    [jabatanRead, TERMS.jabatan],
    [lookupRead, TERMS.lookup],
  ] as const) {
    const peringatan = peringatanTerpotong(read, label);
    if (peringatan) catatan.push(peringatan);
  }

  const namaUnitById = new Map(orgUnits.map((unit) => [unit.id, unit.nama]));

  const unitRows: OrgUnitRow[] = orgUnits.map((unit) => ({
    id: unit.id,
    kode: unit.kode,
    nama: unit.nama,
    tipe: unit.tipe,
    parent_id: unit.parent_id,
    status: unit.status,
  }));

  // One Karyawan missing both references appears in both queries; `id` is the
  // primary key, so a Map de-duplicates without guessing.
  const karyawanRows = new Map<string, EmployeeRow>();
  for (const row of [...tanpaUnit.rows, ...tanpaJabatan.rows]) {
    karyawanRows.set(row.id, {
      id: row.id,
      personnel_number: row.personnel_number,
      full_name: row.full_name,
      org_unit_id: row.org_unit_id,
      jabatan_id: row.jabatan_id,
      status: row.status,
    });
  }

  const unitReferenceRows: ReferenceRow[] = orgUnits.map((unit) => ({
    id: unit.id,
    kode: unit.kode,
    nama: unit.nama,
    status: unit.status,
    keterangan: [
      ORG_UNIT_TYPE_LABELS[unit.tipe as keyof typeof ORG_UNIT_TYPE_LABELS] ?? unit.tipe,
      unit.parent_id ? namaUnitById.get(unit.parent_id) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const jabatanReferenceRows: ReferenceRow[] = jabatan.map((row) => ({
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    status: row.status,
  }));

  const lookupReferenceRows: ReferenceRow[] = lookups.map((row) => ({
    id: row.id,
    kode: row.kode,
    nama: row.label,
    status: row.status,
    tipe: row.tipe,
    keterangan:
      LOOKUP_TYPE_LABELS[row.tipe as keyof typeof LOOKUP_TYPE_LABELS] ?? row.tipe,
  }));

  const semuaNamaMirip: TemuanNamaMirip[] = [
    ...findSimilarNames("org_unit", unitReferenceRows),
    ...findSimilarNames("jabatan", jabatanReferenceRows),
    ...findSimilarNames("lookup", lookupReferenceRows),
  ];
  const unitTanpaInduk = findOrphanOrgUnits(unitRows);
  const semuaSenamaInduk = findUnitsNamedLikeParent(unitRows);
  const karyawanTanpaReferensi = findEmployeesMissingReference([...karyawanRows.values()]);

  // ONE PROBLEM, ONE TEMUAN.
  //
  // A Unit Organisasi named exactly like its induk necessarily folds onto the
  // same similarity key as that induk, so both rules fire on the same pair and
  // the page would list it twice and count it twice. Which card survives
  // depends on which one says more:
  //
  //   * the similar-names group is nothing but that pair → keep the
  //     senama-induk card, which names the relationship and pre-selects the
  //     induk as the Merge target;
  //   * the group is bigger (a third spelling somewhere else in the company)
  //     → keep the group, which shows all of them at once, and drop the
  //     senama-induk card.
  const grupDibuang = new Set<string>();
  const senamaDibuang = new Set<string>();
  for (const grup of semuaNamaMirip) {
    if (grup.entitas !== "org_unit") continue;
    const idGrup = new Set(grup.baris.map((row) => row.id));
    for (const senama of semuaSenamaInduk) {
      if (!idGrup.has(senama.unit.id) || !idGrup.has(senama.induk.id)) continue;
      if (grup.baris.length === 2) grupDibuang.add(grup.id);
      else senamaDibuang.add(senama.id);
    }
  }

  const namaMirip = semuaNamaMirip.filter((grup) => !grupDibuang.has(grup.id));
  const unitSenamaInduk = semuaSenamaInduk.filter(
    (senama) => !senamaDibuang.has(senama.id),
  );

  // Count Karyawan only for the rows a Merge could actually move — that is the
  // number the admin reads right before pressing the button, and counting the
  // whole database to show it would be work nobody sees.
  const unitIds = new Set<string>();
  const jabatanIds = new Set<string>();
  const lookupIdsByTipe = new Map<string, string[]>();

  for (const temuan of namaMirip) {
    for (const row of temuan.baris) {
      if (temuan.entitas === "org_unit") unitIds.add(row.id);
      else if (temuan.entitas === "jabatan") jabatanIds.add(row.id);
      else if (row.tipe) {
        const bucket = lookupIdsByTipe.get(row.tipe);
        if (bucket) bucket.push(row.id);
        else lookupIdsByTipe.set(row.tipe, [row.id]);
      }
    }
  }
  for (const temuan of unitSenamaInduk) {
    unitIds.add(temuan.unit.id);
    unitIds.add(temuan.induk.id);
  }

  const [unitCounts, jabatanCounts, lookupCounts] = await Promise.all([
    countByOrgUnit(client, [...unitIds]),
    countByJabatan(client, [...jabatanIds]),
    countByLookup(client, lookupIdsByTipe),
  ]);

  const jumlahKaryawan: Record<string, number> = {};
  for (const [id, jumlah] of [...unitCounts, ...jabatanCounts, ...lookupCounts]) {
    jumlahKaryawan[id] = jumlah;
  }

  // Merge targets. Only built for the kinds that actually have a Temuan: a
  // viewer looking at an empty page should not be shipped every Jabatan in the
  // company to populate a dialog they cannot open.
  const perluUnit = namaMirip.some((t) => t.entitas === "org_unit") || unitSenamaInduk.length > 0;
  const perluJabatan = namaMirip.some((t) => t.entitas === "jabatan");
  const tipeLookupPerlu = new Set(
    namaMirip.filter((t) => t.entitas === "lookup").map((t) => t.tipe ?? ""),
  );

  const kandidatLookup: Record<string, EntityOption[]> = {};
  for (const tipe of tipeLookupPerlu) {
    if (!tipe) continue;
    kandidatLookup[tipe] = toLookupOptions(
      lookups.filter((row) => row.tipe === tipe && row.status === "aktif"),
    );
  }

  const temuan: Temuan[] = [
    ...namaMirip,
    ...unitSenamaInduk,
    ...unitTanpaInduk,
    ...karyawanTanpaReferensi,
  ];

  return {
    temuan,
    ringkasan: {
      nama_mirip: namaMirip.length,
      unit_senama_induk: unitSenamaInduk.length,
      unit_tanpa_induk: unitTanpaInduk.length,
      karyawan_tanpa_referensi: karyawanTanpaReferensi.length,
    },
    total: temuan.length,
    kandidat: {
      org_unit: perluUnit
        ? toOrgUnitOptions(
            orgUnits.filter((row) => row.status === "aktif"),
            ORG_UNIT_TYPE_LABELS,
          )
        : [],
      jabatan: perluJabatan
        ? toJabatanOptions(jabatan.filter((row) => row.status === "aktif"))
        : [],
      lookup: kandidatLookup,
    },
    jumlahKaryawan,
    catatan,
  };
}
