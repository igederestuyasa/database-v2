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
import {
  toJabatanOptions,
  toLookupOptions,
  toOrgUnitOptions,
  type EntityOption,
} from "@/components/shared/EntityPicker";
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
import { listEmployees } from "@/lib/db/employees";
import { listAllJabatan } from "@/lib/db/jabatan";
import { listAllLookups } from "@/lib/db/lookups";
import { listAllOrgUnits } from "@/lib/db/orgUnits";
import { DbError, type DbClient } from "@/lib/db/shared";
import { ORG_UNIT_TYPE_LABELS } from "@/lib/i18n/terms";
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
  /** `id` → how many aktif Karyawan point at it. Feeds "… akan dipindahkan". */
  jumlahKaryawan: Record<string, number>;
  /** Anything the page must admit it could not show in full. */
  catatan: string[];
};

/**
 * How many Karyawan to read per "tanpa referensi" query.
 *
 * `lib/db/shared.ts` caps a page at 500. If there are more than that, the page
 * says so rather than quietly showing a prefix — the whole point of this page
 * is knowing how much is left.
 */
const MAX_KARYAWAN = 500;

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
 * Refuse a truncated tally.
 *
 * PostgREST answers `count: "exact"` with the number of matching rows even
 * when it returns fewer of them, so the two disagreeing is exactly the signal
 * that something capped the result. Failing here is deliberate: the number
 * this feeds is read immediately before a Merge that moves people, and a
 * silently low one would be worse than no page at all (same reasoning as
 * `getOrgUnitDescendantIds()` in `lib/db/orgUnits.ts`).
 */
function assertLengkap(count: number | null, diterima: number): void {
  if ((count ?? diterima) > diterima) {
    throw new Error(
      `Jumlah Karyawan yang dibaca terpotong (${diterima} dari ${count}); hitungan "akan dipindahkan" tidak bisa dipercaya. Tambahkan pagination sebelum melanjutkan.`,
    );
  }
}

/**
 * Count Karyawan per `employees.org_unit_id`, for the ids given.
 *
 * One read per chunk of ids and a tally in memory, rather than one `count`
 * request per candidate: a first cleanup pass can have hundreds of candidates,
 * and that would be hundreds of round trips for one page render.
 *
 * **Every status is counted, not just aktif.** `merge_org_unit` moves rows with
 * `where org_unit_id = p_source` and no status predicate
 * (`0002_batch_operations.sql`), so a count that skipped nonaktif Karyawan
 * would promise to move fewer people than the Merge actually moves.
 *
 * Ids with no Karyawan are seeded to `0`, so "0 Karyawan" — the safest merge
 * there is — reads differently from "not counted".
 */
async function countByOrgUnit(
  client: DbClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const chunk of chunked(ids)) {
    const { data, count, error } = await client
      .from("employees")
      .select("org_unit_id", { count: "exact" })
      .in("org_unit_id", chunk)
      .range(0, MAX_COUNT_ROWS - 1);
    if (error) throw new DbError("Gagal menghitung Karyawan per Unit Organisasi", error);

    const rows = data ?? [];
    assertLengkap(count, rows.length);
    for (const row of rows) {
      const id = row.org_unit_id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** The same tally for `employees.jabatan_id`. */
async function countByJabatan(
  client: DbClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const chunk of chunked(ids)) {
    const { data, count, error } = await client
      .from("employees")
      .select("jabatan_id", { count: "exact" })
      .in("jabatan_id", chunk)
      .range(0, MAX_COUNT_ROWS - 1);
    if (error) throw new DbError("Gagal menghitung Karyawan per Jabatan", error);

    const rows = data ?? [];
    assertLengkap(count, rows.length);
    for (const row of rows) {
      const id = row.jabatan_id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The same tally for Lookup, one query per tipe involved.
 *
 * The `employees` column is chosen by tipe through the frozen
 * `LOOKUP_TYPE_TO_EMPLOYEE_COLUMN` map — never from anything a caller typed —
 * so this can only ever reach the column that tipe owns.
 */
async function countByLookup(
  client: DbClient,
  idsByTipe: Map<string, string[]>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const [tipe, ids] of idsByTipe) {
    if (!isLookupType(tipe) || ids.length === 0) continue;
    const column = LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[tipe];
    for (const id of ids) counts.set(id, 0);

    for (const chunk of chunked(ids)) {
      // hc-check-columns-ignore — `column` comes from the frozen tipe→kolom map.
      const { data, count, error } = await client
        .from("employees")
        .select(column, { count: "exact" })
        .in(column, chunk)
        .range(0, MAX_COUNT_ROWS - 1);
      if (error) throw new DbError("Gagal menghitung Karyawan per Lookup", error);

      const rows = (data ?? []) as unknown as Record<string, string | null>[];
      assertLengkap(count, rows.length);
      for (const row of rows) {
        const id = row[column];
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Read everything, run the rules, and shape the page's props. */
export async function loadBereskan(client: DbClient): Promise<BereskanData> {
  // Status "semua": the orphan rules need every row to tell "induk tidak ada"
  // from "induk nonaktif". Which rows are *reported* is decided by the rules.
  const [orgUnits, jabatan, lookups] = await Promise.all([
    listAllOrgUnits(client, { status: "semua" }),
    listAllJabatan(client, { status: "semua" }),
    listAllLookups(client, { status: "semua", orderBy: "label" }),
  ]);

  const [tanpaUnit, tanpaJabatan] = await Promise.all([
    listEmployees(client, {
      orgUnitId: null,
      status: "aktif",
      perPage: MAX_KARYAWAN,
      orderBy: "full_name",
    }),
    listEmployees(client, {
      jabatanId: null,
      status: "aktif",
      perPage: MAX_KARYAWAN,
      orderBy: "full_name",
    }),
  ]);

  const catatan: string[] = [];
  if (tanpaUnit.total > tanpaUnit.rows.length) {
    catatan.push(
      `Menampilkan ${tanpaUnit.rows.length} dari ${tanpaUnit.total} Karyawan tanpa Unit Organisasi.`,
    );
  }
  if (tanpaJabatan.total > tanpaJabatan.rows.length) {
    catatan.push(
      `Menampilkan ${tanpaJabatan.rows.length} dari ${tanpaJabatan.total} Karyawan tanpa Jabatan.`,
    );
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
