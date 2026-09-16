/**
 * End-to-end proof of Impor Karyawan berulang (PRD #24) against a real local
 * database: workbook dummy → `planSeed()` → `buildSeedPayload()` →
 * `import_from_payload()`.
 *
 * Kenapa ini harus diuji terhadap database sungguhan, bukan di-mock: yang
 * dijanjikan fungsi itu semuanya hal yang hanya Postgres yang tahu —
 * `on conflict` memilih baris yang benar, `coalesce` menahan sel kosong,
 * klausa `where` menahan baris yang tidak berubah, dan trigger `log_revision`
 * menulis Revisi yang pas. Salah satu saja meleset dan akibatnya mengenai
 * ±1.475 orang sekaligus tanpa melempar apa pun.
 *
 * Trade-off yang sama dengan `tests/seedFromPayload.sql.test.ts`: tanpa
 * database yang bisa dihubungi (`npm run db:local`) berkas ini melewati diri
 * sendiri, bukan gagal. Job `skema` di CI menjalankannya sungguhan.
 *
 * Semua di dalam transaksi yang di-rollback. Tidak ada `p_force` di sini —
 * Impor memang dirancang untuk database yang sudah berisi.
 */
import { userInfo } from "node:os";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { errorsOf, planSeed } from "../lib/seed/excelMapping";
import { buildSeedPayload, type SeedPayload } from "../lib/seed/payload";
import { buildDummyRows } from "../scripts/make-dummy-xlsx";

type ImportRow = {
  batch_id: string;
  karyawan_baru: number;
  karyawan_diperbarui: number;
  karyawan_tetap: number;
  lookups_baru: number;
  jabatan_baru: number;
  org_units_baru: number;
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
    await client.query("select 'public.import_from_payload(jsonb, text)'::regprocedure");
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

/** Payload dari workbook dummy, dengan Personnel Number yang belum dipakai. */
function payloadDummy(rows: number): SeedPayload {
  const plan = planSeed(buildDummyRows({ rows }));
  expect(errorsOf(plan)).toEqual([]);
  return buildSeedPayload(plan);
}

async function impor(
  db: Client,
  payload: SeedPayload,
  keterangan: string | null = null,
): Promise<ImportRow> {
  const {
    rows: [{ res }],
  } = await db.query<{ res: ImportRow }>(
    "select public.import_from_payload($1::jsonb, $2) as res",
    [JSON.stringify(payload), keterangan],
  );
  return res;
}

/** Jalankan sesuatu yang harusnya ditolak, kembalikan SQLSTATE-nya. */
async function kodeGagal(db: Client, jalankan: () => Promise<unknown>): Promise<string | undefined> {
  await db.query("savepoint coba");
  try {
    await jalankan();
    await db.query("release savepoint coba");
    return undefined;
  } catch (error) {
    await db.query("rollback to savepoint coba");
    return (error as { code?: string }).code;
  }
}

describe.skipIf(client === null)("import_from_payload() terhadap Postgres lokal", () => {
  it("impor pertama menambah semuanya sebagai satu Batch jenis impor", async () => {
    const db = client as Client;
    const payload = payloadDummy(120);

    await db.query("begin");
    try {
      const res = await impor(db, payload, "Uji impor pertama");

      expect(res.karyawan_baru).toBe(payload.employees.length);
      expect(res.karyawan_diperbarui).toBe(0);
      expect(res.karyawan_tetap).toBe(0);
      expect(res.org_units_baru).toBe(payload.org_units.length);
      expect(res.jabatan_baru).toBe(payload.jabatan.length);
      expect(res.lookups_baru).toBe(payload.lookups.length);

      const {
        rows: [batch],
      } = await db.query<{ jenis: string; keterangan: string }>(
        "select jenis, keterangan from public.batches where id = $1",
        [res.batch_id],
      );
      expect(batch).toEqual({ jenis: "impor", keterangan: "Uji impor pertama" });

      // Semua Revisi yang lahir ada di Batch ini, dan tidak ada di Batch lain.
      const {
        rows: [tally],
      } = await db.query<{ n: number; b: number }>(
        "select count(*)::int as n, count(distinct batch_id)::int as b from public.revisions where batch_id = $1",
        [res.batch_id],
      );
      expect(tally).toEqual({ n: res.revisions, b: 1 });
    } finally {
      await db.query("rollback");
    }
  });

  it("impor kedua dengan file yang sama ditolak (55000) dan tidak meninggalkan Batch", async () => {
    const db = client as Client;
    const payload = payloadDummy(40);

    await db.query("begin");
    try {
      await impor(db, payload);

      const {
        rows: [{ n: sebelum }],
      } = await db.query<{ n: number }>("select count(*)::int as n from public.batches");

      const kode = await kodeGagal(db, () => impor(db, payload));
      expect(kode).toBe("55000");

      const {
        rows: [{ n: sesudah }],
      } = await db.query<{ n: number }>("select count(*)::int as n from public.batches");
      expect(sesudah).toBe(sebelum);
    } finally {
      await db.query("rollback");
    }
  });

  it("hanya baris yang berubah yang tersentuh — updated_at yang lain diam", async () => {
    const db = client as Client;
    const payload = payloadDummy(40);

    await db.query("begin");
    try {
      await impor(db, payload);

      const berubah = payload.employees[0].personnel_number;
      const diam = payload.employees[1].personnel_number;
      const {
        rows: [sebelum],
      } = await db.query<{ updated_at: string }>(
        "select updated_at::text from public.employees where personnel_number = $1",
        [diam],
      );

      const kedua: SeedPayload = {
        ...payload,
        employees: payload.employees.map((e, i) =>
          i === 0 ? { ...e, full_name: `${e.full_name} (ralat)` } : e,
        ),
      };
      const res = await impor(db, kedua);

      expect(res.karyawan_baru).toBe(0);
      expect(res.karyawan_diperbarui).toBe(1);
      expect(res.karyawan_tetap).toBe(payload.employees.length - 1);

      const {
        rows: [nama],
      } = await db.query<{ full_name: string }>(
        "select full_name from public.employees where personnel_number = $1",
        [berubah],
      );
      expect(nama.full_name).toBe(`${payload.employees[0].full_name} (ralat)`);

      // Inti janjinya: yang tidak berubah benar-benar tidak disentuh. Kalau
      // updated_at ikut bergerak, seluruh perusahaan tampak "diubah hari ini".
      const {
        rows: [sesudah],
      } = await db.query<{ updated_at: string }>(
        "select updated_at::text from public.employees where personnel_number = $1",
        [diam],
      );
      expect(sesudah.updated_at).toBe(sebelum.updated_at);

      // Satu perubahan = satu Revisi, bukan 40.
      const {
        rows: [{ n }],
      } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.revisions where batch_id = $1",
        [res.batch_id],
      );
      expect(n).toBe(1);
    } finally {
      await db.query("rollback");
    }
  });

  it("sel Excel yang kosong tidak mengosongkan data yang sudah ada", async () => {
    const db = client as Client;
    const payload = payloadDummy(30);

    await db.query("begin");
    try {
      await impor(db, payload);

      // Cari satu Karyawan yang memang punya isi untuk dikosongkan.
      const asli = payload.employees.find(
        (e) => e.jab !== null && e.dates.original_start_date !== undefined,
      );
      if (!asli) throw new Error("workbook dummy tidak punya Karyawan yang cukup lengkap");

      const kedua: SeedPayload = {
        ...payload,
        employees: payload.employees.map((e) =>
          e.personnel_number === asli.personnel_number
            ? // Persis seperti file yang kolomnya dikosongkan: jabatan hilang,
              // tanggal hilang, nama diubah supaya barisnya tetap tersentuh.
              { ...e, jab: null, dates: {}, full_name: `${e.full_name} X` }
            : e,
        ),
      };
      await impor(db, kedua);

      const {
        rows: [baris],
      } = await db.query<{
        full_name: string;
        jabatan_id: string | null;
        original_start_date: string | null;
      }>(
        `select full_name, jabatan_id, original_start_date::text
           from public.employees where personnel_number = $1`,
        [asli.personnel_number],
      );
      expect(baris.full_name).toBe(`${asli.full_name} X`);
      expect(baris.jabatan_id).not.toBeNull();
      expect(baris.original_start_date).toBe(asli.dates.original_start_date);
    } finally {
      await db.query("rollback");
    }
  });

  it("Karyawan baru masuk, Data Referensi yang sudah ada dipakai ulang", async () => {
    const db = client as Client;
    const payload = payloadDummy(30);

    await db.query("begin");
    try {
      await impor(db, payload);

      const tambahan = {
        ...payload.employees[0],
        personnel_number: "90999999",
        nip: null,
        full_name: "Orang Baru Sekali",
      };
      const kedua: SeedPayload = {
        ...payload,
        employees: [...payload.employees, tambahan],
      };
      const res = await impor(db, kedua);

      expect(res.karyawan_baru).toBe(1);
      expect(res.karyawan_diperbarui).toBe(0);
      // Data Referensi-nya kode yang sama persis — tidak boleh ada yang dibuat
      // ulang, karena itulah yang akan menumpuk varian tiap kali impor jalan.
      expect(res.org_units_baru).toBe(0);
      expect(res.jabatan_baru).toBe(0);
      expect(res.lookups_baru).toBe(0);

      const {
        rows: [{ n }],
      } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.employees where personnel_number = $1",
        ["90999999"],
      );
      expect(n).toBe(1);
    } finally {
      await db.query("rollback");
    }
  });

  it("Personnel Number kembar di dalam satu file ditolak (22023)", async () => {
    const db = client as Client;
    const payload = payloadDummy(10);
    const kembar: SeedPayload = {
      ...payload,
      employees: [...payload.employees, { ...payload.employees[0], nip: null }],
    };

    await db.query("begin");
    try {
      const kode = await kodeGagal(db, () => impor(db, kembar));
      expect(kode).toBe("22023");
    } finally {
      await db.query("rollback");
    }
  });

  it("viewer ditolak (42501) — assert_admin, bukan RLS saja", async () => {
    const db = client as Client;
    const payload = payloadDummy(5);

    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query(
        `select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true)`,
      );
      const kode = await kodeGagal(db, () => impor(db, payload));
      expect(kode).toBe("42501");
    } finally {
      await db.query("rollback");
    }
  });
});
