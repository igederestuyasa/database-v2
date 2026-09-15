"use server";

/**
 * Ganti label Lookup dari halaman "Perlu Dibereskan" (PRD #12).
 *
 * PRD #12 is one sentence — "dari halaman tersebut admin bisa langsung merge
 * atau rename **tanpa pindah halaman**" — and it is the whole reason this file
 * exists. Merge already had a home (`lib/actions/merge.ts`, imported as-is).
 *
 * WHAT USED TO BE HERE, AND WHY IT IS NOT ANY MORE
 * ---------------------------------------------------------------------------
 * This file also carried its own `renameOrgUnit()` and `renameJabatan()`,
 * written while `lib/actions/orgUnits.ts` and `lib/actions/jabatan.ts` were
 * still being built by other units in parallel, with a note saying to delete
 * them once those landed. They have landed, so they are deleted: both owned
 * the same single-row UPDATE, guarded the same way, and validated with the
 * same frozen zod schemas, and two code paths to one column are how the rules
 * around that column drift apart. `RenameDialog` now calls the entity actions
 * directly.
 *
 * `renameLookup()` stays, and was never a duplicate: it delegates to
 * `updateLookup()` in `lib/actions/lookups.ts`. It exists only to keep the
 * dialog's one shape (`{ id, nama }`) across all three kinds, because the
 * column on `lookups` really is `label`, not `nama` (CONTEXT.md).
 */
import { updateLookup } from "@/lib/actions/lookups";
import { lookupRenameSchema, type LookupRenameInput } from "@/lib/validation/lookup";

import { actionInvalid, actionOk, type ActionResult } from "@/lib/actions/_guard";

/** What the rename dialog reads back: the row as it now reads. */
type RenameResult = { id: string; nama: string };

/**
 * Ganti label Lookup (PRD #9) — delegated, not reimplemented.
 *
 * `updateLookup()` owns the single-row write for a Lookup: it sends only the
 * fields that moved, refuses to reactivate a row that was merged away, and
 * revalidates `/bereskan` among others. A second UPDATE path to the same
 * column would be one more place for those rules to fall out of step, so this
 * is a thin adapter and nothing else.
 *
 * `lookupRenameSchema` validates here before the shared action validates
 * again — the client half of the check is never the only one.
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
