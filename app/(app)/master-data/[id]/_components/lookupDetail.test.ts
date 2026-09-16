import { describe, expect, it } from "vitest";

import { LOOKUPS, LOOKUP_ID } from "@/fixtures";
import type { DetailField } from "@/components/shared/DetailCard";
import { KOSONG } from "@/lib/derived";
import type { Lookup } from "@/lib/types/db";
import { LOOKUP_TYPES } from "@/lib/validation/lookupTypes";

import {
  buildLookupFields,
  fieldJumlahPemakai,
  GAGAL_DIMUAT,
  hrefKaryawanDenganLookup,
  hrefLookup,
  hrefTabMasterData,
  labelTipeLookup,
} from "./lookupDetail";

/**
 * The Lookup detail page (PRD #14). The trap here is the back link:
 * `/master-data` is tabbed by `tipe` and the open tab lives in the URL, so a
 * link to the bare page drops the reader on Work Contract no matter which list
 * they came from.
 *
 * Fixtures only (CLAUDE.md).
 */
function lookup(id: string): Lookup {
  const found = LOOKUPS.find((row) => row.id === id);
  if (!found) throw new Error(`fixture Lookup ${id} hilang`);
  return found;
}

const JG_A = lookup(LOOKUP_ID.jobGradeA);
const JG_B = lookup(LOOKUP_ID.jobGradeB);

function field(fields: readonly DetailField[], label: string): DetailField {
  const found = fields.find((row) => row.label === label);
  if (!found) throw new Error(`field "${label}" tidak ada`);
  return found;
}

describe("hrefTabMasterData", () => {
  it("returns to the tab this Lookup lives in", () => {
    expect(hrefTabMasterData("job_grade")).toBe("/master-data?tipe=job_grade");
  });

  it("covers all eleven tipe", () => {
    for (const tipe of LOOKUP_TYPES) {
      expect(hrefTabMasterData(tipe)).toBe(
        `/master-data?tipe=${encodeURIComponent(tipe)}`,
      );
    }
  });

  it("sends an unknown tipe to the bare page rather than a tab that is not there", () => {
    expect(hrefTabMasterData("tipe_yang_tidak_ada")).toBe("/master-data");
  });
});

describe("labelTipeLookup", () => {
  it("names a tipe in Indonesian", () => {
    expect(labelTipeLookup("job_grade")).toBe("Job Grade");
  });

  it("shows an unknown tipe as it is", () => {
    expect(labelTipeLookup("tipe_yang_tidak_ada")).toBe("tipe_yang_tidak_ada");
  });
});

describe("hrefKaryawanDenganLookup", () => {
  it("filters Karyawan by the column that belongs to this tipe", () => {
    const href = hrefKaryawanDenganLookup(JG_A);
    expect(href).toContain("status=semua");
    expect(href).toContain(`job_grade=${JG_A.id}`);
  });

  it("offers no link at all for a tipe /karyawan would silently drop", () => {
    expect(
      hrefKaryawanDenganLookup({ id: JG_A.id, tipe: "tipe_yang_tidak_ada" }),
    ).toBeUndefined();
  });
});

describe("buildLookupFields", () => {
  it("never renders a uuid", () => {
    const fields = buildLookupFields({
      lookup: { ...JG_A, merged_into_id: JG_B.id, status: "nonaktif" },
      digabungkanKe: JG_B,
      jumlahPemakai: { semua: 5, aktif: 4 },
    });
    for (const row of fields) {
      expect(row.value).not.toContain(JG_A.id);
      expect(row.value).not.toContain(JG_B.id);
    }
  });

  it("links the tipe back to its Master Data tab", () => {
    const fields = buildLookupFields({
      lookup: JG_A,
      digabungkanKe: null,
      jumlahPemakai: null,
    });
    expect(field(fields, "Tipe").href).toBe(hrefTabMasterData(JG_A.tipe));
  });

  it("explains an empty Urutan behind the info marker, not as a bare dash", () => {
    const fields = buildLookupFields({
      lookup: { ...JG_A, urutan: null },
      digabungkanKe: null,
      jumlahPemakai: null,
    });
    const urutan = field(fields, "Urutan");
    expect(urutan.value).toBe(KOSONG);
    expect(String(urutan.info)).toContain("paling bawah");
  });

  it("shows Digabungkan ke only for a Lookup that was merged away", () => {
    const sehat = buildLookupFields({
      lookup: JG_A,
      digabungkanKe: null,
      jumlahPemakai: null,
    });
    expect(sehat.some((row) => row.label === "Digabungkan ke")).toBe(false);

    const digabung = buildLookupFields({
      lookup: { ...JG_A, merged_into_id: JG_B.id, status: "nonaktif" },
      digabungkanKe: JG_B,
      jumlahPemakai: null,
    });
    const merged = field(digabung, "Digabungkan ke");
    expect(merged.value).toBe(JG_B.label);
    expect(merged.href).toBe(hrefLookup(JG_B.id));
  });
});

describe("fieldJumlahPemakai", () => {
  it("does not link to an empty list", () => {
    const row = fieldJumlahPemakai(JG_A, { semua: 0, aktif: 0 });
    expect(row.value).toBe("0 Karyawan");
    expect(row.href).toBeUndefined();
  });

  it("names the employees column it counted through, behind the info marker", () => {
    const row = fieldJumlahPemakai(JG_A, { semua: 7, aktif: 6 });
    expect(row.value).toBe("7 Karyawan");
    expect(row.href).toBe(hrefKaryawanDenganLookup(JG_A));
    // Angkanya tetap terlihat; nama kolomnya pindah ke penanda "i".
    expect(String(row.catatan)).toContain("di antaranya aktif");
    expect(String(row.info)).toContain("job_grade_id");
  });

  it("says the count failed instead of showing a zero it did not measure", () => {
    const row = fieldJumlahPemakai(JG_A, null);
    expect(row.value).toBe(GAGAL_DIMUAT);
    expect(row.href).toBeUndefined();
    expect(String(row.catatan)).toContain("Muat ulang");
  });

  it("does not offer a retry that can never succeed", () => {
    // `countEmployeesByLookup()` throws for a tipe outside the eleven — every
    // time — so "muat ulang halaman ini" would send the reader in a circle.
    const row = fieldJumlahPemakai(
      { id: JG_A.id, tipe: "tipe_yang_tidak_ada" },
      null,
    );
    expect(row.value).toBe(GAGAL_DIMUAT);
    expect(String(row.catatan)).not.toContain("Muat ulang");
    expect(String(row.catatan)).toContain("Perbaiki tipenya");
  });
});
