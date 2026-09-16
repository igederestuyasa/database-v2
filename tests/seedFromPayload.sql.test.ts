/**
 * End-to-end proof of the web Seed's write half (PRD #23, ADR-008), against a
 * real local database: the dummy workbook → `planSeed()` → `buildSeedPayload()`
 * → `seed_from_payload()` → one Batch `seed` with every row and every Revisi
 * where the plan said it would be.
 *
 * Same trade-off as `lib/derived/sql.test.ts`: without a reachable database
 * (`npm run db:local`) the file skips rather than fails, so `npm test` stays
 * runnable on a machine without Postgres. CI's `skema` job runs it for real.
 *
 * Everything happens inside a transaction that is rolled back — the function
 * is called with `p_force => true` because the harness database already holds
 * the fixture Karyawan `verify-schema.sql` created, and nothing is left behind.
 */
import { userInfo } from "node:os";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { errorsOf, planSeed } from "../lib/seed/excelMapping";
import { buildSeedPayload, seedPayloadSchema } from "../lib/seed/payload";
import { buildDummyRows } from "../scripts/make-dummy-xlsx";

type SeedRow = {
  batch_id: string;
  lookups: number;
  jabatan: number;
  org_units: number;
  employees: number;
  data_pribadi: number;
  revisions: number;
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
    // Prove the function exists, not merely that a server answered.
    await client.query("select 'public.seed_from_payload(jsonb, text, boolean)'::regprocedure");
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

describe.skipIf(client === null)("seed_from_payload() terhadap Postgres lokal", () => {
  it("workbook dummy → plan → payload → satu Batch seed berisi semuanya", async () => {
    const db = client as Client;
    const plan = planSeed(buildDummyRows({ rows: 300 }));
    expect(errorsOf(plan)).toEqual([]);
    const payload = buildSeedPayload(plan);
    expect(seedPayloadSchema.safeParse(payload).success).toBe(true);

    await db.query("begin");
    try {
      const {
        rows: [{ res }],
      } = await db.query<{ res: SeedRow }>(
        "select public.seed_from_payload($1::jsonb, $2, true) as res",
        [JSON.stringify(payload), "Uji seed dari workbook dummy"],
      );

      expect(res.org_units).toBe(plan.orgUnits.length);
      expect(res.jabatan).toBe(plan.jabatan.length);
      expect(res.lookups).toBe(plan.lookups.length);
      expect(res.employees).toBe(plan.employees.length);
      expect(res.data_pribadi).toBe(plan.stats.karyawanDenganDataPribadi);

      // Every insert is one Revisi; every employees insert also creates an
      // employee_private row (zz_autocreate_private) = one more; every filled
      // Data Pribadi is one update.
      const expectedRevisions =
        plan.orgUnits.length +
        plan.jabatan.length +
        plan.lookups.length +
        plan.employees.length * 2 +
        plan.stats.karyawanDenganDataPribadi;
      expect(res.revisions).toBe(expectedRevisions);

      const {
        rows: [batch],
      } = await db.query<{ jenis: string; keterangan: string }>(
        "select jenis, keterangan from public.batches where id = $1",
        [res.batch_id],
      );
      expect(batch).toEqual({ jenis: "seed", keterangan: "Uji seed dari workbook dummy" });

      const {
        rows: [tally],
      } = await db.query<{ n: number; b: number }>(
        "select count(*)::int as n, count(distinct batch_id)::int as b from public.revisions where batch_id = $1",
        [res.batch_id],
      );
      expect(tally).toEqual({ n: expectedRevisions, b: 1 });

      // Spot-check the index → id mapping on a Karyawan that has everything.
      const sample = plan.employees.find(
        (e) => e.orgUnitKey !== null && e.jabatanKey !== null && e.private.date_of_birth !== null,
      );
      if (!sample) throw new Error("workbook dummy tidak punya Karyawan lengkap");
      const orgKode = plan.orgUnits.find((u) => u.key === sample.orgUnitKey)?.kode ?? null;
      const jabKode = plan.jabatan.find((j) => j.key === sample.jabatanKey)?.kode ?? null;
      const genderKey = sample.lookupKeys.gender;
      const genderKode = genderKey
        ? (plan.lookups.find((l) => l.key === genderKey)?.kode ?? null)
        : null;

      const {
        rows: [row],
      } = await db.query<{
        org_kode: string | null;
        jab_kode: string | null;
        gender_kode: string | null;
        dob: string | null;
        status: string;
      }>(
        `select o.kode as org_kode, j.kode as jab_kode, g.kode as gender_kode,
                ep.date_of_birth::text as dob, e.status
           from public.employees e
           left join public.org_units o on o.id = e.org_unit_id
           left join public.jabatan j on j.id = e.jabatan_id
           left join public.lookups g on g.id = e.gender_id
           left join public.employee_private ep on ep.employee_id = e.id
          where e.personnel_number = $1`,
        [sample.personnel_number],
      );
      expect(row).toEqual({
        org_kode: orgKode,
        jab_kode: jabKode,
        gender_kode: genderKode,
        dob: sample.private.date_of_birth,
        status: sample.status,
      });
    } finally {
      await db.query("rollback");
    }
  });

  it("menolak seed kedua tanpa p_force (55000) dan tidak meninggalkan Batch", async () => {
    const db = client as Client;
    const payload = buildSeedPayload(planSeed(buildDummyRows({ rows: 20 })));

    await db.query("begin");
    try {
      const {
        rows: [{ n: before }],
      } = await db.query<{ n: number }>("select count(*)::int as n from public.batches");

      let code: string | undefined;
      await db.query("savepoint kedua");
      try {
        await db.query("select public.seed_from_payload($1::jsonb, null, false)", [
          JSON.stringify(payload),
        ]);
      } catch (error) {
        code = (error as { code?: string }).code;
        await db.query("rollback to savepoint kedua");
      }
      expect(code).toBe("55000");

      const {
        rows: [{ n: after }],
      } = await db.query<{ n: number }>("select count(*)::int as n from public.batches");
      expect(after).toBe(before);
    } finally {
      await db.query("rollback");
    }
  });
});
