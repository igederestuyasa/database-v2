/**
 * The five database failures every Server Action eventually meets, in one
 * place — as a **default**, never as a replacement for an entity's own wording.
 *
 * Each action file already translates the codes that matter to it, because the
 * good message names the thing: "Kode Unit Organisasi «DIV-HC» sudah dipakai
 * unit lain" beats "Nilai ini sudah dipakai baris lain". Those stay. What this
 * module fixes is the *other* half of the drift: an action that maps nothing
 * (or maps four of the five) falls through to `toActionFailure()`'s catch-all
 * "Gagal menyimpan perubahan. Coba lagi." — which tells staf HC nothing, and
 * invites them to retry a write that can never succeed. Six units are about to
 * write new actions against this contract; this is the floor under them.
 *
 * `PGRST116` is the one worth reading twice. RLS on every data table is written
 * `using (public.is_admin())`, and a USING clause **filters**: a viewer's
 * UPDATE does not raise `insufficient_privilege`, it matches **zero rows**, and
 * `.single()` then answers PGRST116 — "no rows returned". So the shape of an
 * RLS refusal on an UPDATE is a not-found, and an action that treats PGRST116
 * as "hilang" will tell a viewer the data disappeared.
 *
 * Deliberately NOT exported as a drop-in replacement for anyone's `readable…`
 * helper, and deliberately free of `next/headers`: it is pure, so it is tested.
 */
import { UI } from "@/lib/i18n/terms";

import type { ActionErrorCode } from "./_guard";

/** What a recognised database code means, in Indonesian. */
export type DatabaseFailure = {
  code: ActionErrorCode;
  message: string;
};

/**
 * Postgres SQLSTATEs and PostgREST codes an ordinary one-statement action can
 * hit, mapped to the least wrong general-purpose sentence.
 *
 * Kept generic on purpose: a message here can be shown for any table, so it
 * must not claim to know which column or which entity was involved.
 */
const BY_CODE: Readonly<Record<string, DatabaseFailure>> = {
  // unique_violation — two admins racing, or a kode that already exists.
  "23505": {
    code: "KONFLIK",
    message:
      "Nilai ini sudah dipakai baris lain dan harus unik. Muat ulang halaman, lalu pakai nilai lain.",
  },
  // foreign_key_violation — the row being pointed at is gone.
  "23503": {
    code: "KONFLIK",
    message:
      "Data yang dirujuk sudah tidak ada. Muat ulang halaman, lalu pilih ulang.",
  },
  // check_violation — a CHECK constraint or a guard trigger said no.
  "23514": {
    code: "KONFLIK",
    message:
      "Nilai yang dikirim ditolak aturan basis data. Periksa kembali isian, lalu coba lagi.",
  },
  // insufficient_privilege — `with check (is_admin())` on INSERT really throws.
  "42501": {
    code: "BUKAN_ADMIN",
    message: UI.hanyaAdmin,
  },
  // No rows returned. On an UPDATE that is what an RLS refusal looks like.
  PGRST116: {
    code: "BUKAN_ADMIN",
    message: `${UI.hanyaAdmin} Kalau Anda memang admin, baris ini baru saja diubah orang lain — muat ulang halaman lalu coba lagi.`,
  },
};

/** Every code with a shared default, for tests and for readers. */
export const KNOWN_DATABASE_CODES = Object.keys(BY_CODE) as readonly string[];

/**
 * The default meaning of a database code, or `null` when there is none.
 *
 * `null` is not a failure to handle — it means "nothing generic to say", and
 * the caller should keep its own behaviour (log it, show the catch-all).
 */
export function classifyDatabaseError(
  code: string | null | undefined,
): DatabaseFailure | null {
  if (!code) return null;
  return BY_CODE[code] ?? null;
}
