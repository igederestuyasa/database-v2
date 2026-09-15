/**
 * The five `/api/v1` endpoints, exercised end to end against a fake client.
 *
 * This environment cannot reach Supabase (ADR-005) and `supabase.com` is
 * blocked, so these handlers would otherwise ship unexecuted. They do not have
 * to: a Route Handler is a plain function, and the one thing it needs from the
 * outside — the service-role client — is injected. Everything below therefore
 * runs the *real* handler, the real `lib/api/{auth,fields,query}.ts` and the
 * real frozen envelopes, with only the network replaced.
 *
 * What that proves, which is most of the Fase 4 exit criteria:
 *
 *   * `401` for a missing, malformed, unknown or nonaktif key — and that a
 *     missing key never even builds a client, so the answer is 401 rather than
 *     "server misconfigured" on a deployment with no environment variables;
 *   * a key whitelisted for four columns gets exactly those four, and asking
 *     for a fifth is `403` naming it;
 *   * `400` for `FIELDS_REQUIRED`, `UNKNOWN_FIELD` and `UNKNOWN_LOOKUP_TYPE`;
 *   * `405` for every method that is not GET;
 *   * the `{ data, meta }` envelope and `per_page` clamping at 500;
 *   * that no handler ever names `employee_private` or `v_employees_private`.
 *
 * Dummy data only (CLAUDE.md): no real Karyawan appears in this repository.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { hashApiKey } from "@/lib/api/auth";
import type { AdminClient } from "@/lib/supabase/admin";

import { handleEmployeeDetail, handleEmployeesList } from "@/app/api/v1/_lib/employees";
import {
  handleJabatan,
  handleLookups,
  handleOrgUnits,
} from "@/app/api/v1/_lib/reference";

import * as employeesRoute from "@/app/api/v1/employees/route";
import * as employeeDetailRoute from "@/app/api/v1/employees/[personnel_number]/route";
import * as jabatanRoute from "@/app/api/v1/jabatan/route";
import * as lookupsRoute from "@/app/api/v1/lookups/route";
import * as orgUnitsRoute from "@/app/api/v1/org-units/route";

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures — dummy data, shaped like the real relations
 * ──────────────────────────────────────────────────────────────────────────── */

const KEY = `hck_${"Perf0App1".repeat(4)}abcd`;
const OTHER_KEY = `hck_${"Other0App".repeat(4)}wxyz`;

/** The ROADMAP's worked example: "Perf App" with a whitelist of four columns. */
const PERF_APP_FIELDS = [
  "personnel_number",
  "full_name",
  "divisi_nama",
  "jabatan_nama",
];

const DIVISI_ID = "11111111-1111-4111-8111-111111111111";
const PROYEK_ID = "22222222-2222-4222-8222-222222222222";
const LAIN_ID = "33333333-3333-4333-8333-333333333333";
const JABATAN_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

function employee(overrides: Row): Row {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    personnel_number: "TEST-0001",
    nip: "9001",
    full_name: "Dummy Satu",
    status: "aktif",
    tanggal_keluar: null,
    org_unit_id: DIVISI_ID,
    divisi_nama: "Divisi Uji",
    jabatan_id: JABATAN_ID,
    jabatan_nama: "Jabatan Uji",
    person_grade_label: "PG-7",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function fixtures() {
  return {
    api_keys: [
      {
        id: "key-perf",
        nama_konsumen: "Perf App",
        key_prefix: KEY.slice(0, 8),
        key_hash: hashApiKey(KEY),
        allowed_fields: PERF_APP_FIELDS,
        status: "aktif",
        last_used_at: null as string | null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "key-mati",
        nama_konsumen: "Aplikasi Pensiun",
        key_prefix: OTHER_KEY.slice(0, 8),
        key_hash: hashApiKey(OTHER_KEY),
        allowed_fields: PERF_APP_FIELDS,
        status: "nonaktif",
        last_used_at: null as string | null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ] satisfies Row[],

    v_employees_api: [
      employee({}),
      employee({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        personnel_number: "TEST-0002",
        nip: "9002",
        full_name: "Dummy Dua",
        org_unit_id: PROYEK_ID,
        updated_at: "2026-06-01T00:00:00.000Z",
      }),
      employee({
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        personnel_number: "TEST-0003",
        nip: "9003",
        full_name: "Dummy Tiga",
        status: "nonaktif",
        tanggal_keluar: "2026-02-01",
        org_unit_id: LAIN_ID,
      }),
    ] satisfies Row[],

    org_units: [
      {
        id: DIVISI_ID,
        kode: "DIV-UJI",
        nama: "Divisi Uji",
        tipe: "divisi",
        parent_id: null,
        status: "aktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: PROYEK_ID,
        kode: "PRY-UJI",
        nama: "Proyek Uji",
        tipe: "proyek",
        parent_id: DIVISI_ID,
        status: "aktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: LAIN_ID,
        kode: "DIV-LAIN",
        nama: "Divisi Lain",
        tipe: "divisi",
        parent_id: null,
        status: "nonaktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ] satisfies Row[],

    jabatan: [
      {
        id: JABATAN_ID,
        kode: "JAB-001",
        nama: "Jabatan Uji",
        status: "aktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        kode: "JAB-002",
        nama: "Jabatan Lama",
        status: "nonaktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ] satisfies Row[],

    lookups: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        tipe: "job_grade",
        kode: "JG-1",
        label: "Job Grade 1",
        urutan: 1,
        status: "aktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        tipe: "gender",
        kode: "L",
        label: "Laki-laki",
        urutan: 1,
        status: "aktif",
        merged_into_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ] satisfies Row[],
  } satisfies Record<string, Row[]>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * A fake PostgREST client — just enough of it, and no network
 * ──────────────────────────────────────────────────────────────────────────── */

type FakeCall = {
  relation: string;
  columns: string | null;
  operation: "select" | "update";
};

type FakeOptions = {
  /** Force a PostgREST failure on this relation, to exercise the 500 path. */
  failOn?: string;
};

function createFakeClient(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  const updates: { relation: string; values: Row }[] = [];

  function builder(relation: string) {
    const source = tables[relation] ?? [];
    const filters: ((row: Row) => boolean)[] = [];
    let columns: string[] | null = null;
    let columnsRaw: string | null = null;
    let wantCount = false;
    let sort: { column: string; ascending: boolean }[] = [];
    let slice: { from: number; to: number } | null = null;
    let cap: number | null = null;
    let single = false;

    const chain = {
      select(list?: string, opts?: { count?: string }) {
        columnsRaw = list ?? "*";
        columns = list && list !== "*" ? list.split(",").map((c) => c.trim()) : null;
        wantCount = opts?.count === "exact";
        calls.push({ relation, columns: columnsRaw, operation: "select" });
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return chain;
      },
      is(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column]) >= value);
        return chain;
      },
      or(expression: string) {
        const terms = splitOrTerms(expression);
        filters.push((row) =>
          terms.some(({ column, pattern }) => ilike(row[column], pattern)),
        );
        return chain;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        sort = [...sort, { column, ascending: opts?.ascending ?? true }];
        return chain;
      },
      range(from: number, to: number) {
        slice = { from, to };
        return chain;
      },
      limit(value: number) {
        cap = value;
        return chain;
      },
      maybeSingle() {
        single = true;
        return chain;
      },
      update(values: Row) {
        updates.push({ relation, values });
        calls.push({ relation, columns: null, operation: "update" });
        return {
          eq: async () => ({ data: null, error: null }),
        };
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };

    function run() {
      if (options.failOn === relation) {
        return {
          data: null,
          count: null,
          error: {
            message: 'permission denied for view v_employees_private',
            details: "rahasia",
            hint: null,
            code: "42501",
          },
        };
      }

      let rows = source.filter((row) => filters.every((keep) => keep(row)));
      for (const { column, ascending } of [...sort].reverse()) {
        rows = [...rows].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      const total = rows.length;
      if (slice) rows = rows.slice(slice.from, slice.to + 1);
      else if (cap !== null) rows = rows.slice(0, cap);

      const picked = columns;
      const projected = picked
        ? rows.map((row) => Object.fromEntries(picked.map((c) => [c, row[c]])))
        : rows;

      return {
        data: single ? (projected[0] ?? null) : projected,
        count: wantCount ? total : null,
        error: null,
      };
    }

    return chain;
  }

  const client = { from: (relation: string) => builder(relation) };
  return { client: client as unknown as AdminClient, calls, updates };
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

/** Parse `full_name.ilike."%x%",nip.ilike."%x%"` into column/pattern pairs. */
function splitOrTerms(expression: string): { column: string; pattern: string }[] {
  const terms: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const character of expression) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === "(") depth++;
    if (!quoted && character === ")") depth--;
    if (!quoted && depth === 0 && character === ",") {
      terms.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) terms.push(current);

  return terms.map((term) => {
    const [column, , ...rest] = term.split(".");
    const raw = rest.join(".");
    return { column, pattern: raw.replace(/^"|"$/g, "") };
  });
}

function ilike(value: unknown, pattern: string): boolean {
  if (typeof value !== "string") return false;
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`,
    "i",
  );
  return regex.test(value);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function request(url: string, token: string | null = KEY, method = "GET"): Request {
  return new Request(`https://hc.example${url}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

type Body = Record<string, unknown>;

async function json(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}

function deps(tables = fixtures(), options: FakeOptions = {}) {
  const fake = createFakeClient(tables, options);
  return {
    ...fake,
    createClient: vi.fn(() => fake.client),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tests
 * ──────────────────────────────────────────────────────────────────────────── */

describe("otentikasi — API Key adalah satu-satunya gerbang", () => {
  it("401 tanpa header Authorization, dengan envelope yang tepat", async () => {
    const d = deps();
    const response = await handleEmployeesList(request("/api/v1/employees", null), d);

    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "API Key tidak valid atau tidak aktif.",
      },
    });
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("401 tanpa key tidak pernah membangun client — jadi tanpa env pun tetap 401", async () => {
    const d = deps();
    await handleEmployeesList(request("/api/v1/employees", null), d);
    expect(d.createClient).not.toHaveBeenCalled();
  });

  it("401 untuk key yang tidak dikenal", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name", `hck_${"z".repeat(40)}`),
      deps(),
    );
    expect(response.status).toBe(401);
  });

  it("401 untuk key yang sudah dinonaktifkan", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name", OTHER_KEY),
      deps(),
    );
    expect(response.status).toBe(401);
    expect((await json(response)).error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("401 untuk key yang bentuknya salah", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name", "bukan-key"),
      deps(),
    );
    expect(response.status).toBe(401);
  });

  it("setiap endpoint dijaga, bukan hanya /employees", async () => {
    for (const handler of [handleOrgUnits, handleJabatan, handleLookups]) {
      const response = await handler(request("/api/v1/x", null), deps());
      expect(response.status).toBe(401);
    }
    const detail = await handleEmployeeDetail(
      request("/api/v1/employees/TEST-0001", null),
      "TEST-0001",
      deps(),
    );
    expect(detail.status).toBe(401);
  });

  it("mencatat last_used_at setelah key diterima", async () => {
    const d = deps();
    await handleEmployeesList(
      request("/api/v1/employees?fields=full_name"),
      d,
    );
    expect(d.updates).toHaveLength(1);
    expect(d.updates[0].relation).toBe("api_keys");
    expect(Object.keys(d.updates[0].values)).toEqual(["last_used_at"]);
  });

  it("tidak menulis ulang last_used_at untuk key yang baru saja dipakai", async () => {
    const tables = fixtures();
    tables.api_keys[0].last_used_at = new Date().toISOString();
    const d = deps(tables);
    await handleEmployeesList(request("/api/v1/employees?fields=full_name"), d);
    expect(d.updates).toHaveLength(0);
  });

  it("tidak mencatat apa pun kalau key ditolak", async () => {
    const d = deps();
    await handleEmployeesList(request("/api/v1/employees", OTHER_KEY), d);
    expect(d.updates).toHaveLength(0);
  });
});

describe("GET /employees — pemilihan kolom", () => {
  it("400 FIELDS_REQUIRED kalau fields tidak dikirim", async () => {
    const response = await handleEmployeesList(request("/api/v1/employees"), deps());
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "FIELDS_REQUIRED" });
  });

  it("400 UNKNOWN_FIELD menyebut kolom yang tidak ada di view", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name,date_of_birth"),
      deps(),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({
      code: "UNKNOWN_FIELD",
      details: { fields: ["date_of_birth"] },
    });
  });

  it("403 FIELD_NOT_ALLOWED menyebut kolom di luar whitelist key", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name,person_grade_label"),
      deps(),
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({
      code: "FIELD_NOT_ALLOWED",
      details: { fields: ["person_grade_label"] },
    });
  });

  it("403 tidak mengembalikan baris apa pun — bukan sebagian", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=full_name,person_grade_label"),
        deps(),
      ),
    );
    expect(body).not.toHaveProperty("data");
  });

  it("key dengan whitelist 4 kolom mendapat tepat 4 kolom", async () => {
    const response = await handleEmployeesList(
      request(`/api/v1/employees?fields=${PERF_APP_FIELDS.join(",")}`),
      deps(),
    );
    const body = await json(response);
    const rows = body.data as Row[];
    expect(response.status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(PERF_APP_FIELDS);
    }
  });

  it("400 kalau fields dikirim dua kali — bukan diam-diam baris sebagian", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=personnel_number&fields=full_name"),
      deps(),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({
      code: "INVALID_QUERY",
      details: { param: "fields" },
    });
  });

  it("urutan kolom mengikuti urutan permintaan", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=full_name,personnel_number"),
        deps(),
      ),
    );
    expect(Object.keys((body.data as Row[])[0])).toEqual([
      "full_name",
      "personnel_number",
    ]);
  });
});

describe("GET /employees — envelope & pagination", () => {
  it("{ data, meta } dengan per_page snake_case", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number"),
        deps(),
      ),
    );
    expect(body.meta).toEqual({ page: 1, per_page: 100, total: 2 });
  });

  it("total menghitung seluruh hasil filter, bukan hanya satu halaman", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&per_page=1"),
        deps(),
      ),
    );
    expect((body.data as Row[]).length).toBe(1);
    expect(body.meta).toEqual({ page: 1, per_page: 1, total: 2 });
  });

  it("halaman kedua memuat baris berikutnya", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&per_page=1&page=2"),
        deps(),
      ),
    );
    expect(body.data).toEqual([{ personnel_number: "TEST-0002" }]);
  });

  it("per_page dibatasi 500 dan angka itulah yang dilaporkan di meta", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&per_page=10000"),
        deps(),
      ),
    );
    expect(body.meta).toMatchObject({ per_page: 500 });
  });

  it("400 untuk per_page yang bukan angka", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=personnel_number&per_page=banyak"),
      deps(),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "INVALID_QUERY" });
  });
});

describe("GET /employees — filter", () => {
  it("default hanya Karyawan aktif", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number"),
        deps(),
      ),
    );
    expect(body.data).toEqual([
      { personnel_number: "TEST-0001" },
      { personnel_number: "TEST-0002" },
    ]);
  });

  it("status=semua memuat yang nonaktif juga", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&status=semua"),
        deps(),
      ),
    );
    expect((body.data as Row[]).length).toBe(3);
  });

  it("400 untuk status yang tidak dikenal", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=personnel_number&status=aktiv"),
      deps(),
    );
    expect(response.status).toBe(400);
  });

  it("org_unit_id ikut menyertakan unit di bawahnya", async () => {
    const body = await json(
      await handleEmployeesList(
        request(`/api/v1/employees?fields=personnel_number&org_unit_id=${DIVISI_ID}`),
        deps(),
      ),
    );
    // TEST-0002 ada di Proyek Uji, anak dari Divisi Uji.
    expect(body.data).toEqual([
      { personnel_number: "TEST-0001" },
      { personnel_number: "TEST-0002" },
    ]);
  });

  it("include_children=false membatasi ke unit itu saja", async () => {
    const body = await json(
      await handleEmployeesList(
        request(
          `/api/v1/employees?fields=personnel_number&org_unit_id=${DIVISI_ID}&include_children=false`,
        ),
        deps(),
      ),
    );
    expect(body.data).toEqual([{ personnel_number: "TEST-0001" }]);
  });

  it("400 untuk include_children yang tidak dikenal, walau tanpa org_unit_id", async () => {
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=personnel_number&include_children=yes"),
      deps(),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({
      code: "INVALID_QUERY",
      details: { param: "include_children" },
    });
  });

  it("jabatan_id menyaring pemegang jabatan", async () => {
    const body = await json(
      await handleEmployeesList(
        request(`/api/v1/employees?fields=personnel_number&jabatan_id=${JABATAN_ID}`),
        deps(),
      ),
    );
    expect((body.data as Row[]).length).toBe(2);
  });

  it("updated_since hanya membawa baris yang berubah setelahnya", async () => {
    const body = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&updated_since=2026-04-01"),
        deps(),
      ),
    );
    expect(body.data).toEqual([{ personnel_number: "TEST-0002" }]);
  });

  it("search cocok sebagian pada nama, nip, dan personnel_number", async () => {
    const byName = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&search=dua"),
        deps(),
      ),
    );
    expect(byName.data).toEqual([{ personnel_number: "TEST-0002" }]);

    const byNip = await json(
      await handleEmployeesList(
        request("/api/v1/employees?fields=personnel_number&search=9001"),
        deps(),
      ),
    );
    expect(byNip.data).toEqual([{ personnel_number: "TEST-0001" }]);
  });
});

describe("GET /employees/{personnel_number}", () => {
  it("{ data } tanpa meta", async () => {
    const response = await handleEmployeeDetail(
      request("/api/v1/employees/TEST-0001"),
      "TEST-0001",
      deps(),
    );
    const body = await json(response);
    expect(response.status).toBe(200);
    expect("meta" in body).toBe(false);
    expect(body.data).toEqual({
      personnel_number: "TEST-0001",
      full_name: "Dummy Satu",
      divisi_nama: "Divisi Uji",
      jabatan_nama: "Jabatan Uji",
    });
  });

  it("tanpa fields: seluruh whitelist key, dalam urutan kolom view", async () => {
    const body = await json(
      await handleEmployeeDetail(
        request("/api/v1/employees/TEST-0001"),
        "TEST-0001",
        deps(),
      ),
    );
    expect(Object.keys(body.data as Row)).toEqual([
      "personnel_number",
      "full_name",
      "divisi_nama",
      "jabatan_nama",
    ]);
  });

  it("fields boleh mempersempit", async () => {
    const body = await json(
      await handleEmployeeDetail(
        request("/api/v1/employees/TEST-0001?fields=full_name"),
        "TEST-0001",
        deps(),
      ),
    );
    expect(body.data).toEqual({ full_name: "Dummy Satu" });
  });

  it("403 untuk kolom di luar whitelist", async () => {
    const response = await handleEmployeeDetail(
      request("/api/v1/employees/TEST-0001?fields=person_grade_label"),
      "TEST-0001",
      deps(),
    );
    expect(response.status).toBe(403);
  });

  it("404 untuk Personnel Number yang tidak ada", async () => {
    const response = await handleEmployeeDetail(
      request("/api/v1/employees/TIDAK-ADA"),
      "TIDAK-ADA",
      deps(),
    );
    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatchObject({
      code: "NOT_FOUND",
      details: { personnel_number: "TIDAK-ADA" },
    });
  });

  it("Karyawan nonaktif tetap dikembalikan, dengan status nonaktif", async () => {
    const tables = fixtures();
    tables.api_keys[0].allowed_fields = [...PERF_APP_FIELDS, "status"];
    const response = await handleEmployeeDetail(
      request("/api/v1/employees/TEST-0003?fields=personnel_number,status"),
      "TEST-0003",
      deps(tables),
    );
    expect(response.status).toBe(200);
    expect((await json(response)).data).toEqual({
      personnel_number: "TEST-0003",
      status: "nonaktif",
    });
  });
});

describe("GET /org-units", () => {
  it("{ data } tanpa meta, dengan enam kolom yang dijanjikan kontrak", async () => {
    const response = await handleOrgUnits(request("/api/v1/org-units"), deps());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect("meta" in body).toBe(false);
    expect(Object.keys((body.data as Row[])[0])).toEqual([
      "id",
      "kode",
      "nama",
      "tipe",
      "parent_id",
      "status",
    ]);
  });

  it("default hanya unit aktif", async () => {
    const body = await json(await handleOrgUnits(request("/api/v1/org-units"), deps()));
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["DIV-UJI", "PRY-UJI"]);
  });

  it("status=semua memuat yang nonaktif", async () => {
    const body = await json(
      await handleOrgUnits(request("/api/v1/org-units?status=semua"), deps()),
    );
    expect((body.data as Row[]).length).toBe(3);
  });

  it("menyaring per tipe", async () => {
    const body = await json(
      await handleOrgUnits(request("/api/v1/org-units?tipe=proyek"), deps()),
    );
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["PRY-UJI"]);
  });

  it("menyaring per parent_id", async () => {
    const body = await json(
      await handleOrgUnits(request(`/api/v1/org-units?parent_id=${DIVISI_ID}`), deps()),
    );
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["PRY-UJI"]);
  });

  it("400 untuk tipe di luar daftar", async () => {
    const response = await handleOrgUnits(
      request("/api/v1/org-units?tipe=job_grade"),
      deps(),
    );
    expect(response.status).toBe(400);
  });

  it("tidak dibatasi whitelist kolom key — struktur bukan data pribadi", async () => {
    const tables = fixtures();
    tables.api_keys[0].allowed_fields = ["personnel_number"];
    const response = await handleOrgUnits(request("/api/v1/org-units"), deps(tables));
    expect(response.status).toBe(200);
  });
});

describe("GET /jabatan", () => {
  it("{ data } dengan empat kolom yang dijanjikan kontrak", async () => {
    const body = await json(await handleJabatan(request("/api/v1/jabatan"), deps()));
    expect(Object.keys((body.data as Row[])[0])).toEqual(["id", "kode", "nama", "status"]);
  });

  it("default hanya jabatan aktif", async () => {
    const body = await json(await handleJabatan(request("/api/v1/jabatan"), deps()));
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["JAB-001"]);
  });

  it("status=nonaktif membalik pilihannya", async () => {
    const body = await json(
      await handleJabatan(request("/api/v1/jabatan?status=nonaktif"), deps()),
    );
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["JAB-002"]);
  });
});

describe("GET /lookups", () => {
  it("400 UNKNOWN_LOOKUP_TYPE kalau tipe tidak dikirim", async () => {
    const response = await handleLookups(request("/api/v1/lookups"), deps());
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "UNKNOWN_LOOKUP_TYPE" });
  });

  it("400 UNKNOWN_LOOKUP_TYPE untuk tipe yang tidak dikenal", async () => {
    const response = await handleLookups(request("/api/v1/lookups?tipe=jabatan"), deps());
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error).toMatchObject({
      code: "UNKNOWN_LOOKUP_TYPE",
      details: { tipe: "jabatan" },
    });
  });

  it("{ data } dengan enam kolom yang dijanjikan kontrak", async () => {
    const body = await json(
      await handleLookups(request("/api/v1/lookups?tipe=job_grade"), deps()),
    );
    expect(body.data).toEqual([
      {
        id: "66666666-6666-4666-8666-666666666666",
        tipe: "job_grade",
        kode: "JG-1",
        label: "Job Grade 1",
        urutan: 1,
        status: "aktif",
      },
    ]);
  });

  it("hanya tipe yang diminta", async () => {
    const body = await json(
      await handleLookups(request("/api/v1/lookups?tipe=gender"), deps()),
    );
    expect((body.data as Row[]).map((row) => row.kode)).toEqual(["L"]);
  });
});

describe("kegagalan database", () => {
  it("500 generik, tanpa membocorkan pesan PostgREST", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleEmployeesList(
      request("/api/v1/employees?fields=full_name"),
      deps(fixtures(), { failOn: "v_employees_api" }),
    );
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan di server." },
    });
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(JSON.stringify(body)).not.toContain("42501");
    spy.mockRestore();
  });
});

describe("relasi yang dibaca", () => {
  const ALLOWED = new Set(["api_keys", "v_employees_api", "org_units", "jabatan", "lookups"]);

  it("tidak satu pun handler menyentuh employee_private atau v_employees_private", async () => {
    const d = deps();
    await handleEmployeesList(
      request(`/api/v1/employees?fields=full_name&org_unit_id=${DIVISI_ID}&search=dummy`),
      d,
    );
    await handleEmployeeDetail(request("/api/v1/employees/TEST-0001"), "TEST-0001", d);
    await handleOrgUnits(request("/api/v1/org-units"), d);
    await handleJabatan(request("/api/v1/jabatan"), d);
    await handleLookups(request("/api/v1/lookups?tipe=job_grade"), d);

    expect(d.calls.length).toBeGreaterThan(0);
    for (const call of d.calls) {
      expect(ALLOWED).toContain(call.relation);
    }
  });

  it("hanya api_keys yang pernah ditulis, dan hanya last_used_at", async () => {
    const d = deps();
    await handleEmployeesList(request("/api/v1/employees?fields=full_name"), d);
    await handleOrgUnits(request("/api/v1/org-units"), d);
    for (const update of d.updates) {
      expect(update.relation).toBe("api_keys");
      expect(Object.keys(update.values)).toEqual(["last_used_at"]);
    }
  });
});

describe("kode sumber app/api/v1", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");
  const FORBIDDEN = ["employee_private", "v_employees_private"];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (full.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  const routeFiles = walk(path.join(ROOT, "app", "api", "v1"));

  it("tidak menyebut relasi Data Pribadi Sensitif di mana pun", () => {
    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      for (const name of FORBIDDEN) {
        // Disebut dalam komentar penjelas boleh; dalam `.from("…")` tidak.
        expect(source).not.toMatch(new RegExp(`from\\(\\s*["'\`]${name}["'\`]`));
      }
    }
  });

  it("setiap route.ts memakai force-dynamic (ADR-005 §6)", () => {
    const routes = routeFiles.filter((file) => file.endsWith(`${path.sep}route.ts`));
    expect(routes.length).toBe(5);
    for (const file of routes) {
      expect(readFileSync(file, "utf8")).toContain(
        'export const dynamic = "force-dynamic"',
      );
    }
  });
});

describe("route.ts — kabel ke Next", () => {
  const routes = [
    { name: "employees", module: employeesRoute },
    { name: "employees/[personnel_number]", module: employeeDetailRoute },
    { name: "org-units", module: orgUnitsRoute },
    { name: "jabatan", module: jabatanRoute },
    { name: "lookups", module: lookupsRoute },
  ];

  it("kelimanya force-dynamic", () => {
    for (const route of routes) {
      expect(route.module.dynamic).toBe("force-dynamic");
    }
  });

  it("405 untuk POST, PUT, PATCH, DELETE, dan OPTIONS", async () => {
    for (const route of routes) {
      for (const handler of [
        route.module.POST,
        route.module.PUT,
        route.module.PATCH,
        route.module.DELETE,
        route.module.OPTIONS,
      ]) {
        const response = handler();
        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET");
        expect(await json(response)).toEqual({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Method tidak didukung; /api/v1 hanya menerima GET.",
            details: { allow: ["GET"] },
          },
        });
      }
    }
  });

  it("GET tanpa key menjawab 401 tanpa menyentuh Supabase", async () => {
    const withoutKey = request("/api/v1/employees", null);
    expect((await employeesRoute.GET(withoutKey)).status).toBe(401);
    expect((await orgUnitsRoute.GET(withoutKey)).status).toBe(401);
    expect((await jabatanRoute.GET(withoutKey)).status).toBe(401);
    expect((await lookupsRoute.GET(withoutKey)).status).toBe(401);
    expect(
      (
        await employeeDetailRoute.GET(withoutKey, {
          params: Promise.resolve({ personnel_number: "TEST-0001" }),
        })
      ).status,
    ).toBe(401);
  });
});
