"use server";

/**
 * Pengguna — set a user's role to `admin` or `viewer` (PRD #21).
 *
 * Shape follows `lib/actions/_reference.ts`: validate → guard → read → write →
 * revalidate → return an `ActionResult`, never a throw.
 *
 * Two things this action deliberately does NOT do:
 *
 *   * **It does not write a Revisi.** `profiles` is the seventh logged table
 *     (ADR-005 §12), so the `log_revision` trigger records the promotion, who
 *     did it and when, and the Log Perubahan can revert it. Application code
 *     writing to `revisions` would duplicate the row and break that guarantee
 *     (ADR-003: the log is written by triggers, not by code).
 *   * **It does not open a Batch by hand.** This is ONE UPDATE of ONE row, and
 *     over PostgREST `withBatch()` cannot group it: `begin_batch` runs with
 *     `p_local = true` (ADR-005 §9), so `app.batch_id` dies with that RPC's
 *     transaction and the UPDATE — a separate HTTP request — never sees it.
 *     `lib/revisions/batch.ts` says so in its own header, and
 *     `lib/actions/_reference.ts` spells out the result: TWO rows in the Log
 *     Perubahan, one carrying the keterangan and one carrying the Revisi.
 *     For a single-statement action that is a worse log, not a better one, so
 *     the trigger's automatic Batch is used as-is. Nothing escapes the log
 *     either way, and the Revisi itself still records `before.role`,
 *     `after.role`, `actor_id` and the timestamp — which is the audit trail
 *     that matters for a promotion.
 *
 * The role check is here AND in RLS: `profiles_update` already requires
 * `is_admin()`, so a viewer who called this directly would get zero rows back.
 * Both, not either (CLAUDE.md).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getProfileById } from "@/lib/auth/profiles";
import { DbError } from "@/lib/db/shared";
import { roleSchema } from "@/lib/validation/common";

import {
  ActionError,
  actionInvalid,
  actionOk,
  requireAdmin,
  toActionFailure,
  type ActionResult,
  type AppRole,
} from "./_guard";

const setRoleSchema = z.object({
  id: z.uuid({ error: "Pengguna harus dipilih dari daftar." }),
  role: roleSchema,
});

export type SetUserRoleInput = z.input<typeof setRoleSchema>;

export type SetUserRoleResult = {
  id: string;
  email: string;
  role: AppRole;
};

export async function setUserRole(
  input: SetUserRoleInput,
): Promise<ActionResult<SetUserRoleResult>> {
  const parsed = setRoleSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, role } = parsed.data;

  try {
    const { client, user } = await requireAdmin();

    // Losing your own admin rights by accident locks you out of the page that
    // could give them back. Demoting someone else is still allowed — that is
    // the point of the page.
    if (id === user.id && role !== "admin") {
      throw new ActionError(
        "KONFLIK",
        "Anda tidak bisa menurunkan role Anda sendiri. Minta admin lain yang melakukannya.",
      );
    }

    const current = await getProfileById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Pengguna tidak ditemukan.");
    }

    // Nothing to change. `log_revision` would ignore an `updated_at`-only
    // UPDATE anyway (ADR-005 §10), so returning early keeps the Log Perubahan
    // free of empty entries.
    if (current.role === role) {
      return actionOk({ id: current.id, email: current.email, role: current.role });
    }

    const { data, error } = await client
      .from("profiles")
      .update({ role })
      .eq("id", id)
      .select("id, email, role")
      .maybeSingle();

    if (error) throw new DbError("Gagal mengubah role Pengguna", error);
    if (!data) {
      // RLS refused the UPDATE, or the row disappeared between the read and
      // the write. Either way nothing was changed.
      throw new ActionError(
        "KONFLIK",
        "Role Pengguna tidak jadi diubah. Muat ulang halaman, lalu coba lagi.",
      );
    }

    revalidatePath("/pengguna");
    // The promotion shows up as a Revisi, so the Log Perubahan is stale too.
    revalidatePath("/log");

    return actionOk({
      id: data.id,
      email: data.email,
      role: data.role === "admin" ? "admin" : "viewer",
    });
  } catch (error) {
    return toActionFailure(error);
  }
}
