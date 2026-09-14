/**
 * THE TEST THIS DEFECT DIED FOR.
 *
 * `listAllJabatan`, `listAllLookups` and `listAllOrgUnits` used to ask for
 * `MAX + 1` rows and then guard with `if (rows.length > MAX) throw`. That guard
 * could never fire: PostgREST applies its own `db-max-rows` (1000 on a stock
 * Supabase project) **before** the client's `.limit()`, and reports the capped
 * response as a plain success — 200, a short array, no error. So `rows.length`
 * was capped at 1000 and could never exceed 5000, and a truncated read sailed
 * through looking complete: a short picker, a short tree, and — worst — a short
 * list of Merge targets, with nobody told.
 *
 * It survived review because it *reads* like protection, and it survived
 * testing because nothing tested it. That is what this file is for: a response
 * whose array is shorter than its `count` is exactly the shape of a capped
 * read, and every unpaginated read must either report it or refuse to answer.
 *
 * The behaviour being pinned here is DOCUMENTED PostgREST behaviour, not
 * observed: `supabase.com` is blocked from this environment (403, ADR-005), so
 * the cap cannot be reproduced against a live server. Hence a fake client that
 * produces the shape the documentation describes.
 */
import { describe, expect, it } from "vitest";

import { JABATAN, LOOKUPS, ORG_UNITS, ORG_UNIT_ID } from "@/fixtures";

import { listAllJabatan } from "./jabatan";
import { getLookupsGroupedByType, listAllLookups, listLookupsByType } from "./lookups";
import {
  getOrgUnitAncestors,
  getOrgUnitDescendantIds,
  getOrgUnitTree,
  listAllOrgUnits,
} from "./orgUnits";
import { IncompleteReadError, requireComplete, toFullRead, type DbClient } from "./shared";

type SelectCall = { columns: string; options: { count?: string; head?: boolean } | undefined };

type Recorder = {
  selects: SelectCall[];
  limits: number[];
};

/**
 * The smallest thing that behaves like a PostgREST query for these reads.
 *
 * Every filter helper returns the same object, and the object is thenable, so
 * `await query` after any chain resolves to the response handed in here. What
 * matters is only that `data` and `count` can disagree — which is what a capped
 * read looks like from the client side.
 */
function fakeClient(
  response: { rows: unknown[]; count: number | null },
  recorder: Recorder = { selects: [], limits: [] },
): { client: DbClient; recorder: Recorder } {
  const builder: Record<string, unknown> = {};
  const self = () => builder;

  for (const method of ["order", "eq", "in", "is", "or", "range", "maybeSingle"]) {
    builder[method] = self;
  }
  builder.select = (columns: string, options?: { count?: string; head?: boolean }) => {
    recorder.selects.push({ columns, options });
    return builder;
  };
  builder.limit = (value: number) => {
    recorder.limits.push(value);
    return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: response.rows, error: null, count: response.count }).then(
      resolve,
    );

  const client = { from: () => builder } as unknown as DbClient;
  return { client, recorder };
}

/** `count` says 1200; the server handed back the first 1000. */
function capped<T>(rows: readonly T[], total: number) {
  return { rows: [...rows], count: total };
}

/** Everything that matches arrived. */
function utuh<T>(rows: readonly T[]) {
  return { rows: [...rows], count: rows.length };
}

describe("toFullRead / requireComplete", () => {
  it("menandai truncated ketika baris yang datang lebih sedikit dari count", () => {
    expect(toFullRead([1, 2, 3], 1200)).toEqual({
      rows: [1, 2, 3],
      total: 1200,
      truncated: true,
    });
  });

  it("tidak menandai truncated ketika jumlahnya cocok", () => {
    expect(toFullRead([1, 2, 3], 3).truncated).toBe(false);
  });

  it("count yang tidak dikirim server tidak dianggap bukti pemotongan", () => {
    expect(toFullRead([1, 2], null)).toEqual({ rows: [1, 2], total: 2, truncated: false });
  });

  it("requireComplete melempar IncompleteReadError, dengan angkanya", () => {
    const read = toFullRead([1, 2, 3], 1200);
    expect(() => requireComplete(read, "Unit Organisasi")).toThrow(IncompleteReadError);
    try {
      requireComplete(read, "Unit Organisasi");
      expect.unreachable("seharusnya melempar");
    } catch (error) {
      const incomplete = error as IncompleteReadError;
      expect(incomplete.received).toBe(3);
      expect(incomplete.total).toBe(1200);
      expect(incomplete.message).toContain("3 dari 1200 Unit Organisasi");
      // Bukan DbError: tidak ada yang gagal, jawabannya yang tidak lengkap.
      expect(incomplete.name).toBe("IncompleteReadError");
    }
  });

  it("requireComplete meneruskan baris apa adanya kalau utuh", () => {
    expect(requireComplete(toFullRead([1, 2], 2), "Jabatan")).toEqual([1, 2]);
  });
});

describe("listAllJabatan", () => {
  it("TIDAK melaporkan sukses diam-diam saat jawabannya terpotong", async () => {
    const { client } = fakeClient(capped(JABATAN, 1200));
    const read = await listAllJabatan(client);

    expect(read.truncated).toBe(true);
    expect(read.total).toBe(1200);
    expect(read.rows).toHaveLength(JABATAN.length);
  });

  it("meminta count: \"exact\" pada query yang sama — bukan query kedua", async () => {
    const { client, recorder } = fakeClient(utuh(JABATAN));
    await listAllJabatan(client);

    expect(recorder.selects).toHaveLength(1);
    expect(recorder.selects[0].options).toEqual({ count: "exact" });
  });

  it("tidak lagi meminta MAX + 1 baris — plafonnya bukan lagi alat deteksi", async () => {
    const { client, recorder } = fakeClient(utuh(JABATAN));
    await listAllJabatan(client);

    expect(recorder.limits).toEqual([5000]);
  });

  it("bacaan utuh tidak ditandai apa-apa", async () => {
    const { client } = fakeClient(utuh(JABATAN));
    const read = await listAllJabatan(client);

    expect(read.truncated).toBe(false);
    expect(read.total).toBe(JABATAN.length);
  });
});

describe("listAllLookups", () => {
  it("melaporkan pemotongan, bukan daftar pendek yang tampak normal", async () => {
    const { client } = fakeClient(capped(LOOKUPS, 4321));
    const read = await listAllLookups(client);

    expect(read.truncated).toBe(true);
    expect(read.total).toBe(4321);
  });

  it("listLookupsByType ikut membawa sinyalnya ke pemanggil", async () => {
    const { client } = fakeClient(capped(LOOKUPS, 4321));
    const read = await listLookupsByType(client, "job_grade");

    expect(read.truncated).toBe(true);
  });

  it("getLookupsGroupedByType mengelompokkan TANPA menelan sinyalnya", async () => {
    const { client } = fakeClient(capped(LOOKUPS, 4321));
    const grouped = await getLookupsGroupedByType(client);

    expect(grouped.truncated).toBe(true);
    expect(grouped.total).toBe(4321);
    // Semua 11 tipe tetap ada sebagai kunci, meski isinya kosong.
    expect(Object.keys(grouped.byType)).toHaveLength(11);
    expect(grouped.byType.gender.length + grouped.byType.job_grade.length).toBeGreaterThan(
      0,
    );
  });
});

describe("listAllOrgUnits", () => {
  it("melaporkan pemotongan — pohon yang terpotong menggambar hierarki palsu", async () => {
    const { client } = fakeClient(capped(ORG_UNITS, 1500));
    const read = await listAllOrgUnits(client, { status: "semua" });

    expect(read.truncated).toBe(true);
    expect(read.total).toBe(1500);
    expect(read.rows).toHaveLength(ORG_UNITS.length);
  });

  it("meminta count: \"exact\" pada query yang sama", async () => {
    const { client, recorder } = fakeClient(utuh(ORG_UNITS));
    await listAllOrgUnits(client);

    expect(recorder.selects[0].options).toEqual({ count: "exact" });
    expect(recorder.limits).toEqual([5000]);
  });

  it("getOrgUnitTree tetap membangun pohonnya, tapi ikut menandai potongannya", async () => {
    const { client } = fakeClient(capped(ORG_UNITS, 1500));
    const read = await getOrgUnitTree(client, { status: "semua" });

    expect(read.truncated).toBe(true);
    expect(read.tree.length).toBeGreaterThan(0);
    expect(read.tree.every((node) => node.depth === 0)).toBe(true);
  });

  it("getOrgUnitTree menjaga arti rows/total: baris, bukan akar pohon", async () => {
    // Kalau `rows` diisi akar pohon, `rows.length < total` akan selalu benar
    // dan setiap pemanggil yang menghitung sendiri akan memasang peringatan
    // "belum lengkap" pada data yang sehat.
    const { client } = fakeClient(utuh(ORG_UNITS));
    const read = await getOrgUnitTree(client, { status: "semua" });

    expect(read.rows).toHaveLength(ORG_UNITS.length);
    expect(read.total).toBe(ORG_UNITS.length);
    expect(read.truncated).toBe(false);
    expect(read.tree.length).toBeLessThan(read.rows.length);
  });
});

describe("pembacaan yang tidak boleh menjawab separuh", () => {
  it("getOrgUnitDescendantIds MELEMPAR saat terpotong — angkanya dibaca sebelum Merge", async () => {
    const { client } = fakeClient(capped(ORG_UNITS, 1500));

    await expect(
      getOrgUnitDescendantIds(client, ORG_UNIT_ID.divisi),
    ).rejects.toBeInstanceOf(IncompleteReadError);
  });

  it("getOrgUnitDescendantIds meminta count — tanpa itu tidak ada yang bisa dibandingkan", async () => {
    const { client, recorder } = fakeClient(utuh(ORG_UNITS));
    await getOrgUnitDescendantIds(client, ORG_UNIT_ID.divisi);

    expect(recorder.selects[0]).toEqual({
      columns: "id, parent_id",
      options: { count: "exact" },
    });
  });

  it("getOrgUnitDescendantIds mengembalikan subtree lengkap saat bacaannya utuh", async () => {
    const { client } = fakeClient(utuh(ORG_UNITS));
    const ids = await getOrgUnitDescendantIds(client, ORG_UNIT_ID.divisi);

    expect(ids[0]).toBe(ORG_UNIT_ID.divisi);
    expect(ids).toContain(ORG_UNIT_ID.bagian);
    expect(ids).toContain(ORG_UNIT_ID.subBagian);
  });

  it("getOrgUnitAncestors MELEMPAR saat terpotong — breadcrumb pendek adalah tempat lain", async () => {
    const { client } = fakeClient(capped(ORG_UNITS, 1500));

    await expect(
      getOrgUnitAncestors(client, ORG_UNIT_ID.subBagian),
    ).rejects.toBeInstanceOf(IncompleteReadError);
  });

  it("getOrgUnitAncestors menyusun jalur lengkap saat bacaannya utuh", async () => {
    const { client } = fakeClient(utuh(ORG_UNITS));
    const path = await getOrgUnitAncestors(client, ORG_UNIT_ID.subBagian);

    expect(path.map((unit) => unit.id)).toEqual([
      ORG_UNIT_ID.direktorat,
      ORG_UNIT_ID.divisi,
      ORG_UNIT_ID.departemen,
      ORG_UNIT_ID.bagian,
      ORG_UNIT_ID.subBagian,
    ]);
  });
});
