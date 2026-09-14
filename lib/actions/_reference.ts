"use server";

/**
 * THE REFERENCE SERVER ACTION — copy this shape, not this file.
 *
 * FROZEN CONTRACT (Wave 1). Every write in HC Core goes through a Server
 * Action, and thirteen units are about to write them in parallel. This is one
 * worked all the way through, so that they all place `"use server"` in the same
 * spot, guard in the same order, write the same way, and return the same shape.
 * Renaming a Jabatan is the smallest real write there is: one row, one Revisi,
 * and a rename that reaches every holder through `v_employees` without touching
 * a single Karyawan row (PRD #8).
 *
 * The six steps, in this order:
 *
 *   1. `"use server"` at the top of the FILE, not inside the function. A
 *      `"use server"` file may EXPORT only async functions — importing
 *      anything (guards, schemas, types) is fine, and `export type` is erased
 *      before the check.
 *   2. Validate with the shared zod schema — the same one the form uses
 *      (ARCHITECTURE.md §1). Never trust the client's copy of the check.
 *   3. `requireAdmin()`. RLS will refuse a viewer too; both are required
 *      (CLAUDE.md).
 *   4. Read the current row, so a missing row is a clean "tidak ditemukan"
 *      instead of a silent no-op, and an unchanged one can return early.
 *   5. Write — ONE statement, directly, with no Batch call around it. The
 *      `log_revision` trigger creates the Batch that holds the Revisi. See the
 *      note at step 5 below before adding a second statement.
 *   6. `revalidatePath()` every page that shows the row, then return
 *      `ActionResult` — never throw: a thrown error reaches the browser as an
 *      opaque digest.
 *
 * The real `renameJabatan` belongs to the Jabatan unit, in
 * `lib/actions/jabatan.ts`. This function is deliberately named
 * `renameJabatanReference` so the two can never collide, and so this file can
 * be deleted the day nobody needs the example any more.
 */
import { revalidatePath } from "next/cache";

import { getJabatanById } from "@/lib/db/jabatan";
import { DbError } from "@/lib/db/shared";
import { jabatanRenameSchema } from "@/lib/validation/jabatan";
import type { JabatanRenameInput } from "@/lib/validation/jabatan";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "./_guard";

export async function renameJabatanReference(
  input: JabatanRenameInput,
): Promise<ActionResult<{ id: string; nama: string }>> {
  // 2. Validate first: no session lookup and no database round trip for input
  //    that was never going to be written.
  const parsed = jabatanRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama } = parsed.data;

  try {
    // 3. Guard. Throws UnauthenticatedError / ForbiddenError, both of which
    //    toActionFailure() turns into a readable failure.
    const { client } = await requireAdmin();

    // 4. Read the current row.
    const current = await getJabatanById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Jabatan tidak ditemukan.");
    }

    // Nothing to do. `log_revision` would ignore the write anyway (the only
    // column that would move is `updated_at`), so returning early keeps the Log
    // Perubahan free of entries that record nothing.
    if (current.nama === nama) {
      return actionOk({ id: current.id, nama: current.nama });
    }

    // 5. ONE statement, written directly. No `begin_batch`, no wrapper.
    //
    //    Why there is nothing here to open a Batch with: `begin_batch` sets
    //    `app.batch_id` transaction-locally (the only safe scope on a pooled
    //    connection, ADR-005 §9), and supabase-js sends every call as its own
    //    request, i.e. its own transaction. A Batch opened in one request is
    //    therefore already gone when this UPDATE arrives in the next, so the
    //    trigger opens its own — and the named Batch would sit in `/log`
    //    holding nothing. Letting the trigger's automatic `edit` Batch be the
    //    record gives exactly ONE row on `/log`, and that row contains the
    //    Revisi (ADR-006).
    //
    //    An action that writes SEVERAL rows must NOT be built by adding more
    //    statements here: each one would land in a Batch of its own, so
    //    "kembalikan Batch ini" would undo a fraction of the action (PRD #16).
    //    Those belong in a Postgres function, where one RPC call is one
    //    transaction and one real Batch — Merge, Revert and Seed already moved
    //    there (`supabase/migrations/0002_batch_operations.sql`, ADR-006).
    //    `lib/actions/merge.ts` shows what calling one looks like.
    const { data, error } = await client
      .from("jabatan")
      .update({ nama })
      .eq("id", id)
      .select("id, nama")
      .single();

    if (error) throw new DbError("Gagal mengganti nama Jabatan", error);

    // 6. Refresh every page that shows a Jabatan name, then return.
    revalidatePath("/jabatan");
    revalidatePath("/karyawan");

    return actionOk({ id: data.id, nama: data.nama });
  } catch (error) {
    return toActionFailure(error);
  }
}
