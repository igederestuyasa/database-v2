/**
 * The pure rules behind the `/struktur` tree: what stays visible, what folds
 * away, and what a Merge would sweep up.
 *
 * All four functions are pure and cycle-safe on purpose — seed data arrives
 * dirty (CLAUDE.md), and the one thing the tree must never do is hang or make
 * a unit disappear. Newly collectable now that `vitest.config.ts` includes
 * `components/**`.
 *
 * Fixture-shaped dummy data only; no real Unit Organisasi name (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";

import {
  collapseStrukturNodes,
  filterStrukturNodes,
  isYatim,
  subtreeIds,
  type StrukturNode,
} from "./strukturNodes";

function node(
  id: string,
  nama: string,
  depth: number,
  parentId: string | null,
  extra: Partial<StrukturNode> = {},
): StrukturNode {
  return {
    id,
    kode: id.toUpperCase(),
    tipe: "bagian",
    nama,
    parentId,
    status: "aktif",
    mergedIntoId: null,
    mergedIntoNama: null,
    depth,
    karyawanAktifLangsung: 0,
    karyawanAktifTotal: 0,
    karyawanPindahSaatMerge: 0,
    ...extra,
  };
}

/**
 * dir
 * ├── div
 * │   ├── bag   (nonaktif)
 * │   │   └── sub
 * │   └── pry
 * └── (yatim, tanpa induk, bukan direktorat)
 */
const POHON: StrukturNode[] = [
  node("dir", "Direktorat Contoh", 0, null, { tipe: "direktorat" }),
  node("div", "Divisi Contoh", 1, "dir", { tipe: "divisi" }),
  node("bag", "Bagian Contoh", 2, "div", { status: "nonaktif" }),
  node("sub", "Sub Bagian Contoh", 3, "bag", { tipe: "sub_bagian" }),
  node("pry", "Proyek Contoh", 2, "div", { tipe: "proyek" }),
  node("yatim", "Bagian Tanpa Induk", 0, null),
];

const ids = (nodes: readonly StrukturNode[]) => nodes.map((n) => n.id);

const SEMUA = { query: "", tampilkanNonaktif: true };

describe("isYatim", () => {
  it("menandai unit tanpa induk yang bukan Direktorat", () => {
    expect(isYatim(POHON[5])).toBe(true);
  });

  it("tidak menandai Direktorat, yang memang akar", () => {
    expect(isYatim(POHON[0])).toBe(false);
  });

  it("tidak menandai unit yang punya induk", () => {
    expect(isYatim(POHON[1])).toBe(false);
  });
});

describe("filterStrukturNodes", () => {
  it("tanpa filter mengembalikan semuanya, urutan pre-order utuh", () => {
    expect(ids(filterStrukturNodes(POHON, SEMUA))).toEqual(ids(POHON));
  });

  it("menyembunyikan unit nonaktif yang tidak menaungi apa-apa", () => {
    const pohon = [...POHON, node("mati", "Bagian Nonaktif", 2, "div", {
      status: "nonaktif",
    })];
    const hasil = filterStrukturNodes(pohon, { query: "", tampilkanNonaktif: false });
    expect(ids(hasil)).not.toContain("mati");
  });

  it("tetap menampilkan induk nonaktif yang masih menaungi unit aktif", () => {
    // `bag` nonaktif tapi `sub` di bawahnya aktif: menyembunyikan `bag` akan
    // ikut membawa `sub` keluar dari pohon, dan itu menyembunyikan data.
    const hasil = filterStrukturNodes(POHON, { query: "", tampilkanNonaktif: false });
    expect(ids(hasil)).toContain("bag");
    expect(ids(hasil)).toContain("sub");
  });

  it("menahan induk nonaktif selama ada turunan aktif di bawahnya", () => {
    // Kalau `bag` ikut hilang, `sub` akan tergantung di depth 3 tanpa induk —
    // menggambar hierarki yang tidak ada.
    const hasil = filterStrukturNodes(POHON, { query: "sub", tampilkanNonaktif: false });
    expect(ids(hasil)).toEqual(["dir", "div", "bag", "sub"]);
  });

  it("mempertahankan semua leluhur dari yang cocok", () => {
    const hasil = filterStrukturNodes(POHON, { query: "Proyek", tampilkanNonaktif: true });
    expect(ids(hasil)).toEqual(["dir", "div", "pry"]);
  });

  it("mencari di nama maupun kode, tanpa peduli besar kecil huruf", () => {
    expect(ids(filterStrukturNodes(POHON, { query: "pry", tampilkanNonaktif: true })))
      .toContain("pry");
    expect(ids(filterStrukturNodes(POHON, { query: "DIVISI", tampilkanNonaktif: true })))
      .toContain("div");
  });

  it("tidak pernah menulis ulang depth, supaya indentasi tetap bermakna", () => {
    const hasil = filterStrukturNodes(POHON, { query: "sub", tampilkanNonaktif: true });
    expect(hasil.map((n) => n.depth)).toEqual([0, 1, 2, 3]);
  });

  it("mengembalikan daftar kosong kalau tidak ada yang cocok", () => {
    expect(filterStrukturNodes(POHON, { query: "zzz", tampilkanNonaktif: true })).toEqual(
      [],
    );
  });

  it("tidak menggantung kalau data mengandung siklus", () => {
    const a = node("a", "A", 0, "b");
    const b = node("b", "B", 0, "a");
    expect(ids(filterStrukturNodes([a, b], { query: "A", tampilkanNonaktif: true })))
      .toEqual(["a", "b"]);
  });
});

describe("collapseStrukturNodes", () => {
  it("tanpa yang dilipat, semuanya tetap tampil", () => {
    expect(ids(collapseStrukturNodes(POHON, new Set()))).toEqual(ids(POHON));
  });

  it("melipat satu unit menyembunyikan seluruh turunannya", () => {
    const hasil = collapseStrukturNodes(POHON, new Set(["div"]));
    expect(ids(hasil)).toEqual(["dir", "div", "yatim"]);
  });

  it("unit yang dilipat tetap tampil, hanya isinya yang hilang", () => {
    const hasil = collapseStrukturNodes(POHON, new Set(["bag"]));
    expect(ids(hasil)).toEqual(["dir", "div", "bag", "pry", "yatim"]);
  });

  it("melipat akar menyembunyikan satu cabang, bukan seluruh pohon", () => {
    const hasil = collapseStrukturNodes(POHON, new Set(["dir"]));
    expect(ids(hasil)).toEqual(["dir", "yatim"]);
  });
});

describe("subtreeIds", () => {
  it("selalu memuat akarnya sendiri", () => {
    expect([...subtreeIds(POHON, "sub")]).toEqual(["sub"]);
  });

  it("mengumpulkan seluruh turunan, berapa pun dalamnya", () => {
    expect([...subtreeIds(POHON, "div")].sort()).toEqual(["bag", "div", "pry", "sub"]);
  });

  it("id yang tidak ada mengembalikan dirinya sendiri, bukan melempar", () => {
    expect([...subtreeIds(POHON, "tidak-ada")]).toEqual(["tidak-ada"]);
  });

  it("tidak menggantung pada siklus", () => {
    const a = node("a", "A", 0, "b");
    const b = node("b", "B", 0, "a");
    expect([...subtreeIds([a, b], "a")].sort()).toEqual(["a", "b"]);
  });
});
