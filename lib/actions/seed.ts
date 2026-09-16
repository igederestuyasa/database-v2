"use server";

/**
 * Seed awal lewat web (PRD #23, ADR-008) — thin wrapper over one RPC.
 *
 * The admin's browser has already read the Excel and turned it into a
 * `SeedPayload` (`lib/seed/payload.ts`). This action does exactly four things,
 * like `lib/actions/merge.ts`: validate, guard, call `seed_from_payload()`,
 * revalidate. Everything that writes — Lookup, Jabatan, Unit Organisasi,
 * Karyawan, Data Pribadi Sensitif — happens inside that one Postgres function,
 * in one transaction, as one Batch of jenis `seed` (ADR-006). Nothing here
 * opens a Batch, and nothing here may (`tests/batchDiscipline.test.ts`).
 *
 * The payload is re-validated here even though the page validated it: the
 * page runs in a browser, and a browser is not a trusted party. What the
 * schema cannot know — uniqueness against rows that already exist, CHECK
 * constraints, RLS — the function and the database decide, and their refusals
 * come back through `mapDbError` as Indonesian sentences.
 *
 * `p_force` is never sent from here. It exists for the SQL tests and for a
 * technical operator on a direct connection; the page's whole promise is
 * "sekali jalan", and `countEmployees()` on the page says so before this is
 * ever called.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DbError } from "@/lib/db/shared";
import { seedPayloadSchema, type SeedPayload } from "@/lib/seed/payload";
import type { Json } from "@/lib/types/db";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "./_guard";
import { mapDbError, type DbErrorContext } from "./pgErrors";

export type SeedInput = {
  payload: SeedPayload;
  /** The file name, for the default `batches.keterangan`. */
  sumber: string;
  /** Optional override of `batches.keterangan`. */
  keterangan?: string;
};

/** What `seed_from_payload()` reports — the CLI's `SeedCounts`, plus the Batch. */
export type SeedResult = {
  batchId: string;
  lookups: number;
  jabatan: number;
  orgUnits: number;
  employees: number;
  dataPribadi: number;
  revisions: number;
};

const seedInputSchema = z.object({
  payload: seedPayloadSchema,
  sumber: z
    .string({ error: "Nama file harus berupa teks." })
    .trim()
    .min(1, { error: "Nama file kosong." })
    .max(255, { error: "Nama file terlalu panjang." }),
  keterangan: z
    .string()
    .trim()
    .max(500, { error: "Keterangan maksimal 500 karakter." })
    .optional(),
});

/** Every path whose data the Seed just created out of nothing. */
const SEED_REVALIDATE = [
  "/karyawan",
  "/karyawan/seed",
  "/struktur",
  "/jabatan",
  "/master-data",
  "/bereskan",
  "/log",
] as const;

/**
 * Terjemahan penolakan database untuk Seed (lihat `mapDbError`).
 *
 * `sendiri`: every SQLSTATE `seed_from_payload()` raises on purpose —
 * `assert_admin()` (42501), a payload that fails its own shape checks (22023),
 * "tabel Karyawan sudah berisi" and the one-Batch self-check (55000), and the
 * CHECK constraints and `employees_validate_lookups` trigger (23514). The
 * Indonesian sentence the SQL wrote is shown as is.
 *
 * `23505` is the realistic failure on a second attempt after a reverted Seed:
 * reverting marks rows nonaktif, it never deletes them, so their kode and
 * Personnel Number are still taken. The sentence says that, and that nothing
 * was written — the whole function rolled back.
 */
const SEED_DB: DbErrorContext = {
  entitas: "Seed",
  aksi: "menjalankan Seed",
  sendiri: {
    "42501": "BUKAN_ADMIN",
    "22023": "VALIDASI",
    "55000": "KONFLIK",
    "23514": "KONFLIK",
  },
  unikDefault: {
    message:
      "Ada Personnel Number, NIP, atau kode Data Referensi di file ini yang sudah dipakai data yang ada di database — termasuk data dari Seed yang pernah dikembalikan, karena mengembalikan tidak menghapus. Seed dibatalkan seluruhnya; tidak ada yang tertulis.",
  },
  rujukan: {
    message:
      "Ada rujukan yang tidak ditemukan di database. Seed dibatalkan seluruhnya; tidak ada yang tertulis.",
  },
  fallback: "Gagal menjalankan Seed. Tidak ada yang tertulis. Coba lagi.",
};

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Decode the jsonb the RPC returns, defensively. */
function readSeedResult(data: unknown): SeedResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ActionError("GAGAL", "Seed tidak mengembalikan hasil yang bisa dibaca.");
  }
  const row = data as Record<string, unknown>;
  if (typeof row.batch_id !== "string") {
    throw new ActionError("GAGAL", "Seed tidak mengembalikan hasil yang bisa dibaca.");
  }
  return {
    batchId: row.batch_id,
    lookups: asCount(row.lookups),
    jabatan: asCount(row.jabatan),
    orgUnits: asCount(row.org_units),
    employees: asCount(row.employees),
    dataPribadi: asCount(row.data_pribadi),
    revisions: asCount(row.revisions),
  };
}

/** Jalankan Seed awal: satu RPC, satu transaksi, satu Batch `seed`. */
export async function jalankanSeed(
  input: SeedInput,
): Promise<ActionResult<SeedResult>> {
  const parsed = seedInputSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { payload, sumber, keterangan } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const { data, error } = await client.rpc("seed_from_payload", {
      p_payload: payload as unknown as Json,
      p_keterangan: keterangan && keterangan.length > 0 ? keterangan : `Seed awal dari ${sumber}`,
    });
    if (error) throw new DbError("Gagal menjalankan Seed", error);

    const result = readSeedResult(data);

    for (const path of SEED_REVALIDATE) revalidatePath(path);

    return actionOk(result);
  } catch (error) {
    return toActionFailure(mapDbError(error, SEED_DB));
  }
}
