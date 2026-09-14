import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const MIGRATION = path.join(MIGRATIONS_DIR, "0001_init.sql");

const sql = readFileSync(MIGRATION, "utf8");

const DATA_TABLES = [
  "employees",
  "employee_private",
  "org_units",
  "jabatan",
  "lookups",
  "api_keys",
];

const VIEWS = ["v_employees", "v_employees_private", "v_employees_api"];

/**
 * These assertions duplicate part of `scripts/verify-schema.sql` on purpose.
 * That script needs a running PostgreSQL; this one runs in `npm test`
 * everywhere, so a rule cannot be broken unnoticed by someone without a local
 * database.
 */
describe("supabase/migrations", () => {
  it("hanya berisi satu file migration", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toEqual(["0001_init.sql"]);
  });

  it("tidak memuat shim auth lokal (itu milik db/local/00-shim.sql)", () => {
    // Referring to auth.users in an FK is correct; *creating* it is the shim.
    expect(sql).not.toMatch(/create\s+table\s+(if not exists\s+)?auth\./i);
    expect(sql).not.toMatch(/create\s+schema\s+(if not exists\s+)?auth\b/i);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+auth\./i);
    expect(sql).not.toMatch(/create\s+role\b/i);
  });
});

describe("0001_init.sql — tabel & view", () => {
  it("membuat kesembilan tabel", () => {
    for (const table of [
      ...DATA_TABLES,
      "batches",
      "revisions",
      "profiles",
    ]) {
      expect(sql).toMatch(
        new RegExp(`create table if not exists public\\.${table}\\b`, "i"),
      );
    }
  });

  it("membuat ketiga view dengan security_invoker = true", () => {
    for (const view of VIEWS) {
      const re = new RegExp(
        `create or replace view public\\.${view}\\s*\\n?\\s*with \\(security_invoker = true\\)`,
        "i",
      );
      expect(sql, `${view} harus security_invoker`).toMatch(re);
    }
  });
});

describe("0001_init.sql — ADR-003 (log revisi lewat trigger)", () => {
  it("memasang trigger log_revision di keenam tabel data", () => {
    for (const table of DATA_TABLES) {
      const re = new RegExp(
        `create trigger log_revision after insert or update on public\\.${table}\\b`,
        "i",
      );
      expect(sql, `${table} harus punya trigger log_revision`).toMatch(re);
    }
  });

  it("trigger membaca app.batch_id dan membuat batch 'edit' kalau kosong", () => {
    expect(sql).toMatch(/current_setting\('app\.batch_id', true\)/);
    expect(sql).toMatch(/insert into public\.batches \(jenis, keterangan, actor_id\)\s*\n\s*values \('edit'/);
  });

  it("menyediakan RPC begin_batch", () => {
    expect(sql).toMatch(/create or replace function public\.begin_batch\(/i);
  });
});

describe("0001_init.sql — larangan DELETE", () => {
  it("memasang trigger no_delete di keenam tabel data", () => {
    for (const table of DATA_TABLES) {
      const re = new RegExp(
        `create trigger no_delete before delete on public\\.${table}\\b`,
        "i",
      );
      expect(sql, `${table} harus menolak DELETE`).toMatch(re);
    }
  });

  it("tidak pernah membuat policy DELETE", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?\bfor delete\b/i);
  });

  it("tidak pernah memberi grant DELETE", () => {
    const grants = [...sql.matchAll(/^\s*grant\s+([\s\S]*?)\s+on\b/gim)].map(
      (m) => m[1].toLowerCase(),
    );
    expect(grants.length).toBeGreaterThan(0);
    for (const privileges of grants) {
      expect(privileges).not.toContain("delete");
      expect(privileges.trim()).not.toBe("all");
    }
  });

  it("tidak pernah menjalankan DELETE FROM pada tabel data", () => {
    for (const table of DATA_TABLES) {
      const re = new RegExp(`delete\\s+from\\s+public\\.${table}\\b`, "i");
      expect(sql).not.toMatch(re);
    }
  });
});

describe("0001_init.sql — RLS", () => {
  it("menyalakan RLS di kesembilan tabel", () => {
    for (const table of [
      ...DATA_TABLES,
      "batches",
      "revisions",
      "profiles",
    ]) {
      const re = new RegExp(
        `alter table public\\.${table}\\s+enable row level security`,
        "i",
      );
      expect(sql, `${table} harus RLS`).toMatch(re);
    }
  });

  it("employee_private hanya untuk admin, termasuk SELECT (PRD #22)", () => {
    const re =
      /create policy employee_private_select on public\.employee_private\s*\n\s*for select to authenticated using \(public\.is_admin\(\)\)/i;
    expect(sql).toMatch(re);
  });

  it("semua policy tulis meminta is_admin()", () => {
    const writePolicies = [
      ...sql.matchAll(
        /create policy (\w+) on public\.(\w+)\s*\n\s*for (insert|update)([\s\S]*?);/gi,
      ),
    ];
    expect(writePolicies.length).toBeGreaterThan(0);
    for (const [, name, , , body] of writePolicies) {
      expect(body, `policy ${name} harus memeriksa is_admin()`).toContain(
        "public.is_admin()",
      );
    }
  });
});
