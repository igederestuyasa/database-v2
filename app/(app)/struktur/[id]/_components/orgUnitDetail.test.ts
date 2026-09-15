import { describe, expect, it } from "vitest";

import { ORG_UNITS, ORG_UNIT_ID } from "@/fixtures";
import { KOSONG } from "@/lib/derived";
import type { DetailField } from "@/components/shared/DetailCard";
import type { OrgUnit } from "@/lib/types/db";

import {
  buildOrgUnitFields,
  fieldJumlahKaryawan,
  GAGAL_DIMUAT,
  hrefKaryawanDiUnit,
  hrefUnit,
  labelStatusUnit,
  labelTipeUnit,
  type OrgUnitDetailInput,
} from "./orgUnitDetail";

/**
 * The Unit Organisasi detail page (PRD #14) has one job beyond showing the
 * Riwayat: turning `parent_id` and `merged_into_id` into names a human
 * recognises. A uuid on this page, or a dash where a name failed to load,
 * would both be wrong in ways nobody notices from a screenshot — so they are
 * checked here.
 *
 * Fixtures only — invented units, never HK's real ones (CLAUDE.md).
 */
function unit(id: string): OrgUnit {
  const found = ORG_UNITS.find((row) => row.id === id);
  if (!found) throw new Error(`fixture Unit Organisasi ${id} hilang`);
  return found;
}

const DIVISI = unit(ORG_UNIT_ID.divisi);
const DIREKTORAT = unit(ORG_UNIT_ID.direktorat);
const DIVISI_LAMA = unit(ORG_UNIT_ID.divisiLama);
const YATIM = unit(ORG_UNIT_ID.yatim);

function dasar(over: Partial<OrgUnitDetailInput> = {}): OrgUnitDetailInput {
  return {
    unit: DIVISI,
    induk: DIREKTORAT,
    indukGagal: false,
    digabungkanKe: null,
    jumlahKaryawan: { semua: 0, aktif: 0 },
    ...over,
  };
}

function field(fields: readonly DetailField[], label: string): DetailField {
  const found = fields.find((row) => row.label === label);
  if (!found) throw new Error(`field "${label}" tidak ada`);
  return found;
}

describe("labelTipeUnit", () => {
  it("names the six tipe in Indonesian", () => {
    expect(labelTipeUnit("sub_bagian")).toBe("Sub Bagian");
    expect(labelTipeUnit("proyek")).toBe("Proyek");
  });

  it("shows an unknown tipe as it is, rather than inventing one", () => {
    expect(labelTipeUnit("holding")).toBe("holding");
    expect(labelTipeUnit(null)).toBe(KOSONG);
  });
});

describe("labelStatusUnit", () => {
  it("names both states", () => {
    expect(labelStatusUnit("aktif")).toBe("Aktif");
    expect(labelStatusUnit("nonaktif")).toBe("Nonaktif");
  });
});

describe("hrefKaryawanDiUnit", () => {
  it("narrows to this unit alone, every status, so the link matches the count", () => {
    const href = hrefKaryawanDiUnit(ORG_UNIT_ID.divisi);
    // `sub=0`: the count beside it excludes the subtree, and `/karyawan`
    // includes the subtree unless told not to.
    expect(href).toContain("sub=0");
    expect(href).toContain("status=semua");
    expect(href).toContain(`unit=${ORG_UNIT_ID.divisi}`);
  });
});

describe("buildOrgUnitFields", () => {
  it("never renders a uuid", () => {
    const fields = buildOrgUnitFields(
      dasar({ unit: DIVISI_LAMA, digabungkanKe: DIVISI }),
    );
    for (const row of fields) {
      expect(row.value).not.toContain(ORG_UNIT_ID.divisi);
      expect(row.value).not.toContain(ORG_UNIT_ID.divisiLama);
    }
  });

  it("names the induk and links to its page", () => {
    const induk = field(buildOrgUnitFields(dasar()), "Induk");
    expect(induk.value).toBe(DIREKTORAT.nama);
    expect(induk.href).toBe(hrefUnit(DIREKTORAT.id));
  });

  it("says a Direktorat is at the top rather than leaving a bare dash", () => {
    const induk = field(
      buildOrgUnitFields(dasar({ unit: DIREKTORAT, induk: null })),
      "Induk",
    );
    expect(induk.value).toBe(KOSONG);
    expect(String(induk.catatan)).toContain("puncak hierarki");
  });

  it("calls a unit whose induk is missing a Temuan, not a root", () => {
    const induk = field(
      buildOrgUnitFields(dasar({ unit: YATIM, induk: null })),
      "Induk",
    );
    expect(induk.value).toBe(KOSONG);
    expect(String(induk.catatan)).toContain("Perlu Dibereskan");
  });

  it("tells a failed ancestor read apart from a unit with no induk", () => {
    const induk = field(
      buildOrgUnitFields(dasar({ unit: YATIM, induk: null, indukGagal: true })),
      "Induk",
    );
    // The difference that matters: "(tidak bisa dimuat)" is not "—". A dash
    // here would claim this unit sits at the top of the company.
    expect(induk.value).toBe(GAGAL_DIMUAT);
    expect(induk.value).not.toBe(KOSONG);
  });

  it("shows Digabungkan ke only for a unit that was merged away", () => {
    const sehat = buildOrgUnitFields(dasar());
    expect(sehat.some((row) => row.label === "Digabungkan ke")).toBe(false);

    const digabung = buildOrgUnitFields(
      dasar({ unit: DIVISI_LAMA, induk: DIREKTORAT, digabungkanKe: DIVISI }),
    );
    const merged = field(digabung, "Digabungkan ke");
    expect(merged.value).toBe(DIVISI.nama);
    expect(merged.href).toBe(hrefUnit(DIVISI.id));
  });

  it("still links the Merge target when its name could not be read", () => {
    const merged = field(
      buildOrgUnitFields(dasar({ unit: DIVISI_LAMA, digabungkanKe: null })),
      "Digabungkan ke",
    );
    expect(merged.value).toBe("Unit Organisasi lain");
    expect(merged.href).toBe(hrefUnit(ORG_UNIT_ID.divisi));
  });
});

describe("fieldJumlahKaryawan", () => {
  it("does not link to an empty list", () => {
    const row = fieldJumlahKaryawan(ORG_UNIT_ID.divisi, { semua: 0, aktif: 0 });
    expect(row.value).toBe("0 Karyawan");
    expect(row.href).toBeUndefined();
  });

  it("links to the Karyawan it counted, and says how many are aktif", () => {
    const row = fieldJumlahKaryawan(ORG_UNIT_ID.divisi, { semua: 12, aktif: 9 });
    expect(row.value).toBe("12 Karyawan");
    expect(row.href).toBe(hrefKaryawanDiUnit(ORG_UNIT_ID.divisi));
    expect(String(row.catatan)).toContain("9 di antaranya aktif");
  });

  it("says the count failed instead of showing a zero it did not measure", () => {
    const row = fieldJumlahKaryawan(ORG_UNIT_ID.divisi, null);
    expect(row.value).toBe(GAGAL_DIMUAT);
    expect(row.href).toBeUndefined();
  });
});
