/**
 * Every enum this layer hands to thirteen parallel units is compared here
 * against `supabase/migrations/0001_init.sql` itself.
 *
 * `lib/validation/lookupTypes.test.ts` does this for the 11 Lookup types. This
 * file does it for the rest: `org_units.tipe`, `batches.jenis`,
 * `revisions.action`, `status`, `profiles.role`, and the two trigger lists that
 * ADR-005 §12 warns must never be made equal.
 *
 * A zod schema that disagrees with a CHECK constraint does not fail at compile
 * time and does not fail in review; it fails when an admin presses Simpan.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { RELATION_COLUMNS } from "@/lib/schema/columns.generated";
import {
  BATCH_JENIS,
  DELETE_GUARDED_TABLES,
  LOGGED_TABLES,
  LOGGED_TABLE_LABELS,
  PK_COLUMN_BY_TABLE,
  REVISION_ACTIONS,
  TABLES_WITH_STATUS,
} from "@/lib/revisions/tables";
import { BATCH_TYPE_LABELS, ORG_UNIT_TYPE_LABELS } from "@/lib/i18n/terms";

import { ROLE_VALUES, STATUS_VALUES } from "./common";
import { ORG_UNIT_TYPES } from "./orgUnit";

const MIGRATION = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations/0001_init.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

/** The `create table` body for one table, so a CHECK is looked up in scope. */
function tableBody(table: string): string {
  const match = sql.match(
    new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"),
  );
  if (!match) throw new Error(`CREATE TABLE public.${table} tidak ditemukan`);
  return match[1];
}

/** Values of `check (<column> in ('a','b',…))` inside one table body. */
function checkValues(table: string, column: string): string[] {
  const body = tableBody(table);
  const match = body.match(
    new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "i"),
  );
  if (!match) {
    throw new Error(`CHECK pada ${table}.${column} tidak ditemukan di 0001_init.sql`);
  }
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Tables a trigger of this name is attached to. */
function triggerTables(name: string, event: string): string[] {
  const pattern = new RegExp(
    `create trigger ${name}\\s+${event} on public\\.(\\w+)`,
    "gi",
  );
  return [...sql.matchAll(pattern)].map((m) => m[1]);
}

describe("org_units.tipe", () => {
  it("sama persis dengan CHECK constraint, termasuk urutannya", () => {
    expect([...ORG_UNIT_TYPES]).toEqual(checkValues("org_units", "tipe"));
  });

  it("punya label Indonesia untuk setiap tipe", () => {
    for (const tipe of ORG_UNIT_TYPES) {
      expect(ORG_UNIT_TYPE_LABELS[tipe]).toBeTruthy();
    }
    expect(Object.keys(ORG_UNIT_TYPE_LABELS).sort()).toEqual([...ORG_UNIT_TYPES].sort());
  });
});

describe("batches.jenis", () => {
  it("sama persis dengan CHECK constraint", () => {
    expect([...BATCH_JENIS]).toEqual(checkValues("batches", "jenis"));
  });

  it("cocok dengan begin_batch(), yang memeriksa daftarnya sendiri", () => {
    const guard = sql.match(
      /p_jenis not in \(([^)]*)\)/i,
    );
    if (!guard) throw new Error("Penjagaan jenis di begin_batch tidak ditemukan");
    const values = [...guard[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...BATCH_JENIS]);
  });

  it("punya label Indonesia untuk setiap jenis", () => {
    expect(Object.keys(BATCH_TYPE_LABELS).sort()).toEqual([...BATCH_JENIS].sort());
  });
});

describe("revisions.action", () => {
  it("hanya insert dan update — tidak ada delete (ADR-003)", () => {
    expect([...REVISION_ACTIONS]).toEqual(checkValues("revisions", "action"));
    expect(REVISION_ACTIONS).not.toContain("delete");
  });
});

describe("status dan role", () => {
  it.each(["employees", "org_units", "jabatan", "lookups", "api_keys"])(
    "%s.status hanya aktif/nonaktif",
    (table) => {
      expect(checkValues(table, "status")).toEqual([...STATUS_VALUES]);
    },
  );

  it("profiles.role hanya admin/viewer", () => {
    expect(checkValues("profiles", "role")).toEqual([...ROLE_VALUES]);
  });
});

describe("tabel ter-log vs tabel yang dilarang di-DELETE (ADR-005 §12)", () => {
  const logged = triggerTables("log_revision", "after insert or update");
  const noDelete = triggerTables("no_delete", "before delete");

  it("tepat tujuh tabel dipasangi log_revision", () => {
    expect(logged.sort()).toEqual([...LOGGED_TABLES].sort());
    expect(LOGGED_TABLES).toHaveLength(7);
  });

  it("profiles ikut ter-log — perubahan role wajib teraudit", () => {
    expect(logged).toContain("profiles");
  });

  it("profiles SENGAJA tidak dipasangi guard DELETE", () => {
    expect(noDelete).not.toContain("profiles");
  });

  it("enam tabel data dilarang di-DELETE", () => {
    for (const table of DELETE_GUARDED_TABLES) {
      expect(noDelete).toContain(table);
    }
    expect(DELETE_GUARDED_TABLES).toHaveLength(6);
  });

  it("kedua daftar berbeda tepat satu tabel, dan itu profiles", () => {
    const selisih = LOGGED_TABLES.filter(
      (table) => !(DELETE_GUARDED_TABLES as readonly string[]).includes(table),
    );
    expect(selisih).toEqual(["profiles"]);
  });

  it("setiap tabel ter-log punya label Indonesia", () => {
    expect(Object.keys(LOGGED_TABLE_LABELS).sort()).toEqual([...LOGGED_TABLES].sort());
  });
});

describe("kunci dan kolom status per tabel ter-log", () => {
  it("employee_private berkunci employee_id, sisanya id", () => {
    for (const table of LOGGED_TABLES) {
      const pk = PK_COLUMN_BY_TABLE[table];
      expect(pk).toBe(table === "employee_private" ? "employee_id" : "id");
      expect(RELATION_COLUMNS[table] as readonly string[]).toContain(pk);
    }
  });

  it("TABLES_WITH_STATUS berisi persis tabel ter-log yang punya kolom status", () => {
    const punyaStatus = LOGGED_TABLES.filter((table) =>
      (RELATION_COLUMNS[table] as readonly string[]).includes("status"),
    );
    expect([...TABLES_WITH_STATUS].sort()).toEqual(punyaStatus.sort());
  });

  it("employee_private dan profiles memang tidak punya kolom status", () => {
    expect(RELATION_COLUMNS.employee_private as readonly string[]).not.toContain("status");
    expect(RELATION_COLUMNS.profiles as readonly string[]).not.toContain("status");
  });
});
