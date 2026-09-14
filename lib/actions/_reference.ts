"use server";

/**
 * THE REFERENCE SERVER ACTION — copy this shape, not this file.
 *
 * FROZEN CONTRACT (Wave 1). Every write in HC Core goes through a Server
 * Action, and thirteen units are about to write them in parallel. This is one
 * worked all the way through, so that they all place `"use server"` in the same
 * spot, guard in the same order, open a Batch the same way, and return the same
 * shape. Renaming a Jabatan is the smallest real write there is: one row, one
 * Revisi, and a rename that reaches every holder through `v_employees` without
 * touching a single Karyawan row (PRD #8).
 *
 * The seven steps, in this order:
 *
 *   1. `"use server"` at the top of the FILE, not inside the function. A
 *      `"use server"` file may EXPORT only async functions — importing
 *      anything (guards, schemas, types) is fine, and `export type` is erased
 *      before the check.
 *   2. Validate with the shared zod schema — the same one the form uses
 *      (ARCHITECTURE.md §1). Never trust the client's copy of the check.
 *   3. `requireAdmin()`. RLS will refuse a viewer too; both are required
 *      (CLAUDE.md).
 *   4. Read the current row, so the Batch keterangan can say what changed and
 *      a missing row is a clean "tidak ditemukan" instead of a silent no-op.
 *   5. Write inside `withBatch()` — never an `update()` outside one
 *      (ARCHITECTURE.md §6). That holds for a ONE-STATEMENT action like this
 *      one; an action that writes several rows belongs in SQL instead, see the
 *      note at step 5 below.
 *   6. `revalidatePath()` every page that shows the row.
 *   7. Return `ActionResult`, never throw: a thrown error reaches the browser
 *      as an opaque digest.
 *
 * The real `renameJabatan` belongs to the Jabatan unit, in
 * `lib/actions/jabatan.ts`. This function is deliberately named
 * `renameJabatanReference` so the two can never collide, and so this file can
 * be deleted the day nobody needs the example any more.
 */
import { revalidatePath } from "next/cache";

import { getJabatanById } from "@/lib/db/jabatan";
import { DbError } from "@/lib/db/shared";
import { batchKeterangan, withBatch } from "@/lib/revisions/batch";
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
  // 2. Validate first: no session lookup, no database round trip, no Batch for
  //    input that was never going to be written.
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
    // Perubahan free of empty Batch entries.
    if (current.nama === nama) {
      return actionOk({ id: current.id, nama: current.nama });
    }

    // 5. One Batch around ONE statement — and "one statement" is the whole
    //    condition for using `withBatch()` at all.
    //
    //    What actually lands in the Log Perubahan, and why: `begin_batch` runs
    //    with `p_local = true` (the safe default, ADR-005 §9), so
    //    `app.batch_id` is scoped to that RPC's transaction — and supabase-js
    //    sends this UPDATE as a separate request, i.e. a separate transaction.
    //    The trigger therefore does not see the Batch opened here and creates
    //    its own `edit` Batch for the Revisi. Expect TWO rows on `/log`: the
    //    `rename` Batch below, which carries the human-readable keterangan, and
    //    an automatic `edit` Batch that holds the Revisi itself. The change is
    //    still fully logged and still revertable one Revisi at a time (PRD #15).
    //
    //    An action that writes SEVERAL rows must NOT be built by putting more
    //    statements inside this callback: there, per-statement grouping is not
    //    untidy but wrong, because "kembalikan Batch ini" would undo a fraction
    //    of the action (PRD #16). Those belong in a Postgres function, where
    //    one RPC call is one transaction and one real Batch — Merge, Revert and
    //    Seed already moved there (`supabase/migrations/0002_batch_operations.sql`,
    //    ADR-006). `lib/actions/merge.ts` shows what calling one looks like;
    //    note that it does not use `withBatch()` at all, because the function
    //    opens its own Batch.
    //
    //    Either way, do not pass `sessionScoped: true` from a Server Action —
    //    that is the pooled-connection leak ADR-005 §9 refuses.
    const { result } = await withBatch(
      client,
      {
        jenis: "rename",
        keterangan: batchKeterangan("Ganti nama Jabatan", current.nama, nama),
      },
      async ({ client: tx }) => {
        const { data, error } = await tx
          .from("jabatan")
          .update({ nama })
          .eq("id", id)
          .select("id, nama")
          .single();

        if (error) throw new DbError("Gagal mengganti nama Jabatan", error);
        return data;
      },
    );

    // 6. Refresh every page that shows a Jabatan name.
    revalidatePath("/jabatan");
    revalidatePath("/karyawan");

    // 7. One shape for success, one for failure.
    return actionOk({ id: result.id, nama: result.nama });
  } catch (error) {
    return toActionFailure(error);
  }
}
