"use server";

/**
 * Impor Karyawan dari Excel (PRD #24, ADR-009) — thin wrapper over one RPC.
 *
 * The admin's browser has already read the Excel and turned it into a
 * `SeedPayload` (`lib/seed/payload.ts`). This action does exactly four things,
 * like `lib/actions/merge.ts`: validate, guard, call `import_from_payload()`,
 * revalidate. Everything that writes — Lookup, Jabatan, Unit Organisasi,
 * Karyawan, Data Pribadi Sensitif — happens inside that one Postgres function,
 * in one transaction, as one Batch of jenis `impor` (ADR-006). Nothing here
 * opens a Batch, and nothing here may (`tests/batchDiscipline.test.ts`).
 *
 * BOLEH DIJALANKAN BERULANG, dan itu seluruh bedanya dengan Seed. Kuncinya
 * `personnel_number`: nomor yang sudah ada diperbarui pada kolom yang berubah,
 * yang belum ada ditambah, dan sel Excel yang kosong tidak pernah mengosongkan
 * isi yang sudah ada. Semua keputusan itu diambil di SQL, bukan di sini —
 * lihat `import_from_payload()` di `0002_batch_operations.sql`.
 *
 * The payload is re-validated here even though the page validated it: the
 * page runs in a browser, and a browser is not a trusted party. What the
 * schema cannot know — uniqueness against rows that already exist, CHECK
 * constraints, RLS — the function and the database decide, and their refusals
 * come back through `mapDbError` as Indonesian sentences.
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

export type ImporInput = {
  payload: SeedPayload;
  /** The file name, for the default `batches.keterangan`. */
  sumber: string;
  /** Optional override of `batches.keterangan`. */
  keterangan?: string;
};

/** What `import_from_payload()` reports, plus the Batch it wrote everything to. */
export type ImporResult = {
  batchId: string;
  /** Personnel Number yang belum ada di database. */
  karyawanBaru: number;
  /** Sudah ada, dan setidaknya satu kolomnya berubah. */
  karyawanDiperbarui: number;
  /** Sudah ada dengan isi yang sama persis — tidak disentuh sama sekali. */
  karyawanTetap: number;
  lookupsBaru: number;
  jabatanBaru: number;
  orgUnitsBaru: number;
  dataPribadi: number;
  revisions: number;
};

const imporInputSchema = z.object({
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

/** Every path whose data an Impor may have changed. */
const IMPOR_REVALIDATE = [
  "/karyawan",
  "/karyawan/impor",
  "/struktur",
  "/jabatan",
  "/master-data",
  "/bereskan",
  "/log",
] as const;

/**
 * Terjemahan penolakan database untuk Impor (lihat `mapDbError`).
 *
 * `sendiri`: every SQLSTATE `import_from_payload()` raises on purpose —
 * `assert_admin()` (42501), a payload that fails its own shape checks or has a
 * Personnel Number twice (22023), "file ini tidak mengubah apa pun" and the
 * one-Batch self-check (55000), and the CHECK constraints and
 * `employees_validate_lookups` trigger (23514). The Indonesian sentence the SQL
 * wrote is shown as is — including the friendly "tidak ada yang berubah", which
 * is a refusal only because a Batch without Revisi may not be left behind.
 *
 * `23505` on an Impor is almost always NIP, not Personnel Number: Personnel
 * Number is the key and simply updates, but a NIP that belongs to somebody else
 * collides. The whole transaction rolls back, so nothing partial lands.
 */
const IMPOR_DB: DbErrorContext = {
  entitas: "Impor",
  aksi: "menjalankan Impor",
  sendiri: {
    "42501": "BUKAN_ADMIN",
    "22023": "VALIDASI",
    "55000": "KONFLIK",
    "23514": "KONFLIK",
  },
  unikDefault: {
    message:
      "Ada NIP atau kode Data Referensi di file ini yang sudah dipakai orang lain di database. Personnel Number sendiri tidak pernah bentrok — itu kuncinya, dan barisnya diperbarui. Impor dibatalkan seluruhnya; tidak ada yang tertulis.",
  },
  rujukan: {
    message:
      "Ada rujukan yang tidak ditemukan di database. Impor dibatalkan seluruhnya; tidak ada yang tertulis.",
  },
  fallback: "Gagal menjalankan Impor. Tidak ada yang tertulis. Coba lagi.",
};

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Decode the jsonb the RPC returns, defensively. */
function readImporResult(data: unknown): ImporResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ActionError("GAGAL", "Impor tidak mengembalikan hasil yang bisa dibaca.");
  }
  const row = data as Record<string, unknown>;
  if (typeof row.batch_id !== "string") {
    throw new ActionError("GAGAL", "Impor tidak mengembalikan hasil yang bisa dibaca.");
  }
  return {
    batchId: row.batch_id,
    karyawanBaru: asCount(row.karyawan_baru),
    karyawanDiperbarui: asCount(row.karyawan_diperbarui),
    karyawanTetap: asCount(row.karyawan_tetap),
    lookupsBaru: asCount(row.lookups_baru),
    jabatanBaru: asCount(row.jabatan_baru),
    orgUnitsBaru: asCount(row.org_units_baru),
    dataPribadi: asCount(row.data_pribadi),
    revisions: asCount(row.revisions),
  };
}

/** Jalankan Impor: satu RPC, satu transaksi, satu Batch `impor`. */
export async function jalankanImpor(
  input: ImporInput,
): Promise<ActionResult<ImporResult>> {
  const parsed = imporInputSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { payload, sumber, keterangan } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const { data, error } = await client.rpc("import_from_payload", {
      p_payload: payload as unknown as Json,
      p_keterangan: keterangan && keterangan.length > 0 ? keterangan : `Impor dari ${sumber}`,
    });
    if (error) throw new DbError("Gagal menjalankan Impor", error);

    const result = readImporResult(data);

    for (const path of IMPOR_REVALIDATE) revalidatePath(path);

    return actionOk(result);
  } catch (error) {
    return toActionFailure(mapDbError(error, IMPOR_DB));
  }
}
