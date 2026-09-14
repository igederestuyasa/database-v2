/**
 * scripts/check-select-columns.ts
 *
 * TypeScript does not look inside the string in
 *
 *     supabase.from("v_employees").select("personel_number, full_name")
 *                                          ^^^^^^^^^^^^^^^ typo
 *
 * so a misspelt column compiles cleanly and only fails against a real
 * database. With many people writing query strings against a schema they
 * cannot query, that is the most likely way to ship a broken page.
 *
 * This script walks every `.ts`/`.tsx` file under `lib/` and `app/`, finds each
 * `.from("<relation>") … .select("<columns>")` chain plus the column arguments
 * of the PostgREST filter/order helpers, and checks every name against
 * `lib/schema/columns.generated.ts` (which is generated from the real catalog).
 *
 * Runs as part of `npm test`.
 *
 * Escape hatch: put `hc-check-columns-ignore` in a comment on the line before
 * a call the checker gets wrong, and that call is skipped. Please also say why.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { RELATION_COLUMNS } from "../lib/schema/columns.generated";

// RELATION_COLUMNS is `as const`, so its keys are a literal union. Here we look
// up arbitrary strings scraped out of source files, hence the widened view.
const COLUMNS_BY_RELATION: Record<string, readonly string[] | undefined> =
  RELATION_COLUMNS;

const ROOT = path.resolve(import.meta.dirname, "..");
const SEARCH_DIRS = ["lib", "app", "components"];
const IGNORE_DIRS = new Set(["node_modules", ".next", "dist", "build"]);
const IGNORE_MARKER = "hc-check-columns-ignore";

// PostgREST helpers whose FIRST argument is a column name.
const COLUMN_ARG_METHODS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "order",
  "overlaps",
];

type Finding = {
  file: string;
  line: number;
  relation: string;
  column: string;
  suggestion?: string;
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function isIgnored(source: string, index: number): boolean {
  const line = lineOf(source, index);
  const lines = source.split("\n");
  // marker on this line or the line above
  for (const candidate of [lines[line - 1], lines[line - 2]]) {
    if (candidate && candidate.includes(IGNORE_MARKER)) return true;
  }
  return false;
}

/** Split a PostgREST select string on top-level commas (parens are nested). */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Reduce one select token to the base column name, or null when the token is
 * something this checker deliberately does not verify (wildcards, embedded
 * resources, aggregates, json paths, template interpolation).
 */
function baseColumn(token: string): string | null {
  let t = token.trim();
  if (!t || t === "*" || t.includes("${") || t.includes("(")) return null;
  // alias: `nama_unit:org_unit_nama`
  const colon = t.indexOf(":");
  if (colon !== -1) t = t.slice(colon + 1);
  // casts and json paths are not verified
  if (t.includes("::") || t.includes("->") || t.includes(".")) return null;
  t = t.replace(/!(inner|left)$/, "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return null;
  return t;
}

/**
 * Where the statement that started at `start` ends.
 *
 * A PostgREST chain belongs to exactly one `.from()`, so the window must close
 * at the end of the statement — not merely at the next `.from(`. Otherwise a
 * following `.rpc("x").select("…")`, which has no `.from()` of its own, gets
 * blamed on the previous relation and fails the build on correct code.
 *
 * Scans for the first `;` or newline-at-depth-zero outside any string or
 * comment, keeping the checker dependency-free (no TS parser).
 */
function endOfStatement(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  let i = start;

  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) return source.length;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) return source.length;
      i = close + 1;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) return i; // fell out of the enclosing call
    } else if (ch === ";" && depth <= 0) return i;
  }

  return source.length;
}

function nearest(column: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(column, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  return bestScore <= Math.max(2, Math.floor(column.length / 3))
    ? best
    : undefined;
}

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

function checkFile(file: string): Finding[] {
  const source = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  const findings: Finding[] = [];

  // `.from("relation")` followed, within the same chain, by `.select("…")`
  // and/or column-argument helpers.
  const fromRe = /\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;

  while ((m = fromRe.exec(source)) !== null) {
    const relation = m[1];
    const known = COLUMNS_BY_RELATION[relation];
    if (!known) continue; // not one of our relations (or a non-supabase .from)

    const chainStart = m.index + m[0].length;
    const chain = source.slice(chainStart, endOfStatement(source, chainStart));

    const record = (column: string, offsetInChain: number) => {
      if (known.includes(column)) return;
      const absolute = chainStart + offsetInChain;
      if (isIgnored(source, absolute)) return;
      findings.push({
        file: rel,
        line: lineOf(source, absolute),
        relation,
        column,
        suggestion: nearest(column, known),
      });
    };

    const selectRe = /\.select\(\s*(["'])([\s\S]*?)\1/g;
    let s: RegExpExecArray | null;
    while ((s = selectRe.exec(chain)) !== null) {
      for (const token of splitTopLevel(s[2])) {
        const column = baseColumn(token);
        if (column) record(column, s.index);
      }
    }

    const argRe = new RegExp(
      `\\.(${COLUMN_ARG_METHODS.join("|")})\\(\\s*(["'])([A-Za-z0-9_]+)\\2`,
      "g",
    );
    let a: RegExpExecArray | null;
    while ((a = argRe.exec(chain)) !== null) {
      record(a[3], a.index);
    }
  }

  return findings;
}

function main() {
  const files = SEARCH_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const findings = files.flatMap(checkFile);

  if (findings.length === 0) {
    console.log(
      `check:columns — OK (${files.length} berkas diperiksa terhadap ${Object.keys(RELATION_COLUMNS).length} relasi)`,
    );
    return;
  }

  console.error(
    `\ncheck:columns — ${findings.length} kolom tidak dikenal:\n`,
  );
  for (const f of findings) {
    const hint = f.suggestion ? `  (maksudnya "${f.suggestion}"?)` : "";
    console.error(
      `  ${f.file}:${f.line}  "${f.column}" tidak ada di ${f.relation}${hint}`,
    );
  }
  console.error(
    `\nKolom yang sah ada di lib/schema/columns.generated.ts (dihasilkan dari database).\n` +
      `Kalau pemeriksa ini salah, tambahkan komentar "${IGNORE_MARKER}" di baris sebelumnya beserta alasannya.\n`,
  );
  process.exit(1);
}

main();
