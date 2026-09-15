/**
 * Reading a row's Riwayat Revisi on the server, for a detail page (PRD #14).
 *
 * A page-side helper, not a `lib/db` read: everything in `lib/db/**` throws a
 * `DbError` and lets the caller decide, and this is that decision, taken the
 * same way on all four detail pages. It lives under `app/(app)/_lib/` — the
 * page half of the mirror to `app/api/v1/_lib/` — because it is only ever
 * imported by a Server Component and must never reach a client bundle: it
 * pulls in the whole `lib/db` read layer.
 *
 * `_lib` starts with an underscore, so Next.js treats the folder as private and
 * never routes to it.
 */
import { listRevisionsByRow } from "@/lib/db/revisions";
import type { DbClient } from "@/lib/db/shared";
import type { LoggedTable } from "@/lib/revisions/tables";
import type { Revision } from "@/lib/types/db";

import { RIWAYAT_LIMIT } from "@/components/revisions/riwayat";

/**
 * Riwayat Revisi of one row, or `undefined` if that read failed.
 *
 * Deliberately swallowed rather than thrown: the Riwayat is a side panel, and
 * letting a hiccup on `revisions` replace the whole page with `error.tsx`
 * would hide the data the visitor actually came for. `undefined` makes
 * `RevisionPanel` load the list itself, with its own retry button. An RLS
 * refusal is not a failure at all — it comes back as a shorter list, and the
 * panel already says so.
 *
 * `konteks` is the log prefix, e.g. `"struktur/detail"`, so a failure in the
 * server log names the page it happened on.
 */
export async function bacaRiwayat(
  client: DbClient,
  table: LoggedTable,
  rowId: string,
  konteks: string,
): Promise<Revision[] | undefined> {
  try {
    return await listRevisionsByRow(client, {
      table,
      rowId,
      limit: RIWAYAT_LIMIT,
    });
  } catch (error) {
    console.error(`[${konteks}] gagal memuat Riwayat Revisi`, error);
    return undefined;
  }
}
