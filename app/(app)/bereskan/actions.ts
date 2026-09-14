"use server";

/**
 * Ganti nama Data Referensi dari halaman "Perlu Dibereskan" (PRD #12).
 *
 * PRD #12 is one sentence — "dari halaman tersebut admin bisa langsung merge
 * atau rename **tanpa pindah halaman**" — and it is the whole reason these
 * exist. Merge already had a home (`lib/actions/merge.ts`, imported as-is);
 * rename did not, because a rename is a single-row UPDATE and therefore lives
 * with the entity that owns it.
 *
 * WHY THESE ARE HERE AND NOT IN `lib/actions/`
 * ---------------------------------------------------------------------------
 * `lib/actions/orgUnits.ts` and `lib/actions/jabatan.ts` belong to the Struktur
 * Organisasi and Jabatan units, which are being written in parallel with this
 * one. This unit must not create those files, so the two renames "Perlu
 * Dibereskan" needs are colocated with the route that calls them. Everything
 * that matters about the convention is kept: the write still goes through a
 * Server Action, still guards, still validates with the **frozen** shared zod
 * schemas, still returns `ActionResult`, and there is still nothing writing to
 * the database from a Client Component. When those two entity action files
 * land, these should be deleted and their callers pointed at them — the input
 * and output types are already the shared ones, so that is an import change.
 *
 * `lib/actions/lookups.ts` has already landed, so `renameLookup()` below does
 * exactly that: it delegates instead of writing a third path to the same
 * column.
 *
 * Shape copied from `lib/actions/_reference.ts`, step for step: validate →
 * `requireAdmin()` → read current row → ONE statement → revalidate → return.
 * No Batch is opened: the `log_revision` trigger creates the Batch that holds
 * the Revisi, and a Batch opened from TypeScript would be empty (ADR-006).
 */
import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";

import { getJabatanById } from "@/lib/db/jabatan";
import { getOrgUnitById } from "@/lib/db/orgUnits";
import { DbError } from "@/lib/db/shared";
import { jabatanRenameSchema, type JabatanRenameInput } from "@/lib/validation/jabatan";
import { lookupRenameSchema, type LookupRenameInput } from "@/lib/validation/lookup";
import { orgUnitRenameSchema, type OrgUnitRenameInput } from "@/lib/validation/orgUnit";
import { updateLookup } from "@/lib/actions/lookups";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "@/lib/actions/_guard";

/** What every rename here hands back: the row as it now reads. */
type RenameResult = { id: string; nama: string };

/**
 * Turn a failed UPDATE into something staf HC can act on.
 *
 * The one case worth naming is `PGRST116`. RLS is written `using (is_admin())`,
 * so a non-admin's UPDATE does not raise `insufficient_privilege` — it simply
 * matches **zero rows**, and `.single()` then reports "no rows returned". The
 * row was read a moment earlier, so zero rows now means either the policy
 * refused the write or the row disappeared between the two calls. Saying so
 * beats the generic "coba lagi", which would invite the user to retry
 * something that can never succeed.
 */
function updateError(context: string, error: PostgrestError): Error {
  if (error.code === "PGRST116") {
    return new ActionError(
      "BUKAN_ADMIN",
      "Perubahan ditolak database: hanya admin yang bisa mengganti nama, atau barisnya sudah tidak ada.",
    );
  }
  return new DbError(context, error);
}

/**
 * Pages that show a Data Referensi name, and therefore go stale on a rename.
 *
 * `/karyawan` is on every list because a rename reaches every Karyawan through
 * `v_employees` without touching a single `employees` row (PRD #7, #8).
 */
const REVALIDATE_ALWAYS = ["/bereskan", "/karyawan", "/log"] as const;

function revalidate(extra: readonly string[]): void {
  for (const path of [...REVALIDATE_ALWAYS, ...extra]) revalidatePath(path);
}

/** Ganti nama Unit Organisasi (PRD #7). */
export async function renameOrgUnit(
  input: OrgUnitRenameInput,
): Promise<ActionResult<RenameResult>> {
  const parsed = orgUnitRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getOrgUnitById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Unit Organisasi tidak ditemukan.");
    }
    // Nothing moved: `log_revision` would record a Revisi with no change in it.
    if (current.nama === nama) return actionOk({ id: current.id, nama: current.nama });

    const { data, error } = await client
      .from("org_units")
      .update({ nama })
      .eq("id", id)
      .select("id, nama")
      .single();

    if (error) throw updateError("Gagal mengganti nama Unit Organisasi", error);

    revalidate(["/struktur"]);
    return actionOk({ id: data.id, nama: data.nama });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Ganti nama Jabatan (PRD #8). */
export async function renameJabatan(
  input: JabatanRenameInput,
): Promise<ActionResult<RenameResult>> {
  const parsed = jabatanRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getJabatanById(client, id);
    if (!current) throw new ActionError("TIDAK_DITEMUKAN", "Jabatan tidak ditemukan.");
    if (current.nama === nama) return actionOk({ id: current.id, nama: current.nama });

    const { data, error } = await client
      .from("jabatan")
      .update({ nama })
      .eq("id", id)
      .select("id, nama")
      .single();

    if (error) throw updateError("Gagal mengganti nama Jabatan", error);

    revalidate(["/jabatan"]);
    return actionOk({ id: data.id, nama: data.nama });
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Ganti label Lookup (PRD #9) — delegated, not reimplemented.
 *
 * `lib/actions/lookups.ts` landed while this page was being built, and its
 * `updateLookup()` already owns the single-row write for a Lookup: it sends
 * only the fields that moved, refuses to reactivate a row that was merged
 * away, and revalidates `/bereskan` among others. A second UPDATE path to the
 * same column would be one more place for those rules to fall out of step, so
 * this is a thin adapter — it exists only to keep the dialog's one shape
 * (`{ id, nama }`) across all three kinds.
 *
 * The column really is `label`, not `nama` (CONTEXT.md); `lookupRenameSchema`
 * validates that here before the shared action validates it again.
 */
export async function renameLookup(
  input: LookupRenameInput,
): Promise<ActionResult<RenameResult>> {
  const parsed = lookupRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, label } = parsed.data;

  const hasil = await updateLookup({ id, label });
  if (!hasil.ok) return hasil;
  return actionOk({ id: hasil.data.id, nama: hasil.data.label });
}
