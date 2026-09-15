/**
 * Reading a row's Riwayat Revisi on the server, for a detail page (PRD #14).
 *
 * A page-side helper, not a `lib/db` read: everything in `lib/db/**` throws a
 * `DbError` and lets the caller decide, and this is that decision, taken the
 * same way on all four detail pages — through `bacaAman()`, so a hiccup on
 * `revisions` does not replace the whole page with `error.tsx`. `undefined`
 * makes `RevisionPanel` load the list itself, with its own retry button. An
 * RLS refusal is not a failure at all — it comes back as a shorter list, and
 * the panel already says so.
 *
 * It lives under `app/(app)/_lib/` — the page half of the mirror to
 * `app/api/v1/_lib/` — because it is only ever imported by a Server Component
 * and must never reach a client bundle: it pulls in the whole `lib/db` read
 * layer. `_lib` starts with an underscore, so Next.js never routes to it.
 *
 * `konteks` is the log prefix, e.g. `"struktur/detail"`, so a failure in the
 * server log names the page it happened on.
 */
import { RIWAYAT_LIMIT } from "@/components/revisions/riwayat";
import { listRevisionsByRow } from "@/lib/db/revisions";
import type { DbClient } from "@/lib/db/shared";
import type { LoggedTable } from "@/lib/revisions/tables";
import type { Revision } from "@/lib/types/db";

import { bacaAman } from "./bacaAman";

export async function bacaRiwayat(
  client: DbClient,
  table: LoggedTable,
  rowId: string,
  konteks: string,
): Promise<Revision[] | undefined> {
  return bacaAman(`[${konteks}] gagal memuat Riwayat Revisi`, () =>
    listRevisionsByRow(client, { table, rowId, limit: RIWAYAT_LIMIT }),
  );
}
