import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  RELATION_COLUMNS,
  V_EMPLOYEES_API_COLUMNS,
  V_EMPLOYEES_COLUMNS,
  API_EMPLOYEE_FIELDS,
} from "@/lib/schema/columns.generated";

const CONTRACT = path.resolve(import.meta.dirname, "../API-CONTRACT.md");

/** Columns that must never be reachable through /api/v1 (PRD #22, ADR-004). */
const SENSITIVE = [
  "date_of_birth",
  "place_of_birth",
  "religion",
  "marital_status",
  "usia",
];

/**
 * Parse §"Kolom `v_employees_api` yang bisa diminta" out of API-CONTRACT.md.
 *
 * The Lookup line is shorthand: it lists 11 base names and says each one
 * exists as `*_kode` and `*_label`, so it expands to 22 columns.
 */
function contractColumns(): string[] {
  const md = readFileSync(CONTRACT, "utf8");
  const start = md.indexOf("## Kolom `v_employees_api`");
  if (start === -1) {
    throw new Error(
      "Bagian 'Kolom v_employees_api yang bisa diminta' tidak ditemukan di API-CONTRACT.md",
    );
  }
  const end = md.indexOf("\n## ", start + 1);
  const section = md.slice(start, end === -1 ? undefined : end);

  const columns: string[] = [];
  for (const line of section.split("\n").slice(1)) {
    const tokens = [...line.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .filter((t) => !t.includes("*") && /^[a-z0-9_]+$/.test(t));
    if (tokens.length === 0) continue;

    if (line.trimStart().startsWith("Lookup")) {
      for (const base of tokens) {
        columns.push(`${base}_kode`, `${base}_label`);
      }
    } else {
      columns.push(...tokens);
    }
  }
  return columns;
}

describe("v_employees_api", () => {
  it("kolomnya sama persis dengan API-CONTRACT.md", () => {
    const fromContract = contractColumns();
    expect(fromContract.length).toBeGreaterThan(0);
    expect([...V_EMPLOYEES_API_COLUMNS].sort()).toEqual(
      [...fromContract].sort(),
    );
  });

  it("tidak memuat satu pun kolom Data Pribadi Sensitif", () => {
    for (const column of SENSITIVE) {
      expect(V_EMPLOYEES_API_COLUMNS as readonly string[]).not.toContain(column);
    }
  });

  it("setiap kolomnya juga ada di v_employees", () => {
    for (const column of V_EMPLOYEES_API_COLUMNS) {
      expect(V_EMPLOYEES_COLUMNS as readonly string[]).toContain(column);
    }
  });

  it("adalah semesta allowed_fields untuk API Key", () => {
    expect(API_EMPLOYEE_FIELDS).toBe(V_EMPLOYEES_API_COLUMNS);
  });
});

describe("columns.generated.ts", () => {
  it("memuat 9 tabel dan 3 view", () => {
    expect(Object.keys(RELATION_COLUMNS).sort()).toEqual(
      [
        "api_keys",
        "batches",
        "employee_private",
        "employees",
        "jabatan",
        "lookups",
        "org_units",
        "profiles",
        "revisions",
        "v_employees",
        "v_employees_api",
        "v_employees_private",
      ].sort(),
    );
  });

  it("v_employees_private memuat kolom sensitif dan usia", () => {
    const columns = RELATION_COLUMNS.v_employees_private;
    for (const column of SENSITIVE) {
      expect(columns).toContain(column);
    }
  });

  it("employees tidak menyimpan kolom turunan apa pun", () => {
    const derived = [
      "usia",
      "masa_kerja_tahun",
      "masa_kerja_bulan",
      "masa_pg_tahun",
      "masa_jg_tahun",
    ];
    for (const column of derived) {
      expect(RELATION_COLUMNS.employees).not.toContain(column);
    }
  });
});
