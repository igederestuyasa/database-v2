import { describe, expect, it } from "vitest";

import { JABATAN, JABATAN_ID } from "@/fixtures";
import type { DetailField } from "@/components/shared/DetailCard";
import type { Jabatan } from "@/lib/types/db";

import {
  buildJabatanFields,
  fieldJumlahPemegang,
  GAGAL_DIMUAT,
  hrefJabatan,
  hrefKaryawanDenganJabatan,
  labelStatusJabatan,
} from "./jabatanDetail";

/**
 * The Jabatan detail page (PRD #14). Two things worth pinning: no uuid ever
 * reaches the screen, and the page keeps saying that a Jabatan is a nama
 * pekerjaan many Karyawan can hold — not a Formasi (ADR-002, CONTEXT.md).
 *
 * Fixtures only — invented job names, never HK's real ones (CLAUDE.md).
 */
function jabatan(id: string): Jabatan {
  const found = JABATAN.find((row) => row.id === id);
  if (!found) throw new Error(`fixture Jabatan ${id} hilang`);
  return found;
}

const STAF = jabatan(JABATAN_ID.staf);
const STAF_LAMA = jabatan(JABATAN_ID.stafLama);

function field(fields: readonly DetailField[], label: string): DetailField {
  const found = fields.find((row) => row.label === label);
  if (!found) throw new Error(`field "${label}" tidak ada`);
  return found;
}

describe("labelStatusJabatan", () => {
  it("names both states", () => {
    expect(labelStatusJabatan("aktif")).toBe("Aktif");
    expect(labelStatusJabatan("nonaktif")).toBe("Nonaktif");
  });
});

describe("hrefKaryawanDenganJabatan", () => {
  it("counts and lists the same set: every status", () => {
    const href = hrefKaryawanDenganJabatan(JABATAN_ID.staf);
    expect(href).toContain("status=semua");
    expect(href).toContain(`jabatan=${JABATAN_ID.staf}`);
  });
});

describe("buildJabatanFields", () => {
  it("never renders a uuid", () => {
    const fields = buildJabatanFields({
      jabatan: STAF_LAMA,
      digabungkanKe: STAF,
      jumlahPemegang: { semua: 3, aktif: 2 },
    });
    for (const row of fields) {
      expect(row.value).not.toContain(JABATAN_ID.staf);
      expect(row.value).not.toContain(JABATAN_ID.stafLama);
    }
  });

  it("shows Digabungkan ke only for a Jabatan that was merged away", () => {
    const sehat = buildJabatanFields({
      jabatan: STAF,
      digabungkanKe: null,
      jumlahPemegang: null,
    });
    expect(sehat.some((row) => row.label === "Digabungkan ke")).toBe(false);

    const digabung = buildJabatanFields({
      jabatan: STAF_LAMA,
      digabungkanKe: STAF,
      jumlahPemegang: null,
    });
    const merged = field(digabung, "Digabungkan ke");
    expect(merged.value).toBe(STAF.nama);
    expect(merged.href).toBe(hrefJabatan(STAF.id));
  });

  it("still links the Merge target when its name could not be read", () => {
    const merged = field(
      buildJabatanFields({
        jabatan: STAF_LAMA,
        digabungkanKe: null,
        jumlahPemegang: null,
      }),
      "Digabungkan ke",
    );
    expect(merged.value).toBe("Jabatan lain");
    expect(merged.href).toBe(hrefJabatan(JABATAN_ID.staf));
  });
});

describe("fieldJumlahPemegang", () => {
  it("does not link to an empty list", () => {
    const row = fieldJumlahPemegang(JABATAN_ID.staf, { semua: 0, aktif: 0 });
    expect(row.value).toBe("0 Karyawan");
    expect(row.href).toBeUndefined();
  });

  it("says out loud that one Jabatan is not one seat", () => {
    const row = fieldJumlahPemegang(JABATAN_ID.staf, { semua: 42, aktif: 40 });
    expect(row.value).toBe("42 Karyawan");
    expect(row.href).toBe(hrefKaryawanDenganJabatan(JABATAN_ID.staf));
    expect(String(row.catatan)).toContain("bukan Formasi");
  });

  it("says the count failed instead of showing a zero it did not measure", () => {
    const row = fieldJumlahPemegang(JABATAN_ID.staf, null);
    expect(row.value).toBe(GAGAL_DIMUAT);
    expect(row.href).toBeUndefined();
  });
});
