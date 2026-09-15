"use server";

/**
 * Merge dua Data Referensi (PRD #10) — thin wrappers over the merge RPCs.
 *
 * FROZEN SIGNATURES (Wave 1). Three units call merge (Struktur Organisasi,
 * Jabatan, Master Data) and a fourth offers it from "Perlu Dibereskan"
 * (PRD #12). `MergeInput`, `MergeResult` and `ActionResult<MergeResult>` are
 * byte-identical to the Wave 1 stub; only the bodies changed.
 *
 * WHERE THE WORK ACTUALLY HAPPENS
 * ---------------------------------------------------------------------------
 * A merge is three UPDATEs across two tables, and over PostgREST three
 * statements are three requests, three transactions and therefore three Batch
 * entries — which would make "kembalikan Merge ini" undo a third of it. So the
 * whole merge lives in one Postgres function per entity
 * (`supabase/migrations/0002_batch_operations.sql`, ADR-006): one RPC call is
 * one transaction, one `app.batch_id`, one Batch of jenis `merge`.
 *
 * These wrappers therefore do exactly four things: validate, guard, call, and
 * revalidate. Every rule below is enforced **inside the function**, in SQL,
 * where nothing can route around it:
 *
 *   * source ≠ target, and neither may already be merged;
 *   * Lookup: source and target must share the same `tipe` — the `employees`
 *     column to move is chosen by tipe, so a cross-tipe merge would point
 *     every Karyawan it moved at the wrong kind of Lookup;
 *   * Unit Organisasi: the target must not sit below the source, or
 *     re-parenting the source's children would build a cycle;
 *   * the source is deactivated and records `merged_into_id`, never deleted —
 *     a Konsumen holding its id still resolves, and the whole thing can be
 *     reverted (ADR-003).
 *
 * `requireAdmin()` here and `assert_admin()` + RLS in the database: all of
 * them, not one of them (CLAUDE.md).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DbError } from "@/lib/db/shared";
import { uuidField } from "@/lib/validation/common";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "./_guard";
import { mapDbError, type DbErrorContext } from "./pgErrors";

/** Both ids are required and must differ. `keterangan` overrides the default. */
export type MergeInput = {
  /** The entity that will become nonaktif. */
  sourceId: string;
  /** The entity everything moves to. */
  targetId: string;
  /** Optional `batches.keterangan`; a readable default is generated if absent. */
  keterangan?: string;
};

export type MergeResult = {
  /** The `merge` Batch, so the UI can link straight to the Log Perubahan. */
  batchId: string;
  sourceId: string;
  targetId: string;
  /** How many Karyawan were moved from source to target. */
  movedEmployees: number;
  /** How many child Unit Organisasi were re-parented (0 for Jabatan/Lookup). */
  movedChildren: number;
};

/** The three merge RPCs. Same arguments, same return shape, one per entity. */
type MergeRpc = "merge_org_unit" | "merge_jabatan" | "merge_lookup";

const mergeSchema = z
  .object({
    sourceId: uuidField("Data Referensi asal"),
    targetId: uuidField("Data Referensi tujuan"),
    keterangan: z
      .string()
      .trim()
      .max(500, { error: "Keterangan maksimal 500 karakter." })
      .optional(),
  })
  .refine((value) => value.sourceId !== value.targetId, {
    error: "Asal dan tujuan Merge tidak boleh sama.",
    path: ["targetId"],
  });

/**
 * Terjemahan penolakan database untuk Merge (lihat `mapDbError`).
 *
 * `sendiri`: the migration raises with a deliberate errcode per refusal so the
 * UI can tell "kamu bukan admin" from "sudah pernah di-merge" without parsing
 * Indonesian prose. Every SQLSTATE listed there is one HC Core's own SQL
 * raises — `assert_admin()`, the merge guards, `org_units_prevent_cycle`,
 * `assert_lookup_tipe` — so the message really is the Indonesian sentence that
 * code wrote. `mapDbError` still checks it does not read like Postgres prose
 * before showing it: Postgres raises `42501` and `23514` in English too.
 *
 * `23505` / `23503`: a merge only ever writes `status`, `merged_into_id`,
 * `parent_id` and FK uuids it has just locked, so neither should be reachable
 * — which is why the raw text is never shown: it would mean something
 * unexpected happened.
 */
const MERGE_DB: DbErrorContext = {
  entitas: "Data Referensi",
  aksi: "menggabungkan Data Referensi",
  sendiri: {
    // insufficient_privilege — assert_admin(), or RLS refusing the write
    "42501": "BUKAN_ADMIN",
    // no_data_found — source/target row missing
    P0002: "TIDAK_DITEMUKAN",
    // invalid_parameter_value — same id twice, cross-tipe Lookup, missing id
    "22023": "VALIDASI",
    // object_not_in_prerequisite_state — already merged
    "55000": "KONFLIK",
    // check_violation — target sits below source (cycle), wrong Lookup tipe
    "23514": "KONFLIK",
  },
  unikDefault: {
    message: "Nilai ini sudah dipakai data lain, jadi Merge tidak bisa dilanjutkan.",
  },
  rujukan: {
    message: "Data yang dirujuk tidak ada lagi, jadi Merge tidak bisa dilanjutkan.",
  },
  fallback: "Gagal menggabungkan data. Coba lagi.",
};

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Decode the jsonb the merge RPCs return, defensively. */
function readMergeResult(data: unknown): MergeResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ActionError("GAGAL", "Merge tidak mengembalikan hasil yang bisa dibaca.");
  }
  const row = data as Record<string, unknown>;
  const batchId = row.batch_id;
  const sourceId = row.source_id;
  const targetId = row.target_id;
  if (
    typeof batchId !== "string" ||
    typeof sourceId !== "string" ||
    typeof targetId !== "string"
  ) {
    throw new ActionError("GAGAL", "Merge tidak mengembalikan hasil yang bisa dibaca.");
  }
  return {
    batchId,
    sourceId,
    targetId,
    movedEmployees: asCount(row.moved_employees),
    movedChildren: asCount(row.moved_children),
  };
}

async function runMerge(
  rpc: MergeRpc,
  input: MergeInput,
  revalidate: readonly string[],
): Promise<ActionResult<MergeResult>> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { sourceId, targetId, keterangan } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const { data, error } = await client.rpc(rpc, {
      p_source: sourceId,
      p_target: targetId,
      p_keterangan: keterangan,
    });
    if (error) throw new DbError("Gagal menggabungkan data", error);

    const result = readMergeResult(data);

    for (const path of revalidate) revalidatePath(path);

    return actionOk(result);
  } catch (error) {
    return toActionFailure(mapDbError(error, MERGE_DB));
  }
}

/** Merge dua Unit Organisasi. Children are re-parented onto the target. */
export async function mergeOrgUnit(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  return runMerge("merge_org_unit", input, [
    "/struktur",
    "/karyawan",
    "/bereskan",
    "/log",
  ]);
}

/** Merge dua Jabatan. Every holder moves to the target. */
export async function mergeJabatan(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  return runMerge("merge_jabatan", input, [
    "/jabatan",
    "/karyawan",
    "/bereskan",
    "/log",
  ]);
}

/** Merge dua Lookup of the same `tipe`. Refuses a cross-tipe merge. */
export async function mergeLookup(
  input: MergeInput,
): Promise<ActionResult<MergeResult>> {
  return runMerge("merge_lookup", input, [
    "/master-data",
    "/karyawan",
    "/bereskan",
    "/log",
  ]);
}
