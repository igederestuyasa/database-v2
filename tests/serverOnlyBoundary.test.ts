import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Modul sisi server tidak pernah ditarik ke bundle browser.
 *
 * Next hanya meng-inline `NEXT_PUBLIC_*`, jadi `SUPABASE_SERVICE_ROLE_KEY`
 * memang tidak bisa bocor lewat import yang keliru — tapi kegagalannya baru
 * terlihat di runtime browser sebagai "belum diisi", bukan di build. Paket
 * `server-only` yang biasa dipakai untuk ini tidak ada di `package.json`, dan
 * ADR-005 §1 melarang menambah dependency. Test ini adalah penggantinya:
 * setiap file ber-`"use client"` dipindai, dan import **nilai** (bukan `import
 * type`) dari modul di bawah menggagalkan `npm test`.
 *
 * Yang dijaga:
 *   * `lib/supabase/admin`   — service role, menembus RLS (CLAUDE.md).
 *   * `lib/supabase/server`  — client cookie-session; `next/headers` sudah
 *                              menolaknya saat build, ini lapis keduanya.
 *   * `lib/db/**`            — lapisan baca; hanya untuk Server Component,
 *                              Server Action, dan script.
 *   * `lib/actions/_guard`   — `requireUser()` dkk. Tipe dan `ActionResult`
 *                              boleh (`import type`), fungsinya tidak.
 *   * `lib/revisions/seedBatch` — mengimpor `pg`, script saja.
 */
const ROOT = path.resolve(import.meta.dirname, "..");

const SCANNED_DIRS = ["app", "components"];
const IGNORE_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

const FORBIDDEN: ReadonlyArray<{ test: (specifier: string) => boolean; why: string }> = [
  {
    test: (s) => s === "@/lib/supabase/admin",
    why: "service-role client hanya untuk app/api/v1/** dan scripts/**",
  },
  {
    test: (s) => s === "@/lib/supabase/server",
    why: "client cookie-session hanya untuk Server Component dan Server Action",
  },
  {
    test: (s) => s === "@/lib/db" || s.startsWith("@/lib/db/"),
    why: "lapisan baca lib/db/** tidak boleh masuk bundle browser",
  },
  {
    test: (s) => s === "@/lib/actions/_guard",
    why: "requireUser()/requireAdmin() adalah kode server; pakai `import type` untuk tipenya",
  },
  {
    test: (s) => s === "@/lib/revisions/seedBatch",
    why: "seedBatch mengimpor `pg` dan hanya boleh dipakai scripts/**",
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
    else if (/\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** `"use client"` harus jadi statement pertama; komentar di atasnya boleh. */
function isClientModule(source: string): boolean {
  return /^\s*["']use client["']\s*;?/.test(stripComments(source));
}

type ValueImport = { specifier: string; line: number };

/**
 * Setiap `import … from "x"` yang membawa NILAI. `import type { … }` dan
 * `import { type A, type B }` diabaikan — keduanya hilang saat compile.
 */
function valueImports(source: string): ValueImport[] {
  const stripped = stripComments(source);
  const out: ValueImport[] = [];
  const pattern =
    /import\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of stripped.matchAll(pattern)) {
    const [, typeKeyword, clause, specifier] = match;
    if (typeKeyword) continue;
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces && !clause.replace(braces[0], "").replace(/[,\s]/g, "")) {
      const names = braces[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every((name) => name.startsWith("type "))) continue;
    }
    out.push({
      specifier,
      line: stripped.slice(0, match.index).split("\n").length,
    });
  }
  return out;
}

describe("batas server/client — modul server tidak diimpor Client Component", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  const clientFiles = files.filter((file) => isClientModule(readFileSync(file, "utf8")));

  it("menemukan Client Component untuk dipindai (kalau nol, pemindainya yang rusak)", () => {
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it("tidak satu pun Client Component mengimpor nilai dari modul server", () => {
    const violations: string[] = [];
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf8");
      for (const { specifier, line } of valueImports(source)) {
        const rule = FORBIDDEN.find((candidate) => candidate.test(specifier));
        if (!rule) continue;
        violations.push(
          `${path.relative(ROOT, file)}:${line} mengimpor "${specifier}" — ${rule.why}`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("mengenali import type sebagai aman dan import nilai sebagai bukan", () => {
    const aman = [
      'import type { ActionResult } from "@/lib/actions/_guard";',
      'import { type ActionResult, type ActionErrorCode } from "@/lib/actions/_guard";',
    ].join("\n");
    expect(valueImports(aman)).toEqual([]);

    const tidak = 'import { requireUser, type GuardContext } from "@/lib/actions/_guard";';
    expect(valueImports(tidak)).toEqual([
      { specifier: "@/lib/actions/_guard", line: 1 },
    ]);
  });

  it("hanya menganggap file ber-\"use client\" sebagai Client Component", () => {
    expect(isClientModule('/** komentar */\n"use client";\nimport x from "y";')).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";')).toBe(false);
    expect(isClientModule('"use server";\nexport async function a() {}')).toBe(false);
  });
});
