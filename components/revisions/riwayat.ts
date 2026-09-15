/**
 * How many Revisi a detail page draws, and how many it must read to say so
 * honestly.
 *
 * Pure on purpose — no React, no database, no `next/*`. `RevisionPanel` is a
 * Client Component and the four detail pages are Server Components, and both
 * sides need the same two numbers to agree.
 *
 * WHY THE TWO NUMBERS HAVE TO AGREE
 * ---------------------------------------------------------------------------
 * When `RevisionPanel` loads its own list it asks for five times what it draws
 * (`panelFetchLimit`), and it prints
 *
 *     "Menampilkan 50 Revisi terbaru. Riwayat selengkapnya ada di Log
 *      Perubahan."
 *
 * precisely when the list it holds has reached that ceiling. A page that reads
 * the Riwayat on the server and hands it in must therefore use the **same**
 * ceiling: a smaller one would make the panel claim a row's Riwayat is
 * complete when it is not, and a larger one would make it claim the opposite.
 *
 * This used to be a constant on `/karyawan/[id]` with a comment asking the
 * next reader to keep it in step with an expression inside `RevisionPanel`.
 * With four detail pages that is four chances to drift, so the expression is
 * here, both sides call it, and `riwayat.test.ts` pins them together.
 *
 * The cost of reading five times what is drawn is the RSC payload:
 * `before`/`after` are whole-row snapshots, so a heavily edited row ships up
 * to 50 of them per panel. Rows with that many Revisi are the exception (a
 * seed insert, then a handful of edits), and the alternative — letting the
 * panel fetch — moves the same bytes over a second round trip behind a
 * spinner.
 */

/** How many Revisi `RevisionPanel` draws before "Tampilkan semua". */
export const RIWAYAT_DITAMPILKAN = 10;

/**
 * The ceiling `RevisionPanel` fetches with, given what it draws.
 *
 * Five times the visible list so "Tampilkan semua" needs no second round trip,
 * never below 50 (a Karyawan created by Seed and edited twice would otherwise
 * ship a list of 15), and never above 200 — the same cap
 * `loadRowRevisions` enforces server-side, so asking for more would be a
 * number the Server Action silently refuses.
 */
export function panelFetchLimit(limit: number): number {
  return Math.min(Math.max(limit * 5, 50), 200);
}

/**
 * How many Revisi a detail page reads on the server for its panel.
 *
 * Kept as the literal `RIWAYAT_DITAMPILKAN * 5` rather than a call to
 * `panelFetchLimit()`, so the number a reader of a page sees is the number
 * they can reason about; `riwayat.test.ts` is what proves the two match.
 */
export const RIWAYAT_LIMIT = RIWAYAT_DITAMPILKAN * 5;
