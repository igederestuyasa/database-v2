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

/**
 * Arah sebaliknya: komponen `lucide-react` tidak boleh menyeberang dari Server
 * Component ke Client Component.
 *
 * `lucide-react` tidak membawa `"use client"`, jadi di sebuah Server Component
 * ikonnya adalah fungsi biasa. Me-RENDER-nya di sana (`<Users />`) benar dan
 * biasa. Yang tidak boleh menyerahkannya sebagai NILAI — `ikon: Users`,
 * `icon={Users}` — karena begitu nilai itu jadi prop sebuah Client Component,
 * React menolaknya: "Functions cannot be passed directly to Client
 * Components".
 *
 * Kegagalannya mahal dan tidak kelihatan dari mana-mana: `npm run lint`,
 * `npm run typecheck`, dan `npm run build` semuanya hijau, lalu SETIAP halaman
 * di bawah layout yang melakukannya berubah jadi halaman error saat dibuka —
 * persis yang terjadi ketika `app/(app)/layout.tsx` menaruh komponen ikon di
 * `NAV_ITEMS`. Karena itu aturannya sesempit mungkin tapi dijaga di sini:
 * di Server Component, nama yang diimpor dari `lucide-react` hanya boleh
 * muncul sebagai tag JSX. Kalau sebuah tujuan perlu ikon, seberangkan NAMA-nya
 * dan petakan ke komponennya di dalam modul klien (lihat `SidebarNav`).
 */
describe("batas server/client — ikon lucide tidak diserahkan sebagai nilai", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  const serverFiles = files.filter(
    (file) => !isClientModule(readFileSync(file, "utf8")),
  );

  /** Nama yang diimpor sebagai nilai dari `lucide-react`, tanpa `import type`. */
  function lucideValueNames(source: string): string[] {
    const stripped = stripComments(source);
    const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
    const out: string[] = [];
    for (const [, typeKeyword, clause] of stripped.matchAll(pattern)) {
      if (typeKeyword) continue;
      for (const raw of clause.split(",")) {
        const name = raw.trim();
        if (!name || name.startsWith("type ")) continue;
        out.push((name.split(/\s+as\s+/).pop() ?? name).trim());
      }
    }
    return out;
  }

  /** Kemunculan `nama` yang BUKAN `<nama` atau `</nama`, di luar baris import. */
  function pemakaianBukanTag(source: string, nama: string): number[] {
    const stripped = stripComments(source).replace(
      /import\s+(?:type\s+)?\{[^}]*\}\s*from\s*["']lucide-react["']\s*;?/g,
      "",
    );
    const baris: number[] = [];
    for (const match of stripped.matchAll(new RegExp(`\\b${nama}\\b`, "g"))) {
      const sebelum = stripped.slice(0, match.index);
      if (/<\/?\s*$/.test(sebelum)) continue;
      baris.push(sebelum.split("\n").length);
    }
    return baris;
  }

  it("menemukan Server Component untuk dipindai (kalau nol, pemindainya yang rusak)", () => {
    expect(serverFiles.length).toBeGreaterThan(10);
  });

  it("tidak satu pun Server Component memakai ikon lucide selain sebagai tag JSX", () => {
    const violations: string[] = [];
    for (const file of serverFiles) {
      const source = readFileSync(file, "utf8");
      for (const nama of lucideValueNames(source)) {
        for (const line of pemakaianBukanTag(source, nama)) {
          violations.push(
            `${path.relative(ROOT, file)}:${line} menyerahkan \`${nama}\` sebagai nilai — ` +
              "seberangkan nama ikonnya, bukan komponennya",
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("membedakan render dari penyerahan nilai", () => {
    const render = 'import { Users } from "lucide-react";\nconst a = <Users className="h-4" />;';
    expect(lucideValueNames(render)).toEqual(["Users"]);
    expect(pemakaianBukanTag(render, "Users")).toEqual([]);

    const serah = 'import { Users } from "lucide-react";\nconst a = { ikon: Users };';
    expect(pemakaianBukanTag(serah, "Users")).toEqual([2]);

    const tipeSaja = 'import type { LucideIcon } from "lucide-react";';
    expect(lucideValueNames(tipeSaja)).toEqual([]);
  });
});
