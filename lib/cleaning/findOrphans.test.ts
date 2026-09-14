/**
 * Tests for `lib/cleaning/findOrphans.ts`.
 *
 * These rules stand in for constraints the database deliberately does not
 * have (ARCHITECTURE.md §3), so this file is where "NULL parent_id is only
 * legitimate for a direktorat" is actually enforced. If it stops holding,
 * nothing throws — the Temuan simply stops appearing.
 *
 * DUMMY DATA ONLY (CLAUDE.md). The `fixtures/` set is reused where it fits;
 * it already carries a deliberately orphaned unit.
 */
import { describe, expect, it } from "vitest";

import { ORG_UNITS } from "@/fixtures/referensi";
import { ORG_UNIT_ID } from "@/fixtures/ids";

import {
  findEmployeesMissingReference,
  findOrphanOrgUnits,
  findUnitsNamedLikeParent,
  type EmployeeRow,
  type OrgUnitRow,
} from "./findOrphans";

function unit(over: Partial<OrgUnitRow> & { id: string }): OrgUnitRow {
  return {
    kode: over.id.toUpperCase(),
    nama: `Unit ${over.id}`,
    tipe: "bagian",
    parent_id: null,
    status: "aktif",
    ...over,
  };
}

function karyawan(over: Partial<EmployeeRow> & { id: string }): EmployeeRow {
  return {
    personnel_number: `PN-${over.id}`,
    full_name: `Nama Contoh ${over.id}`,
    org_unit_id: "unit-1",
    jabatan_id: "jabatan-1",
    status: "aktif",
    ...over,
  };
}

describe("findOrphanOrgUnits", () => {
  it("tidak menuduh direktorat yang memang tidak punya induk", () => {
    expect(
      findOrphanOrgUnits([unit({ id: "d1", tipe: "direktorat", parent_id: null })]),
    ).toEqual([]);
  });

  it("melaporkan non-direktorat yang parent_id-nya NULL", () => {
    const temuan = findOrphanOrgUnits([
      unit({ id: "d1", tipe: "direktorat" }),
      unit({ id: "b1", tipe: "bagian", parent_id: null }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].unit.id).toBe("b1");
    expect(temuan[0].alasan).toBe("tanpa_induk");
  });

  it("melaporkan induk yang tidak ada di tabel", () => {
    const temuan = findOrphanOrgUnits([
      unit({ id: "b1", tipe: "bagian", parent_id: "tidak-ada" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].alasan).toBe("induk_hilang");
    expect(temuan[0].indukId).toBe("tidak-ada");
  });

  it("melaporkan unit yang menjadi induk dirinya sendiri", () => {
    const temuan = findOrphanOrgUnits([unit({ id: "b1", parent_id: "b1" })]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].alasan).toBe("induk_hilang");
  });

  it("melaporkan induk yang sudah nonaktif", () => {
    const temuan = findOrphanOrgUnits([
      unit({ id: "d1", tipe: "divisi", parent_id: "dir", status: "nonaktif" }),
      unit({ id: "dir", tipe: "direktorat" }),
      unit({ id: "b1", tipe: "bagian", parent_id: "d1" }),
    ]);

    expect(temuan.map((t) => t.unit.id)).toEqual(["b1"]);
    expect(temuan[0].alasan).toBe("induk_nonaktif");
  });

  it("tidak melaporkan unit yang induknya ada dan aktif", () => {
    expect(
      findOrphanOrgUnits([
        unit({ id: "d1", tipe: "direktorat" }),
        unit({ id: "b1", tipe: "bagian", parent_id: "d1" }),
      ]),
    ).toEqual([]);
  });

  it("melewati unit nonaktif secara default", () => {
    const rows = [unit({ id: "b1", tipe: "bagian", parent_id: null, status: "nonaktif" })];

    expect(findOrphanOrgUnits(rows)).toEqual([]);
    expect(findOrphanOrgUnits(rows, { includeNonaktif: true })).toHaveLength(1);
  });

  it("menemukan unit yatim di fixture bersama", () => {
    // fixtures/referensi.ts sengaja menaruh satu unit ber-induk yang tidak ada.
    const temuan = findOrphanOrgUnits(ORG_UNITS);

    expect(temuan.map((t) => t.unit.id)).toEqual([ORG_UNIT_ID.yatim]);
    expect(temuan[0].alasan).toBe("induk_hilang");
  });

  it("mengurutkan menurut nama", () => {
    const temuan = findOrphanOrgUnits([
      unit({ id: "b2", nama: "Bagian Zeta", parent_id: null }),
      unit({ id: "b1", nama: "Bagian Alfa", parent_id: null }),
    ]);

    expect(temuan.map((t) => t.unit.nama)).toEqual(["Bagian Alfa", "Bagian Zeta"]);
  });
});

describe("findUnitsNamedLikeParent", () => {
  it("melaporkan sub bagian yang namanya sama dengan induknya", () => {
    const temuan = findUnitsNamedLikeParent([
      unit({ id: "b1", tipe: "bagian", nama: "Bagian Contoh" }),
      unit({ id: "s1", tipe: "sub_bagian", nama: "Bagian Contoh", parent_id: "b1" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].unit.id).toBe("s1");
    expect(temuan[0].induk.id).toBe("b1");
  });

  it("membandingkan lewat normalisasi, bukan persis huruf per huruf", () => {
    const temuan = findUnitsNamedLikeParent([
      unit({ id: "b1", nama: "Bagian Contoh" }),
      unit({ id: "s1", nama: "  BAGIAN   CONTOH ", parent_id: "b1" }),
    ]);

    expect(temuan).toHaveLength(1);
  });

  it("tidak melaporkan anak yang namanya berbeda", () => {
    expect(
      findUnitsNamedLikeParent([
        unit({ id: "b1", nama: "Bagian Contoh" }),
        unit({ id: "s1", nama: "Sub Bagian Contoh", parent_id: "b1" }),
      ]),
    ).toEqual([]);
  });

  it("tidak melaporkan dua kali kalau induknya nonaktif", () => {
    // Kasus itu sudah jadi Temuan 'induk_nonaktif' di findOrphanOrgUnits.
    expect(
      findUnitsNamedLikeParent([
        unit({ id: "b1", nama: "Bagian Contoh", status: "nonaktif" }),
        unit({ id: "s1", nama: "Bagian Contoh", parent_id: "b1" }),
      ]),
    ).toEqual([]);
  });

  it("mengabaikan nama kosong di kedua sisi", () => {
    expect(
      findUnitsNamedLikeParent([
        unit({ id: "b1", nama: "   " }),
        unit({ id: "s1", nama: "", parent_id: "b1" }),
      ]),
    ).toEqual([]);
  });
});

describe("findEmployeesMissingReference", () => {
  it("melaporkan Karyawan tanpa Unit Organisasi", () => {
    const temuan = findEmployeesMissingReference([
      karyawan({ id: "k1", org_unit_id: null }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].kekurangan).toEqual(["unit"]);
  });

  it("melaporkan Karyawan tanpa Jabatan", () => {
    const temuan = findEmployeesMissingReference([
      karyawan({ id: "k1", jabatan_id: null }),
    ]);

    expect(temuan[0].kekurangan).toEqual(["jabatan"]);
  });

  it("menggabungkan dua kekurangan jadi satu Temuan", () => {
    const temuan = findEmployeesMissingReference([
      karyawan({ id: "k1", org_unit_id: null, jabatan_id: null }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].kekurangan).toEqual(["unit", "jabatan"]);
  });

  it("tidak melaporkan Karyawan yang lengkap", () => {
    expect(findEmployeesMissingReference([karyawan({ id: "k1" })])).toEqual([]);
  });

  it("melewati Karyawan nonaktif secara default", () => {
    const rows = [karyawan({ id: "k1", org_unit_id: null, status: "nonaktif" })];

    expect(findEmployeesMissingReference(rows)).toEqual([]);
    expect(findEmployeesMissingReference(rows, { includeNonaktif: true })).toHaveLength(1);
  });

  it("mengurutkan menurut nama", () => {
    const temuan = findEmployeesMissingReference([
      karyawan({ id: "k2", full_name: "Zulaikha Contoh", jabatan_id: null }),
      karyawan({ id: "k1", full_name: "Ahmad Contoh", jabatan_id: null }),
    ]);

    expect(temuan.map((t) => t.karyawan.full_name)).toEqual([
      "Ahmad Contoh",
      "Zulaikha Contoh",
    ]);
  });
});
