/**
 * Normalisasi nama untuk deteksi Temuan "nama mirip" (PRD #11).
 *
 * WHY THIS MODULE IS TESTED AND MOST ARE NOT
 * ---------------------------------------------------------------------------
 * ARCHITECTURE.md §7 names three modules worth unit-testing, and this is one of
 * them: a bug here is silent. Nothing throws, nothing looks wrong on screen —
 * "Divisi QHSSE" and "DIVISI QHSSE" simply never appear as a pair, so staf HC
 * never merges them, and both spellings stay in the database forever. The
 * table-driven tests next door are the only place that failure can surface.
 *
 * WHAT COUNTS AS "MIRIP"
 * ---------------------------------------------------------------------------
 * PRD §6 rules out any AI/LLM, and PRD #11 lists the differences by name:
 * kapitalisasi, spasi, "dan" vs "&". Punctuation and accents come from the same
 * family of Excel dirt and are folded too. Everything here is plain string
 * normalization — no edit distance, no phonetics, no dependency. Two names are
 * "mirip" when they fold to the **same** key; nothing is ever a partial match.
 *
 * That ceiling is deliberate. A typo that survives normalization ("QHSSE" vs
 * "QHSE") is NOT reported, because a fuzzy matcher's false positives are what
 * turn "Perlu Dibereskan" into a page nobody finishes — and this page is meant
 * to reach zero (PRD §7).
 *
 * Pure functions only: no Supabase, no React, no I/O. Data in, string out.
 */

/** Zero-width and format characters. Excel exports carry these invisibly. */
const INVISIBLE = /[­​-‏⁠﻿]/g;

/** Combining diacritical marks, left behind by NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Punctuation and symbols, replaced by a space.
 *
 * ASCII punctuation plus the unicode dashes, quotes, bullets and signs that
 * arrive from Excel. Deliberately does NOT include letters: `À`-`ÿ`
 * (à, é, ñ …) stay, so the "aksen" probe below can still see them.
 */
const PUNCTUATION =
  /[!-\/:-@[-`{-~¡-¿×÷‐-‧‰-⁞−]/g;

const WHITESPACE = /\s+/g;

/** The kinds of difference normalization can absorb (PRD #11). */
export type NameDifference =
  | "kapitalisasi"
  | "spasi"
  | "tanda_baca"
  | "ampersand"
  | "aksen";

/** Every kind, in the order `explainSimilarity()` reports them. */
export const NAME_DIFFERENCES: readonly NameDifference[] = [
  "kapitalisasi",
  "spasi",
  "tanda_baca",
  "ampersand",
  "aksen",
];

/**
 * Which folds to apply. Every flag defaults to "on"; switching one off is how
 * `explainSimilarity()` asks "was this the difference?".
 */
export type FoldOptions = {
  /** Lowercase. Default `true`. */
  foldCase?: boolean;
  /** "Café" → "Cafe". Default `true`. */
  stripAccents?: boolean;
  /** "&" → " dan ". Default `true`. */
  unifyAmpersand?: boolean;
  /** "-", ".", "(", "/" … → space. Default `true`. */
  ignorePunctuation?: boolean;
  /**
   * `"collapse"` — runs of whitespace become one space, ends trimmed (default).
   * `"ignore"` — whitespace removed entirely, so "SubBagian" folds onto
   *   "Sub Bagian".
   * `"keep"` — left exactly as it arrived.
   */
  whitespace?: "collapse" | "ignore" | "keep";
};

/**
 * The one fold. Every other function here is this with different options.
 *
 * Order matters and is not free to rearrange:
 *   1. NFKC first, so fullwidth "＆" and ligatures become their ASCII form
 *      before anything looks for them;
 *   2. invisible characters removed, because they are not whitespace to `\s`
 *      and would survive every later step;
 *   3. accents, then case — both per-character and independent;
 *   4. "&" → " dan " **before** punctuation, or the ampersand would already
 *      have become a space and "A & B" would never meet "A dan B";
 *   5. punctuation → space, not "", so "K3/Lingkungan" becomes two words
 *      rather than one;
 *   6. whitespace last, once every earlier step has finished inserting it.
 */
export function foldName(
  value: string | null | undefined,
  options: FoldOptions = {},
): string {
  const {
    foldCase = true,
    stripAccents = true,
    unifyAmpersand = true,
    ignorePunctuation = true,
    whitespace = "collapse",
  } = options;

  if (typeof value !== "string" || value.length === 0) return "";

  let out = value.normalize("NFKC").replace(INVISIBLE, "");

  if (stripAccents) {
    out = out.normalize("NFD").replace(COMBINING_MARKS, "").normalize("NFC");
  }
  if (foldCase) out = out.toLowerCase();
  if (unifyAmpersand) out = out.replace(/&/g, " dan ");
  if (ignorePunctuation) out = out.replace(PUNCTUATION, " ");

  if (whitespace === "ignore") return out.replace(WHITESPACE, "");
  if (whitespace === "collapse") return out.replace(WHITESPACE, " ").trim();
  return out;
}

/**
 * The readable canonical form: lowercase, single-spaced, "dan" spelled out.
 *
 * Use this to show *why* two rows collided, and to compare a Unit Organisasi's
 * nama with its induk's.
 */
export function normalizeName(value: string | null | undefined): string {
  return foldName(value);
}

/**
 * The grouping key: `normalizeName()` with whitespace removed as well.
 *
 * Whitespace goes because "Sub Bagian" and "SubBagian" are the same Unit
 * Organisasi typed twice, and a key that kept the space would never say so.
 * Two names are "mirip" exactly when this is equal and non-empty.
 */
export function similarityKey(value: string | null | undefined): string {
  return foldName(value, { whitespace: "ignore" });
}

/** Do these two names fold onto the same key? A blank name is never similar. */
export function isSimilarName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const key = similarityKey(a);
  return key.length > 0 && key === similarityKey(b);
}

/**
 * Which differences explain a similar pair — the "kenapa" shown on a Temuan.
 *
 * A dimension is reported when switching **only that fold off** leaves the two
 * names unequal: that fold was load-bearing, so it names a real difference
 * between them. Several can be reported at once ("DIVISI-QHSSE" vs
 * "Divisi QHSSE" differs in both kapitalisasi and tanda baca).
 *
 * Returns `[]` in three cases the caller must tell apart itself, because this
 * function deliberately does not guess:
 *
 *   * the two names are **identical** — compare them if that matters;
 *   * the two names are **not similar at all** — ask `isSimilarName()`;
 *   * the two names are similar and spelled differently, but the difference is
 *     a mixture no single dimension owns ("Pratama III - 13" vs
 *     "Pratama III-13": spaces around a hyphen both names carry) or something
 *     invisible. The UI labels this "penulisan berbeda" rather than picking a
 *     dimension that would be half true.
 */
export function explainSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): NameDifference[] {
  if (!isSimilarName(a, b)) return [];

  const out: NameDifference[] = [];

  /** Fold everything except `disabled`, ignoring whitespace so it cannot leak in. */
  const differsWithout = (disabled: FoldOptions): boolean =>
    foldName(a, { ...disabled, whitespace: "ignore" }) !==
    foldName(b, { ...disabled, whitespace: "ignore" });

  if (differsWithout({ foldCase: false })) out.push("kapitalisasi");

  // Two separate whitespace questions, and both answer to "spasi":
  //
  //   * a word was split or joined ("Sub Bagian" / "SubBagian"). Visible when
  //     merely collapsing runs — instead of removing whitespace entirely —
  //     still leaves the two names apart.
  //   * a doubled or trailing space, which every other fold erases. Visible
  //     only with nothing folded at all: if collapsing runs *alone* makes the
  //     two equal, whitespace was the whole of the difference.
  //
  // Neither question is asked of a fold that inserts whitespace of its own
  // ("&" → " dan ", "-" → " "), which is why "A & B" / "A dan B" and
  // "Sub-Bagian" / "Sub Bagian" are NOT reported as spacing differences. A
  // page meant to be worked to zero cannot afford a badge that is usually
  // wrong; a pair that no dimension explains is labelled "penulisan berbeda"
  // instead.
  const spasiSaja: FoldOptions = {
    foldCase: false,
    stripAccents: false,
    unifyAmpersand: false,
    ignorePunctuation: false,
    whitespace: "collapse",
  };
  if (
    foldName(a) !== foldName(b) ||
    (a !== b && foldName(a, spasiSaja) === foldName(b, spasiSaja))
  ) {
    out.push("spasi");
  }

  if (differsWithout({ ignorePunctuation: false })) out.push("tanda_baca");
  if (differsWithout({ unifyAmpersand: false })) out.push("ampersand");
  if (differsWithout({ stripAccents: false })) out.push("aksen");

  return out;
}
