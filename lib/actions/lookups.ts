"use server";

/**
 * Server Actions untuk Lookup — halaman Master Data (PRD #9).
 *
 * Shape follows `lib/actions/_reference.ts` step for step: validate with the
 * shared zod schema, `requireAdmin()`, read the current row, write ONE
 * statement directly, revalidate, return an `ActionResult`. No Batch is opened
 * here — the `log_revision` trigger makes the Batch that holds the Revisi
 * (ADR-006).
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *  * **It never touches `employees`.** A Lookup is referenced by uuid
 *    (`employees.<tipe>_id`), so renaming "Pratama III - 13" is one UPDATE on
 *    one `lookups` row and every Karyawan holding that id reads the new label
 *    through `v_employees` immediately (PRD #9, ADR-002). An edit here that
 *    moved a single Karyawan row would be a bug.
 *  * **It never merges.** Moving every Karyawan from one Lookup to another is
 *    a multi-row, multi-table write, so it lives in the `merge_lookup` Postgres
 *    function and is called through `lib/actions/merge.ts:mergeLookup`
 *    (ADR-006). Re-implementing any part of it in TypeScript would split one
 *    Merge across several Batch entries.
 *  * **It never deletes.** `status = 'nonaktif'` is the only way a Lookup
 *    leaves the dropdowns; the row stays so Konsumen holding its id still
 *    resolve and every change stays revertable (ADR-003).
 *  * **It never changes `tipe`.** The FK column on `employees` is chosen by
 *    tipe, so moving a row between tipe would point its Karyawan at the wrong
 *    kind of Lookup — `lookupUpdateSchema` omits the field for that reason.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  countEmployeesByLookup,
  getLookupById,
  getLookupByKode,
} from "@/lib/db/lookups";
import { DbError, type DbClient } from "@/lib/db/shared";
import type { TablesUpdate } from "@/lib/types/db";
import { uuidField } from "@/lib/validation/common";
import {
  lookupCreateSchema,
  lookupUpdateSchema,
  type LookupCreateInput,
  type LookupUpdateInput,
} from "@/lib/validation/lookup";
import {
  isLookupType,
  LOOKUP_TYPE_LABELS,
  type LookupType,
} from "@/lib/validation/lookupTypes";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  requireUser,
  toActionFailure,
  type ActionResult,
} from "./_guard";
import { mapDbError, type DbErrorContext } from "./pgErrors";

/**
 * Terjemahan penolakan database untuk Lookup (lihat `mapDbError`).
 *
 * Hanya satu UNIQUE di `lookups`: `(tipe, kode)`. Penolakan RLS (`PGRST116`,
 * `42501`) dibentuk `mapDbError` dari `aksi`; kode yang tidak dikenal memakai
 * `fallback` yang diberikan per action.
 */
const LOOKUP_DB: DbErrorContext = {
  entitas: "Lookup",
  aksi: "mengubah Lookup",
  unikDefault: {
    message: "Kode itu sudah dipakai Lookup lain di tipe yang sama.",
    field: "kode",
  },
};

/** What every action here hands back — enough for the table to re-render. */
export type LookupSummary = {
  id: string;
  tipe: LookupType;
  kode: string;
  label: string;
  urutan: number | null;
  status: "aktif" | "nonaktif";
  mergedIntoId: string | null;
};

/** Columns read back after a write; the same list `lib/db/lookups.ts` uses. */
const SELECT_SUMMARY = "id, tipe, kode, label, urutan, status, merged_into_id";

/** The one argument `countKaryawanByLookup` takes. */
const lookupIdSchema = z.object({ id: uuidField("Lookup") });

type LookupRowShape = {
  id: string;
  tipe: string;
  kode: string;
  label: string;
  urutan: number | null;
  status: string;
  merged_into_id: string | null;
};

function toSummary(row: LookupRowShape): LookupSummary {
  if (!isLookupType(row.tipe)) {
    // Unreachable while the CHECK constraint and LOOKUP_TYPES agree, which
    // `lib/validation/lookupTypes.test.ts` and verify-schema.sql §17 both
    // assert. Refusing loudly beats handing the UI a tipe it cannot label.
    throw new ActionError("GAGAL", `Tipe Lookup tidak dikenal: ${row.tipe}`);
  }
  return {
    id: row.id,
    tipe: row.tipe,
    kode: row.kode,
    label: row.label,
    urutan: row.urutan,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
    mergedIntoId: row.merged_into_id,
  };
}

/** Refuse a kode that another Lookup of the same tipe already owns. */
async function assertKodeBebas(
  client: DbClient,
  tipe: LookupType,
  kode: string,
  kecualiId?: string,
): Promise<void> {
  const bentrok = await getLookupByKode(client, tipe, kode);
  if (bentrok && bentrok.id !== kecualiId) {
    throw new ActionError(
      "KONFLIK",
      `Kode "${kode}" sudah dipakai Lookup "${bentrok.label}" di tipe ${LOOKUP_TYPE_LABELS[tipe]}.`,
      { kode: `Kode "${kode}" sudah dipakai di tipe ini.` },
    );
  }
}

/** Every page that shows a Lookup label. */
function revalidateLookupPages(): void {
  revalidatePath("/master-data");
  // Karyawan and Perlu Dibereskan both render Lookup labels through the views.
  revalidatePath("/karyawan");
  revalidatePath("/bereskan");
  // Every write here trips `log_revision`, so Log Perubahan gains a Batch —
  // exactly as it does for Jabatan, Unit Organisasi, Karyawan and API Key.
  revalidatePath("/log");
}

/**
 * Tambah Lookup (PRD #9).
 *
 * `(tipe, kode)` is UNIQUE, and there is no DELETE, so a duplicate is checked
 * before the insert to give a readable message — the constraint is still the
 * thing that decides, which is why `23505` is mapped too (two admins can race).
 */
export async function createLookup(
  input: LookupCreateInput,
): Promise<ActionResult<LookupSummary>> {
  const parsed = lookupCreateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { tipe, kode, label, urutan, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    await assertKodeBebas(client, tipe, kode);

    const { data, error } = await client
      .from("lookups")
      .insert({ tipe, kode, label, urutan, status })
      .select(SELECT_SUMMARY)
      .single();

    if (error) throw new DbError("Gagal menambah Lookup", error);

    revalidateLookupPages();
    return actionOk(toSummary(data));
  } catch (error) {
    return toActionFailure(
      mapDbError(error, { ...LOOKUP_DB, fallback: "Gagal menambah Lookup. Coba lagi." }),
    );
  }
}

/**
 * Ubah Lookup (PRD #9) — label, kode, urutan, dan status, dalam satu UPDATE.
 *
 * One action rather than four, because all four are the same single-row write
 * and splitting them would only invite a second statement to creep into one of
 * them. Only the fields that actually changed are sent: `log_revision` skips a
 * write that moves nothing but `updated_at`, and an empty patch returns early
 * so the Log Perubahan stays free of entries that record nothing.
 *
 * Renaming is a rename **by reference**: one row moves, no Karyawan row is
 * touched, and every holder reads the new label through `v_employees`.
 */
export async function updateLookup(
  input: LookupUpdateInput,
): Promise<ActionResult<LookupSummary>> {
  const parsed = lookupUpdateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, kode, label, urutan, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getLookupById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Lookup tidak ditemukan.");
    }
    const summary = toSummary(current);

    const patch: TablesUpdate<"lookups"> = {};
    if (kode !== undefined && kode !== summary.kode) patch.kode = kode;
    if (label !== undefined && label !== summary.label) patch.label = label;
    if (urutan !== undefined && urutan !== summary.urutan) patch.urutan = urutan;
    if (status !== undefined && status !== summary.status) patch.status = status;

    if (Object.keys(patch).length === 0) return actionOk(summary);

    // A Lookup that was merged away is the source half of a Merge Batch:
    // its Karyawan already moved to the target. Switching it back to `aktif`
    // on its own would put an empty duplicate back in every dropdown and leave
    // `merged_into_id` pointing somewhere. Undo the Merge through the Log
    // Perubahan instead (PRD #16).
    if (patch.status === "aktif" && summary.mergedIntoId !== null) {
      throw new ActionError(
        "KONFLIK",
        `Lookup "${summary.label}" sudah digabungkan ke Lookup lain, jadi tidak bisa diaktifkan lagi. Kembalikan Batch Merge-nya lewat Log Perubahan.`,
      );
    }

    if (patch.kode !== undefined) {
      await assertKodeBebas(client, summary.tipe, patch.kode, summary.id);
    }

    const { data, error } = await client
      .from("lookups")
      .update(patch)
      .eq("id", id)
      .select(SELECT_SUMMARY)
      .single();

    if (error) throw new DbError("Gagal menyimpan Lookup", error);

    revalidateLookupPages();
    return actionOk(toSummary(data));
  } catch (error) {
    return toActionFailure(
      mapDbError(error, { ...LOOKUP_DB, fallback: "Gagal menyimpan Lookup. Coba lagi." }),
    );
  }
}

/**
 * Berapa Karyawan yang memakai satu Lookup.
 *
 * A read, exposed as an action because the number is only needed once a dialog
 * opens: "Nonaktifkan" and "Merge" both have to say how many Karyawan are
 * affected before they ask for confirmation. Viewers may read it too — the
 * count is not sensitive, and RLS decides in any case.
 */
export async function countKaryawanByLookup(
  id: string,
): Promise<ActionResult<{ id: string; total: number }>> {
  // Validated like every other action here: an id that is not a uuid would
  // otherwise reach `.eq("id", …)` on a uuid column and come back as a
  // "gagal menyimpan" message for what is a read.
  const parsed = lookupIdSchema.safeParse({ id });
  if (!parsed.success) return actionInvalid(parsed.error);

  try {
    const { client } = await requireUser();

    const lookup = await getLookupById(client, parsed.data.id);
    if (!lookup) {
      throw new ActionError("TIDAK_DITEMUKAN", "Lookup tidak ditemukan.");
    }

    const total = await countEmployeesByLookup(client, lookup);
    return actionOk({ id: lookup.id, total });
  } catch (error) {
    return toActionFailure(error);
  }
}
