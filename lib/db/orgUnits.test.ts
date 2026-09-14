/**
 * The pure hierarchy helpers: tree, descendants, ancestor path.
 *
 * `/struktur` draws the whole hierarchy from one flat read, and the Karyawan
 * filter "Divisi X, termasuk unit di bawahnya" is built on `collectDescendantIds`.
 * Both are plain functions over rows, so both are tested here — including the
 * dirty cases the seed really produces (an induk that is not in the set) and
 * the cycle the database refuses but the UI must never hang on.
 */
import { describe, expect, it } from "vitest";

import { ORG_UNITS } from "@/fixtures/referensi";
import { ORG_UNIT_ID } from "@/fixtures/ids";

import {
  buildAncestorPath,
  buildOrgUnitTree,
  collectDescendantIds,
  flattenOrgUnitTree,
} from "./orgUnits";

describe("buildOrgUnitTree", () => {
  const tree = buildOrgUnitTree(ORG_UNITS);

  it("mengangkat direktorat sebagai akar", () => {
    const direktorat = tree.find((node) => node.id === ORG_UNIT_ID.direktorat);
    expect(direktorat).toBeDefined();
    expect(direktorat?.depth).toBe(0);
  });

  it("menyusun rantai direktorat → divisi → departemen → bagian → sub bagian", () => {
    const flat = flattenOrgUnitTree(tree);
    const depth = (id: string) => flat.find((node) => node.id === id)?.depth;
    expect(depth(ORG_UNIT_ID.direktorat)).toBe(0);
    expect(depth(ORG_UNIT_ID.divisi)).toBe(1);
    expect(depth(ORG_UNIT_ID.departemen)).toBe(2);
    expect(depth(ORG_UNIT_ID.bagian)).toBe(3);
    expect(depth(ORG_UNIT_ID.subBagian)).toBe(4);
  });

  it("menempatkan proyek sebagai anak divisi, bukan tipe tersendiri", () => {
    const flat = flattenOrgUnitTree(tree);
    const proyek = flat.find((node) => node.id === ORG_UNIT_ID.proyek);
    expect(proyek?.depth).toBe(2);
  });

  it("unit tanpa induk yang dikenal tetap muncul sebagai akar, tidak hilang", () => {
    expect(tree.some((node) => node.id === ORG_UNIT_ID.yatim)).toBe(true);
    expect(flattenOrgUnitTree(tree)).toHaveLength(ORG_UNITS.length);
  });

  it("tidak mengubah baris yang diberikan", () => {
    const salinan = JSON.parse(JSON.stringify(ORG_UNITS));
    buildOrgUnitTree(ORG_UNITS);
    expect(ORG_UNITS).toEqual(salinan);
  });

  it("tidak menggantung — dan tidak menghilangkan unit — kalau data mengandung siklus", () => {
    const a = { ...ORG_UNITS[0], id: "a", parent_id: "b" };
    const b = { ...ORG_UNITS[0], id: "b", parent_id: "a" };
    const roots = buildOrgUnitTree([a, b]);
    // Siklus ditolak database, tapi kalau toh ada: keduanya tetap muncul,
    // salah satunya dipromosikan jadi akar. Hilang dari /struktur lebih buruk
    // daripada tampil sebagai Temuan.
    expect(flattenOrgUnitTree(roots).map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(roots).toHaveLength(1);
  });

  it("menolak baris yang menjadi induk dirinya sendiri dengan menjadikannya akar", () => {
    const sendiri = { ...ORG_UNITS[0], id: "x", parent_id: "x" };
    expect(buildOrgUnitTree([sendiri]).map((node) => node.id)).toEqual(["x"]);
  });
});

describe("collectDescendantIds", () => {
  it("selalu memuat akarnya sendiri lebih dulu", () => {
    const ids = collectDescendantIds(ORG_UNITS, ORG_UNIT_ID.subBagian);
    expect(ids[0]).toBe(ORG_UNIT_ID.subBagian);
    expect(ids).toHaveLength(1);
  });

  it("mengumpulkan seluruh cabang di bawah sebuah divisi", () => {
    const ids = collectDescendantIds(ORG_UNITS, ORG_UNIT_ID.divisi);
    expect(ids).toContain(ORG_UNIT_ID.divisi);
    expect(ids).toContain(ORG_UNIT_ID.departemen);
    expect(ids).toContain(ORG_UNIT_ID.bagian);
    expect(ids).toContain(ORG_UNIT_ID.subBagian);
    expect(ids).toContain(ORG_UNIT_ID.proyek);
    expect(ids).not.toContain(ORG_UNIT_ID.direktorat);
  });

  it("id yang tidak ada menghasilkan dirinya sendiri, bukan daftar kosong", () => {
    expect(collectDescendantIds(ORG_UNITS, "tidak-ada")).toEqual(["tidak-ada"]);
  });

  it("tidak menggantung pada siklus", () => {
    const rows = [
      { id: "a", parent_id: "b" },
      { id: "b", parent_id: "a" },
    ];
    expect(collectDescendantIds(rows, "a").sort()).toEqual(["a", "b"]);
  });
});

describe("buildAncestorPath", () => {
  it("mengembalikan jalur dari akar sampai unit itu sendiri", () => {
    const path = buildAncestorPath(ORG_UNITS, ORG_UNIT_ID.subBagian);
    expect(path.map((unit) => unit.id)).toEqual([
      ORG_UNIT_ID.direktorat,
      ORG_UNIT_ID.divisi,
      ORG_UNIT_ID.departemen,
      ORG_UNIT_ID.bagian,
      ORG_UNIT_ID.subBagian,
    ]);
  });

  it("berhenti di unit terakhir yang dikenal kalau induknya hilang", () => {
    const path = buildAncestorPath(ORG_UNITS, ORG_UNIT_ID.yatim);
    expect(path.map((unit) => unit.id)).toEqual([ORG_UNIT_ID.yatim]);
  });

  it("id yang tidak ada menghasilkan jalur kosong", () => {
    expect(buildAncestorPath(ORG_UNITS, "tidak-ada")).toEqual([]);
  });
});
