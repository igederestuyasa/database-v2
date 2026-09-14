import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const MIGRATION = path.join(MIGRATIONS_DIR, "0001_init.sql");
const BATCH_OPS = path.join(MIGRATIONS_DIR, "0002_batch_operations.sql");

const sql = readFileSync(MIGRATION, "utf8");
const batchOpsSql = readFileSync(BATCH_OPS, "utf8");

/**
 * Both migrations, for the rules that hold across the whole schema.
 *
 * `supabase/migrations/` is frozen at TWO files (ADR-005 §Terkunci, reopened
 * exactly once by ADR-006). A third one means someone missed the freeze.
 */
const ALL_MIGRATIONS = [
  { name: "0001_init.sql", sql },
  { name: "0002_batch_operations.sql", sql: batchOpsSql },
];

/**
 * The six tables that may never be DELETEd from (CLAUDE.md, ADR-003).
 * Deactivate with `status = 'nonaktif'` instead.
 */
const DATA_TABLES = [
  "employees",
  "employee_private",
  "org_units",
  "jabatan",
  "lookups",
  "api_keys",
];

/**
 * The seven tables whose writes are recorded in `revisions`.
 *
 * Deliberately one longer than DATA_TABLES: `profiles` is logged, because a
 * role change is the single most audit-worthy event here (PRD #13), but it is
 * NOT delete-guarded, because it cascades from `auth.users`.
 */
const LOGGED_TABLES = [...DATA_TABLES, "profiles"];

const VIEWS = ["v_employees", "v_employees_private", "v_employees_api"];

/**
 * These assertions duplicate part of `scripts/verify-schema.sql` on purpose.
 * That script needs a running PostgreSQL; this one runs in `npm test`
 * everywhere, so a rule cannot be broken unnoticed by someone without a local
 * database.
 */
describe("supabase/migrations", () => {
  it("berisi tepat dua file migration, dan tetap beku di situ", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toEqual(["0001_init.sql", "0002_batch_operations.sql"]);
  });

  it("tidak memuat shim auth lokal (itu milik db/local/00-shim.sql)", () => {
    for (const migration of ALL_MIGRATIONS) {
      // Referring to auth.users in an FK is correct; *creating* it is the shim.
      expect(migration.sql, migration.name).not.toMatch(
        /create\s+table\s+(if not exists\s+)?auth\./i,
      );
      expect(migration.sql, migration.name).not.toMatch(
        /create\s+schema\s+(if not exists\s+)?auth\b/i,
      );
      expect(migration.sql, migration.name).not.toMatch(
        /create\s+(or\s+replace\s+)?function\s+auth\./i,
      );
      expect(migration.sql, migration.name).not.toMatch(/create\s+role\b/i);
    }
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
  it("memasang trigger log_revision di ketujuh tabel ter-log", () => {
    for (const table of LOGGED_TABLES) {
      const re = new RegExp(
        `create trigger log_revision after insert or update on public\\.${table}\\b`,
        "i",
      );
      expect(sql, `${table} harus punya trigger log_revision`).toMatch(re);
    }
  });

  it("mencatat perubahan profiles (PRD #13: 'tabel mana pun')", () => {
    expect(sql).toMatch(
      /create trigger log_revision after insert or update on public\.profiles\b/i,
    );
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

  it("TIDAK memasang no_delete di profiles (cascade dari auth.users)", () => {
    expect(sql).not.toMatch(
      /create trigger no_delete before delete on public\.profiles\b/i,
    );
  });

  it("tidak pernah membuat policy DELETE", () => {
    for (const migration of ALL_MIGRATIONS) {
      expect(migration.sql, migration.name).not.toMatch(
        /create policy[\s\S]{0,200}?\bfor delete\b/i,
      );
    }
  });

  it("tidak pernah memberi grant DELETE", () => {
    for (const migration of ALL_MIGRATIONS) {
      const grants = [
        ...migration.sql.matchAll(/^\s*grant\s+([\s\S]*?)\s+on\b/gim),
      ].map((m) => m[1].toLowerCase());
      expect(grants.length, migration.name).toBeGreaterThan(0);
      for (const privileges of grants) {
        expect(privileges, migration.name).not.toContain("delete");
        expect(privileges.trim(), migration.name).not.toBe("all");
      }
    }
  });

  it("tidak pernah menjalankan DELETE FROM pada tabel data", () => {
    for (const migration of ALL_MIGRATIONS) {
      for (const table of DATA_TABLES) {
        const re = new RegExp(`delete\\s+from\\s+public\\.${table}\\b`, "i");
        expect(migration.sql, `${migration.name} / ${table}`).not.toMatch(re);
      }
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

/**
 * `0002_batch_operations.sql` — satu tindakan = satu Batch (ADR-006).
 *
 * The behavioural proof lives in `scripts/verify-schema.sql` §18, which needs
 * a running PostgreSQL. These are the rules that can be read off the file, so
 * they also fail for someone without a local database.
 */
describe("0002_batch_operations.sql — ADR-006", () => {
  const ENTRY_POINTS = [
    "merge_org_unit",
    "merge_jabatan",
    "merge_lookup",
    "apply_revert",
    "revert_batch",
  ];

  /** Body of one `create or replace function public.<name>(` block. */
  function bodyOf(name: string): string {
    const start = batchOpsSql.indexOf(
      `create or replace function public.${name}(`,
    );
    expect(start, `${name} harus ada di 0002`).toBeGreaterThan(-1);
    const rest = batchOpsSql.slice(start);
    return rest.slice(0, rest.indexOf("$fn$;"));
  }

  it("membuat kelima fungsi entry point", () => {
    for (const fn of ENTRY_POINTS) {
      expect(batchOpsSql, `${fn} harus dibuat`).toMatch(
        new RegExp(`create or replace function public\\.${fn}\\(`, "i"),
      );
    }
  });

  it("tidak satu pun fungsi SECURITY DEFINER (RLS harus tetap menggigit)", () => {
    // SECURITY DEFINER tanpa pemeriksaan role di dalamnya menyerahkan hak admin
    // ke viewer. Pilihannya: SECURITY INVOKER + assert_admin() (ADR-006).
    const code = batchOpsSql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/security\s+definer/i);
  });

  it("setiap entry point memanggil assert_admin() lebih dulu", () => {
    for (const fn of ENTRY_POINTS) {
      expect(bodyOf(fn), `${fn} harus memanggil assert_admin()`).toContain(
        "perform public.assert_admin(",
      );
    }
  });

  it("mengunci baris asal & tujuan sebelum memeriksa merged_into_id", () => {
    // Tanpa FOR UPDATE, dua admin yang menggabungkan asal yang sama pada saat
    // bersamaan sama-sama lolos gerbang "sudah pernah digabungkan", dan yang
    // kedua menulis merged_into_id ke tujuan yang salah.
    for (const [fn, table] of [
      ["merge_org_unit", "org_units"],
      ["merge_jabatan", "jabatan"],
      ["merge_lookup", "lookups"],
    ] as const) {
      const body = bodyOf(fn);
      const lock = new RegExp(
        `perform 1 from public\\.${table}\\s+where id in \\(p_source, p_target\\)\\s+order by id\\s+for update;`,
      );
      expect(body, `${fn} harus mengunci asal & tujuan`).toMatch(lock);
      // Kuncinya harus datang SEBELUM barisnya dibaca.
      expect(
        body.indexOf("for update;"),
        `${fn}: kunci harus sebelum select`,
      ).toBeLessThan(body.indexOf("select * into v_source"));
    }
  });

  it("revert_batch mengunci Batch-nya sebelum memeriksa reverted_by_batch_id", () => {
    expect(bodyOf("revert_batch")).toMatch(
      /select \* into v_batch from public\.batches where id = p_batch_id for update;/,
    );
  });

  it("membuka Batch lewat begin_batch dengan scope transaksi (p_local = true)", () => {
    const opens = [...batchOpsSql.matchAll(/public\.begin_batch\(/g)];
    expect(opens.length).toBe(ENTRY_POINTS.length);
    // `p_local => false` bocor lewat koneksi pooled (ADR-005 §9); di dalam satu
    // fungsi, scope transaksi justru sudah mencakup seluruh Batch.
    expect(batchOpsSql).not.toMatch(/begin_batch\([\s\S]{0,200}?false\s*\n?\s*\)/);
  });

  it("tidak pernah menulis revisions, dan hanya reverted_by_batch_id di batches", () => {
    expect(batchOpsSql).not.toMatch(/update\s+public\.revisions\b/i);
    expect(batchOpsSql).not.toMatch(/insert\s+into\s+public\.revisions\b/i);
    const batchUpdates = [
      ...batchOpsSql.matchAll(/update\s+public\.batches\b([\s\S]*?);/gi),
    ];
    expect(batchUpdates.length).toBe(1);
    expect(batchUpdates[0][1]).toContain("reverted_by_batch_id");
  });

  it("merge_lookup memakai UPDATE statis per tipe, bukan SQL dinamis", () => {
    // Nama kolom dari pemanggil tidak boleh pernah di-interpolasi. Sebelas
    // cabang CASE = sebelas kolom di LOOKUP_TYPE_TO_EMPLOYEE_COLUMN.
    const body = bodyOf("merge_lookup");
    expect(body).not.toMatch(/\bexecute\b/i);
    for (const column of [
      "gender_id",
      "work_contract_id",
      "person_grade_id",
      "job_grade_id",
      "legal_entity_id",
      "klasifikasi_rekrutmen_id",
      "teknik_non_teknik_id",
      "bod_range_id",
      "band_jabatan_id",
      "kategori_penempatan_id",
      "kategori_fungsi_id",
    ]) {
      expect(body, `merge_lookup harus menangani ${column}`).toContain(
        `update public.employees set ${column} = p_target`,
      );
    }
  });

  it("apply_revert_operation membatasi tabel ke tujuh tabel ter-log", () => {
    const body = bodyOf("apply_revert_operation");
    for (const table of LOGGED_TABLES) {
      expect(body, `${table} harus ada di allow-list`).toContain(`'${table}'`);
    }
    // Revert sebuah insert menonaktifkan, tidak pernah menghapus (ADR-003).
    expect(body).toContain("'status', 'nonaktif'");
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("hanya memberi EXECUTE ke authenticated & service_role, tidak ke anon", () => {
    const grants = [
      ...batchOpsSql.matchAll(/grant execute on function[\s\S]*?to ([^;]+);/gi),
    ].map((m) => m[1].replace(/\s+/g, " ").trim());
    expect(grants.length).toBeGreaterThan(0);
    for (const target of grants) {
      expect(target).toBe("authenticated, service_role");
    }
    // `create function` memberi EXECUTE ke PUBLIC secara default, jadi setiap
    // fungsi harus dicabut lebih dulu.
    const revokes = [
      ...batchOpsSql.matchAll(/revoke all on function[\s\S]*?from public;/gi),
    ];
    expect(revokes.length).toBe(grants.length);
  });
});
