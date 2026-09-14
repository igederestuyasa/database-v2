/**
 * scripts/gen-types-from-pg.ts
 *
 * Generates `lib/types/db.ts` and `lib/schema/columns.generated.ts` by reading
 * the live catalog of a database that has every `supabase/migrations/*.sql`
 * applied.
 *
 * This replaces `supabase gen types typescript`, which cannot run here:
 * supabase.com is blocked by the egress proxy and the Supabase CLI is
 * unavailable. Reading a real Postgres catalog is strictly better than
 * hand-writing the types — it cannot drift from the migration.
 *
 * Usage:
 *     npm run db:local          # apply shim + migration to local PG16
 *     npm run gen:types         # regenerate both files
 *
 * `pg` is a devDependency used only by this harness. It is not an ORM and does
 * not conflict with ADR-001 — no application code imports it.
 */
import { Client } from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");

const TABLES = [
  "employees",
  "employee_private",
  "org_units",
  "jabatan",
  "lookups",
  "batches",
  "revisions",
  "api_keys",
  "profiles",
] as const;

const VIEWS = ["v_employees", "v_employees_private", "v_employees_api"] as const;

/**
 * `information_schema` reports every view column as nullable, because Postgres
 * does not track nullability through a view definition. These columns come
 * straight off the driving table of the view (`employees`, never outer-joined)
 * and are NOT NULL there, so it is safe — and much kinder to callers — to type
 * them as non-null. Anything not listed here stays nullable.
 *
 * The generator fails loudly if an entry here names a column the view does not
 * actually have, so this list cannot silently rot.
 */
const VIEW_NOT_NULL: Record<string, readonly string[]> = {
  v_employees: [
    "id",
    "personnel_number",
    "full_name",
    "status",
    "created_at",
    "updated_at",
  ],
  v_employees_private: [
    "id",
    "personnel_number",
    "full_name",
    "status",
    "created_at",
    "updated_at",
  ],
  v_employees_api: [
    "id",
    "personnel_number",
    "full_name",
    "status",
    "updated_at",
  ],
};

type ColumnRow = {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  has_default: boolean;
  is_identity: "YES" | "NO";
};

type FunctionRow = {
  proname: string;
  argnames: string[];
  argtypes: string[];
  nargdefaults: number;
  rettype: string;
  retset: boolean;
};

function tsType(col: Pick<ColumnRow, "data_type" | "udt_name">): string {
  if (col.data_type === "ARRAY") {
    const element = col.udt_name.replace(/^_/, "");
    return `${scalarType(element)}[]`;
  }
  return scalarType(col.udt_name);
}

function scalarType(udt: string): string {
  switch (udt) {
    case "uuid":
    case "text":
    case "varchar":
    case "bpchar":
    case "name":
    case "date":
    case "timestamp":
    case "timestamptz":
    case "time":
    case "timetz":
    case "interval":
    case "citext":
      return "string";
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Json";
    default:
      return "string";
  }
}

function pgTypeNameToTs(name: string): string {
  const base = name.replace(/\[\]$/, "");
  const isArray = name.endsWith("[]");
  const map: Record<string, string> = {
    uuid: "string",
    text: "string",
    "character varying": "string",
    date: "string",
    "timestamp with time zone": "string",
    "timestamp without time zone": "string",
    boolean: "boolean",
    integer: "number",
    bigint: "number",
    smallint: "number",
    numeric: "number",
    "double precision": "number",
    real: "number",
    json: "Json",
    jsonb: "Json",
    void: "undefined",
  };
  const ts = map[base] ?? "unknown";
  return isArray ? `${ts}[]` : ts;
}

function quoteKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function indent(lines: string[], depth: number): string {
  const pad = "  ".repeat(depth);
  return lines.map((l) => (l ? pad + l : l)).join("\n");
}

async function main() {
  const conn =
    process.env.HC_LOCAL_DB_URL ??
    process.env.DATABASE_URL ??
    undefined;

  const client = conn
    ? new Client({ connectionString: conn })
    : new Client({
        host: process.env.PGHOST ?? "/var/run/postgresql",
        database: process.env.HC_LOCAL_DB ?? "hc_core_test",
        // node-postgres falls back to $USER, which is not always set in CI-ish
        // shells; ask the OS directly.
        user: process.env.PGUSER ?? userInfo().username,
      });

  await client.connect();

  const { rows: columns } = await client.query<ColumnRow>(
    `select c.table_name,
            c.column_name,
            c.ordinal_position,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            (c.column_default is not null) as has_default,
            c.is_identity
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = any($1::text[])
      order by c.table_name, c.ordinal_position`,
    [[...TABLES, ...VIEWS]],
  );

  const { rows: functions } = await client.query<FunctionRow>(
    `select p.proname,
            coalesce(p.proargnames, '{}')::text[] as argnames,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes,
            p.pronargdefaults as nargdefaults,
            format_type(p.prorettype, null) as rettype,
            p.proretset as retset
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and format_type(p.prorettype, null) <> 'trigger'
        -- exclude functions that belong to an extension (pgcrypto, pg_trgm):
        -- they are not part of HC Core's RPC surface.
        and not exists (
          select 1 from pg_depend d
           where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
        )
      order by p.proname`,
  );

  await client.end();

  const byRelation = new Map<string, ColumnRow[]>();
  for (const c of columns) {
    const list = byRelation.get(c.table_name) ?? [];
    list.push(c);
    byRelation.set(c.table_name, list);
  }

  for (const rel of [...TABLES, ...VIEWS]) {
    if (!byRelation.has(rel)) {
      throw new Error(
        `Relasi "${rel}" tidak ada di database. Jalankan \`npm run db:local\` dulu.`,
      );
    }
  }

  // Fail loudly if a VIEW_NOT_NULL override names a column that is gone.
  for (const [view, cols] of Object.entries(VIEW_NOT_NULL)) {
    const actual = new Set((byRelation.get(view) ?? []).map((c) => c.column_name));
    for (const col of cols) {
      if (!actual.has(col)) {
        throw new Error(
          `VIEW_NOT_NULL[${view}] menyebut kolom "${col}" yang tidak ada di view tersebut. ` +
            `Perbarui scripts/gen-types-from-pg.ts.`,
        );
      }
    }
  }

  // ---- lib/types/db.ts ----------------------------------------------------
  const tableBlocks = TABLES.map((name) => {
    const cols = byRelation.get(name)!;

    const row = cols.map((c) => {
      const t = tsType(c);
      const nullable = c.is_nullable === "YES";
      return `${quoteKey(c.column_name)}: ${t}${nullable ? " | null" : ""};`;
    });

    const insert = cols.map((c) => {
      const t = tsType(c);
      const nullable = c.is_nullable === "YES";
      const optional = nullable || c.has_default || c.is_identity === "YES";
      return `${quoteKey(c.column_name)}${optional ? "?" : ""}: ${t}${nullable ? " | null" : ""};`;
    });

    const update = cols.map((c) => {
      const t = tsType(c);
      const nullable = c.is_nullable === "YES";
      return `${quoteKey(c.column_name)}?: ${t}${nullable ? " | null" : ""};`;
    });

    return [
      `${quoteKey(name)}: {`,
      `  Row: {`,
      indent(row, 2),
      `  };`,
      `  Insert: {`,
      indent(insert, 2),
      `  };`,
      `  Update: {`,
      indent(update, 2),
      `  };`,
      `  Relationships: [];`,
      `};`,
    ].join("\n");
  });

  const viewBlocks = VIEWS.map((name) => {
    const cols = byRelation.get(name)!;
    const forced = new Set(VIEW_NOT_NULL[name] ?? []);
    const row = cols.map((c) => {
      const t = tsType(c);
      const nullable = c.is_nullable === "YES" && !forced.has(c.column_name);
      return `${quoteKey(c.column_name)}: ${t}${nullable ? " | null" : ""};`;
    });
    return [
      `${quoteKey(name)}: {`,
      `  Row: {`,
      indent(row, 2),
      `  };`,
      `  Relationships: [];`,
      `};`,
    ].join("\n");
  });

  const functionBlocks = functions.map((f) => {
    const nargs = f.argtypes.length;
    const firstOptional = nargs - (f.nargdefaults ?? 0);
    const args = f.argtypes.map((t, i) => {
      const argName = f.argnames[i] ?? `arg${i + 1}`;
      const optional = i >= firstOptional;
      return `${quoteKey(argName)}${optional ? "?" : ""}: ${pgTypeNameToTs(t)};`;
    });
    const ret = pgTypeNameToTs(f.rettype);
    return [
      `${quoteKey(f.proname)}: {`,
      args.length ? `  Args: {` : `  Args: Record<PropertyKey, never>;`,
      ...(args.length ? [indent(args, 2), `  };`] : []),
      `  Returns: ${f.retset ? `${ret}[]` : ret};`,
      `};`,
    ].join("\n");
  });

  const dbTs = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Produced by \`npm run gen:types\` (scripts/gen-types-from-pg.ts) from the live
// catalog of a database with every supabase/migrations/*.sql applied.
// The Supabase CLI's \`gen types\` cannot run in this environment, so this is
// the project's source of database types.
//
// To change a type, change the migration and regenerate:
//     npm run db:local && npm run gen:types
//
// FROZEN CONTRACT: downstream work reads this file, never edits it.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
${indent(tableBlocks.join("\n").split("\n"), 3)}
    };
    Views: {
${indent(viewBlocks.join("\n").split("\n"), 3)}
    };
    Functions: {
${indent(functionBlocks.join("\n").split("\n"), 3)}
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type ViewRow<T extends keyof PublicSchema["Views"]> =
  PublicSchema["Views"][T]["Row"];
export type FunctionArgs<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T]["Args"];
export type FunctionReturns<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T]["Returns"];

// Convenience aliases for the rows this app passes around most.
export type Employee = Tables<"employees">;
export type EmployeePrivate = Tables<"employee_private">;
export type OrgUnit = Tables<"org_units">;
export type Jabatan = Tables<"jabatan">;
export type Lookup = Tables<"lookups">;
export type Batch = Tables<"batches">;
export type Revision = Tables<"revisions">;
export type ApiKey = Tables<"api_keys">;
export type Profile = Tables<"profiles">;

export type VEmployee = ViewRow<"v_employees">;
export type VEmployeePrivate = ViewRow<"v_employees_private">;
export type VEmployeeApi = ViewRow<"v_employees_api">;
`;

  mkdirSync(path.join(ROOT, "lib", "types"), { recursive: true });
  writeFileSync(path.join(ROOT, "lib", "types", "db.ts"), dbTs, "utf8");

  // ---- lib/schema/columns.generated.ts ------------------------------------
  const listOf = (name: string) =>
    (byRelation.get(name) ?? []).map((c) => `  ${JSON.stringify(c.column_name)},`).join("\n");

  const columnsTs = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Produced by \`npm run gen:types\` (scripts/gen-types-from-pg.ts).
//
// TypeScript cannot see inside the string passed to
// \`supabase.from("v_employees").select("personnel_number, full_name")\`, so a
// typo there compiles fine and only fails against a real database. These lists
// let \`npm run check:columns\` (scripts/check-select-columns.ts) catch it at
// test time instead.

${TABLES.map(
  (t) => `export const ${t.toUpperCase()}_COLUMNS = [\n${listOf(t)}\n] as const;`,
).join("\n\n")}

${VIEWS.map(
  (v) => `export const ${v.toUpperCase()}_COLUMNS = [\n${listOf(v)}\n] as const;`,
).join("\n\n")}

/**
 * Every queryable relation in schema \`public\`, mapped to its column names.
 *
 * \`as const satisfies\` rather than a \`Record<string, …>\` annotation, so that
 * \`RelationName\` stays the exact union of relation names instead of widening
 * to \`string\` — which would let a typo through the very check this file exists
 * for.
 */
export const RELATION_COLUMNS = {
${[...TABLES, ...VIEWS].map((r) => `  ${quoteKey(r)}: ${r.toUpperCase()}_COLUMNS,`).join("\n")}
} as const satisfies Record<string, readonly string[]>;

export type RelationName = keyof typeof RELATION_COLUMNS;

/**
 * The universe of \`api_keys.allowed_fields\` — every column a Konsumen may ask
 * for. Equals the column list of \`v_employees_api\` (ADR-004, API-CONTRACT.md).
 */
export const API_EMPLOYEE_FIELDS = V_EMPLOYEES_API_COLUMNS;
`;

  mkdirSync(path.join(ROOT, "lib", "schema"), { recursive: true });
  writeFileSync(
    path.join(ROOT, "lib", "schema", "columns.generated.ts"),
    columnsTs,
    "utf8",
  );

  console.log(
    `generated lib/types/db.ts (${TABLES.length} tabel, ${VIEWS.length} view, ${functions.length} function)`,
  );
  console.log("generated lib/schema/columns.generated.ts");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
