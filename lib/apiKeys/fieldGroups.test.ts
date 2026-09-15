import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { API_EMPLOYEE_FIELDS } from "@/lib/schema/columns.generated";
import { ALLOWED_FIELD_VALUES } from "@/lib/validation/apiKey";

import {
  API_FIELDS_BY_GROUP_ORDER,
  API_FIELD_GROUPS,
  TOTAL_API_FIELDS,
  countSelectedInGroup,
  isSelectableApiField,
  sortApiFields,
  unknownApiFields,
} from "./fieldGroups";

const CONTRACT = path.resolve(import.meta.dirname, "../../API-CONTRACT.md");

/** Kolom yang tidak boleh bisa dipilih, apa pun yang terjadi (PRD #22). */
const SENSITIF = [
  "date_of_birth",
  "place_of_birth",
  "religion",
  "marital_status",
  "usia",
];

/**
 * Baca §"Kolom `v_employees_api` yang bisa diminta" dari API-CONTRACT.md,
 * per baris grup: "Identitas: `a`, `b`" → { "Identitas": ["a", "b"] }.
 *
 * Baris Lookup adalah singkatan — ia menyebut 11 nama dasar dan mengatakan
 * masing-masing hadir sebagai `*_kode` dan `*_label`, jadi dimekarkan jadi 22.
 * Cara baca yang sama dipakai `tests/apiColumns.test.ts`.
 */
function contractGroups(): Map<string, string[]> {
  const md = readFileSync(CONTRACT, "utf8");
  const start = md.indexOf("## Kolom `v_employees_api`");
  if (start === -1) {
    throw new Error(
      "Bagian 'Kolom v_employees_api yang bisa diminta' tidak ditemukan di API-CONTRACT.md",
    );
  }
  const end = md.indexOf("\n## ", start + 1);
  const section = md.slice(start, end === -1 ? undefined : end);

  const groups = new Map<string, string[]>();
  for (const line of section.split("\n").slice(1)) {
    // Judul grup = semua yang mendahului ":" pertama. Baris Lookup menyelipkan
    // "(tiap satu `*_kode` dan `*_label`)" di situ; kurungnya dibuang di bawah.
    const heading = line.match(/^([^:]+):/);
    if (!heading) continue;
    const tokens = [...line.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .filter((t) => !t.includes("*") && /^[a-z0-9_]+$/.test(t));
    if (tokens.length === 0) continue;

    const nama = heading[1].trim();
    const kolom = nama.startsWith("Lookup")
      ? tokens.flatMap((base) => [`${base}_kode`, `${base}_label`])
      : tokens;
    groups.set(nama.replace(/\s*\(.*$/, "").trim(), kolom);
  }
  return groups;
}

describe("API_FIELD_GROUPS", () => {
  it("memuat setiap kolom v_employees_api tepat satu kali", () => {
    expect([...API_FIELDS_BY_GROUP_ORDER].sort()).toEqual(
      [...API_EMPLOYEE_FIELDS].sort(),
    );
    expect(new Set(API_FIELDS_BY_GROUP_ORDER).size).toBe(
      API_FIELDS_BY_GROUP_ORDER.length,
    );
    expect(TOTAL_API_FIELDS).toBe(API_FIELDS_BY_GROUP_ORDER.length);
  });

  it("semestanya sama dengan yang divalidasi zod", () => {
    expect([...API_FIELDS_BY_GROUP_ORDER].sort()).toEqual(
      [...ALLOWED_FIELD_VALUES].sort(),
    );
  });

  it("pengelompokannya sama persis dengan API-CONTRACT.md", () => {
    const dariKontrak = contractGroups();
    expect(dariKontrak.size).toBe(API_FIELD_GROUPS.length);

    for (const group of API_FIELD_GROUPS) {
      const kolomKontrak = dariKontrak.get(group.label);
      expect(kolomKontrak, `grup "${group.label}" tidak ada di API-CONTRACT.md`)
        .toBeDefined();
      // Urutannya juga, bukan hanya isinya: urutan itulah yang dibaca admin.
      expect(group.fields).toEqual(kolomKontrak);
    }
  });

  it("tidak ada grup yang kosong, dan setiap grup punya keterangan", () => {
    for (const group of API_FIELD_GROUPS) {
      expect(group.fields.length).toBeGreaterThan(0);
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.keterangan.length).toBeGreaterThan(0);
    }
  });

  it("id grupnya unik", () => {
    const ids = API_FIELD_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tidak satu pun kolom Data Pribadi Sensitif bisa dipilih", () => {
    for (const kolom of SENSITIF) {
      expect(API_FIELDS_BY_GROUP_ORDER).not.toContain(kolom);
      expect(isSelectableApiField(kolom)).toBe(false);
    }
  });

  it("key_hash tidak pernah menjadi kolom yang bisa dipilih", () => {
    expect(isSelectableApiField("key_hash")).toBe(false);
  });
});

describe("sortApiFields", () => {
  it("mengurutkan mengikuti urutan API-CONTRACT.md", () => {
    expect(sortApiFields(["full_name", "id", "jabatan_nama"])).toEqual([
      "id",
      "full_name",
      "jabatan_nama",
    ]);
  });

  it("membuang duplikat dan nama yang tidak dikenal", () => {
    expect(
      sortApiFields(["full_name", "full_name", "religion", "kolom_hantu"]),
    ).toEqual(["full_name"]);
  });

  it("larik kosong tetap kosong", () => {
    expect(sortApiFields([])).toEqual([]);
  });
});

describe("unknownApiFields", () => {
  it("kosong untuk whitelist yang sehat", () => {
    expect(unknownApiFields([...API_EMPLOYEE_FIELDS])).toEqual([]);
  });

  it("menyebut kolom yang tidak ada lagi di view", () => {
    expect(unknownApiFields(["full_name", "kolom_lama", "religion"])).toEqual([
      "kolom_lama",
      "religion",
    ]);
  });
});

describe("countSelectedInGroup", () => {
  it("menghitung hanya kolom milik grup itu", () => {
    const identitas = API_FIELD_GROUPS[0];
    expect(identitas.id).toBe("identitas");
    expect(
      countSelectedInGroup(
        identitas,
        new Set(["full_name", "nip", "jabatan_nama"]),
      ),
    ).toBe(2);
    expect(countSelectedInGroup(identitas, new Set())).toBe(0);
    expect(countSelectedInGroup(identitas, new Set(identitas.fields))).toBe(
      identitas.fields.length,
    );
  });
});
