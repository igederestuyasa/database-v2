import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nobody opens a Batch from TypeScript. (ADR-006)
 *
 * `begin_batch()` sets `app.batch_id` transaction-locally, and supabase-js
 * sends every call as its own PostgREST request — so a Batch opened from an
 * action is already gone when the write arrives, and sits in the Log Perubahan
 * containing nothing. Batches are created in exactly two places now:
 *
 *   * the `log_revision` trigger, for an ordinary one-statement action;
 *   * the RPC functions in `supabase/migrations/0002_batch_operations.sql`,
 *     which run the whole multi-row action in one transaction.
 *
 * `scripts/verify-schema.sql` §19 proves the database half (one statement →
 * exactly one Batch, and no empty Batch anywhere). It cannot see TypeScript,
 * which is what this test is for: thirteen units are writing Server Actions in
 * parallel against a CLAUDE.md that used to say "dibungkus `withBatch()`".
 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** Directories whose TypeScript must never open a Batch. */
const SCANNED_DIRS = ["lib", "app", "components", "scripts"];

const IGNORE_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

/**
 * The one legitimate caller: a one-shot script that owns its connection and
 * opens a real transaction around the whole Seed, so the batch id genuinely
 * survives every insert (ADR-006).
 */
const ALLOWED = new Set([path.join("lib", "revisions", "seedBatch.ts")]);

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bwithBatch\s*\(/,
    why: "withBatch() was removed — write one statement directly and let the log_revision trigger make the Batch",
  },
  {
    pattern: /\b(beginBatch|endBatch)\s*\(/,
    why: "beginBatch()/endBatch() were removed along with withBatch()",
  },
  {
    pattern: /["'`](begin_batch|end_batch)["'`]/,
    why: "calling the begin_batch/end_batch RPC from the app opens a Batch that will be empty",
  },
];

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
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments, so the prose explaining why `withBatch()` is gone does not
 * itself trip the check. Crude but sufficient: this is TypeScript source, and
 * the only false positive that matters would be a `//` or `/* *​/` sequence
 * inside a string literal, which none of these patterns live in.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("ADR-006 — tidak ada Batch yang dibuka dari TypeScript", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

  it("menemukan berkas untuk diperiksa", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("tidak ada kode yang memanggil withBatch/beginBatch/endBatch atau RPC begin_batch", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (ALLOWED.has(relative)) continue;

      const code = stripComments(readFileSync(file, "utf8"));
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(code)) offenders.push(`${relative}: ${why}`);
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("lib/revisions/batch.ts tidak lagi mengekspor withBatch", () => {
    const source = readFileSync(
      path.join(ROOT, "lib", "revisions", "batch.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+withBatch\b/);
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+beginBatch\b/);
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+endBatch\b/);
    // The helper that is still useful: the keterangan handed to a merge or
    // revert RPC.
    expect(source).toMatch(/export function batchKeterangan\b/);
  });

  it("seed tetap boleh membuka Batch — ia memegang transaksinya sendiri", () => {
    const source = readFileSync(
      path.join(ROOT, "lib", "revisions", "seedBatch.ts"),
      "utf8",
    );
    expect(source).toContain("begin_batch");
    expect(source).toMatch(/client\.query\(["']begin["']\)/);
    expect(source).toMatch(/client\.query\(["']commit["']\)/);
  });
});
