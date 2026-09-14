/**
 * Cross-check: `lib/derived` against the SQL that `v_employees` actually runs.
 *
 * Hand-computed expectations (`employee.test.ts`) prove the TypeScript agrees
 * with what we *think* Postgres does. This proves it agrees with what Postgres
 * *does*: the same dummy Karyawan are inserted into a real local database, read
 * back through `v_employees`, and compared column by column against
 * `deriveEmployeeColumns()` for the same `current_date`.
 *
 * It needs the local harness (`npm run db:local`). Without a reachable
 * database the whole file is skipped rather than failing, because `npm test`
 * has to stay runnable on a machine that has no Postgres — that is the same
 * trade-off `scripts/db-local.sh` exists to make cheap. The PR that adds this
 * says plainly whether it ran.
 *
 * Everything happens inside a transaction that is rolled back, so the harness
 * database is left exactly as `verify-schema.sql` left it.
 */
import { userInfo } from "node:os";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { EMPLOYEES, EMPLOYEE_PRIVATE } from "@/fixtures/employees";

import { deriveEmployeeColumns } from "./employee";

type DerivedRow = {
  id: string;
  personnel_number: string;
  masa_kerja_tahun: number | null;
  masa_kerja_bulan: number | null;
  masa_sejak_diangkat_tahun: number | null;
  masa_sejak_diangkat_bulan: number | null;
  masa_pg_tahun: number | null;
  masa_jg_tahun: number | null;
};

async function connect(): Promise<Client | null> {
  const conn = process.env.HC_LOCAL_DB_URL ?? process.env.DATABASE_URL;
  const client = conn
    ? new Client({ connectionString: conn })
    : new Client({
        host: process.env.PGHOST ?? "/var/run/postgresql",
        database: process.env.HC_LOCAL_DB ?? "hc_core_test",
        user: process.env.PGUSER ?? userInfo().username,
      });
  try {
    await client.connect();
    // Prove the migration is applied, not merely that a server answered.
    await client.query("select 1 from public.v_employees limit 1");
    return client;
  } catch {
    await client.end().catch(() => undefined);
    return null;
  }
}

const client = await connect();

afterAll(async () => {
  await client?.end().catch(() => undefined);
});

describe.skipIf(client === null)("kolom turunan: TypeScript vs v_employees", () => {
  it("menghasilkan angka yang sama persis untuk setiap Karyawan dummy", async () => {
    const db = client as Client;
    await db.query("begin");
    try {
      // `current_date` as the database sees it — the view hardcodes it, so the
      // TypeScript side has to be told the same day or the comparison is a
      // coin flip around midnight.
      const { rows: hariIni } = await db.query<{ hari_ini: string }>(
        "select to_char(current_date, 'YYYY-MM-DD') as hari_ini",
      );
      const asOf = hariIni[0].hari_ini;

      for (const employee of EMPLOYEES) {
        await db.query(
          `insert into public.employees
             (id, personnel_number, full_name, status,
              original_start_date, tanggal_diangkat,
              tanggal_promosi_pg, tanggal_promosi_jg, tanggal_keluar)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            employee.id,
            employee.personnel_number,
            employee.full_name,
            employee.status,
            employee.original_start_date,
            employee.tanggal_diangkat,
            employee.tanggal_promosi_pg,
            employee.tanggal_promosi_jg,
            employee.tanggal_keluar,
          ],
        );
      }

      for (const priv of EMPLOYEE_PRIVATE) {
        // The row already exists (zz_autocreate_private), so fill it in.
        await db.query(
          `update public.employee_private
              set date_of_birth = $2, place_of_birth = $3,
                  religion = $4, marital_status = $5
            where employee_id = $1`,
          [
            priv.employee_id,
            priv.date_of_birth,
            priv.place_of_birth,
            priv.religion,
            priv.marital_status,
          ],
        );
      }

      const ids = EMPLOYEES.map((employee) => employee.id);
      const { rows } = await db.query<DerivedRow>(
        `select id, personnel_number,
                masa_kerja_tahun, masa_kerja_bulan,
                masa_sejak_diangkat_tahun, masa_sejak_diangkat_bulan,
                masa_pg_tahun, masa_jg_tahun
           from public.v_employees
          where id = any($1::uuid[])
          order by personnel_number`,
        [ids],
      );

      expect(rows).toHaveLength(EMPLOYEES.length);

      for (const row of rows) {
        const employee = EMPLOYEES.find((candidate) => candidate.id === row.id);
        if (!employee) throw new Error("baris view tidak cocok dengan fixture");

        const derived = deriveEmployeeColumns(employee, asOf);

        expect({
          personnel_number: row.personnel_number,
          masa_kerja_tahun: derived.masa_kerja_tahun,
          masa_kerja_bulan: derived.masa_kerja_bulan,
          masa_sejak_diangkat_tahun: derived.masa_sejak_diangkat_tahun,
          masa_sejak_diangkat_bulan: derived.masa_sejak_diangkat_bulan,
          masa_pg_tahun: derived.masa_pg_tahun,
          masa_jg_tahun: derived.masa_jg_tahun,
        }).toEqual({
          personnel_number: row.personnel_number,
          masa_kerja_tahun: row.masa_kerja_tahun,
          masa_kerja_bulan: row.masa_kerja_bulan,
          masa_sejak_diangkat_tahun: row.masa_sejak_diangkat_tahun,
          masa_sejak_diangkat_bulan: row.masa_sejak_diangkat_bulan,
          masa_pg_tahun: row.masa_pg_tahun,
          masa_jg_tahun: row.masa_jg_tahun,
        });
      }
    } finally {
      await db.query("rollback");
    }
  });

  it("usia dari v_employees_private sama dengan computeUsia", async () => {
    const db = client as Client;
    await db.query("begin");
    try {
      const { rows: hariIni } = await db.query<{ hari_ini: string }>(
        "select to_char(current_date, 'YYYY-MM-DD') as hari_ini",
      );
      const asOf = hariIni[0].hari_ini;

      const [employee] = EMPLOYEES;
      const priv = EMPLOYEE_PRIVATE.find((row) => row.employee_id === employee.id);

      await db.query(
        `insert into public.employees (id, personnel_number, full_name)
         values ($1, $2, $3)`,
        [employee.id, employee.personnel_number, employee.full_name],
      );
      await db.query(
        `update public.employee_private set date_of_birth = $2 where employee_id = $1`,
        [employee.id, priv?.date_of_birth ?? null],
      );

      const { rows } = await db.query<{ usia: number | null }>(
        "select usia from public.v_employees_private where id = $1",
        [employee.id],
      );

      expect(rows).toHaveLength(1);
      expect(
        deriveEmployeeColumns({ date_of_birth: priv?.date_of_birth ?? null }, asOf).usia,
      ).toBe(rows[0].usia);
    } finally {
      await db.query("rollback");
    }
  });
});
