import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LOOKUP_TYPES,
  LOOKUP_TYPE_LABELS,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
  isLookupType,
} from "./lookupTypes";
import { EMPLOYEES_COLUMNS } from "@/lib/schema/columns.generated";

const MIGRATION = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations/0001_init.sql",
);

/**
 * CLAUDE.md: "Daftar `tipe` lookup harus sama di lib/validation/lookupTypes.ts
 * dan CHECK constraint migration." This test is the machine check for that
 * rule; `scripts/verify-schema.sql` §17 checks the same thing from the other
 * side, against a live database.
 */
function checkConstraintTypes(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");

  // `org_units` also has a `tipe` CHECK, so scope the search to the
  // `lookups` CREATE TABLE statement before looking for it.
  const table = sql.match(
    /create table if not exists public\.lookups \(([\s\S]*?)\n\);/i,
  );
  if (!table) {
    throw new Error("CREATE TABLE public.lookups tidak ditemukan di 0001_init.sql");
  }

  const check = table[1].match(/check\s*\(\s*tipe\s+in\s*\(([^)]*)\)/i);
  if (!check) {
    throw new Error(
      "CHECK constraint pada lookups.tipe tidak ditemukan di 0001_init.sql",
    );
  }
  return [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("LOOKUP_TYPES", () => {
  it("cocok persis dengan CHECK constraint di 0001_init.sql, termasuk urutannya", () => {
    expect([...LOOKUP_TYPES]).toEqual(checkConstraintTypes());
  });

  it("berisi 11 tipe dan tidak ada duplikat", () => {
    expect(LOOKUP_TYPES).toHaveLength(11);
    expect(new Set(LOOKUP_TYPES).size).toBe(11);
  });

  it("punya label Indonesia untuk setiap tipe", () => {
    for (const tipe of LOOKUP_TYPES) {
      expect(LOOKUP_TYPE_LABELS[tipe]).toBeTruthy();
    }
  });

  it("memetakan setiap tipe ke kolom employees yang benar-benar ada", () => {
    for (const tipe of LOOKUP_TYPES) {
      const column = LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[tipe];
      expect(column).toBe(`${tipe}_id`);
      expect(EMPLOYEES_COLUMNS as readonly string[]).toContain(column);
    }
  });

  it("isLookupType menolak nilai di luar daftar", () => {
    expect(isLookupType("job_grade")).toBe(true);
    expect(isLookupType("jabatan")).toBe(false);
    expect(isLookupType("")).toBe(false);
    expect(isLookupType(null)).toBe(false);
    expect(isLookupType(42)).toBe(false);
  });
});
