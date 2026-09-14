/**
 * The row → option mappers, and the boundary rule that decides where they live.
 *
 * The mappers themselves are three small pure functions; what is worth pinning
 * is the rule around them. They were defined inside `EntityPicker.tsx`, a
 * `"use client"` module, while their own doc comment invited Server Components
 * to call them. A production build turns a client module's exports into
 * references that throw when the server calls them, so `/bereskan` crashed —
 * but only once it had a Temuan, because that is the only branch that builds
 * Merge candidates. Dev builds and an empty database both looked fine.
 *
 * Six units are about to write pages that need these mappers on the server, so
 * the rule is asserted here rather than left in a comment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { JABATAN, LOOKUPS, ORG_UNITS, ORG_UNIT_ID } from "@/fixtures";
import { ORG_UNIT_TYPE_LABELS } from "@/lib/i18n/terms";

import { toJabatanOptions, toLookupOptions, toOrgUnitOptions } from "./entityOptions";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isClientModule = (source: string) =>
  /^\s*(["'])use client\1/.test(source.replace(/^﻿/, ""));

describe("batas server/client", () => {
  it("entityOptions.ts tidak boleh menjadi modul client", () => {
    const source = readFileSync(path.join(ROOT, "components/shared/entityOptions.ts"), "utf8");
    expect(isClientModule(source)).toBe(false);
  });

  it("EntityPicker.tsx tetap modul client, dan tetap mengekspor ketiganya", () => {
    const source = readFileSync(
      path.join(ROOT, "components/shared/EntityPicker.tsx"),
      "utf8",
    );
    expect(isClientModule(source)).toBe(true);
    // Kontrak beku Wave 1: unit lain sudah mengimpor dari sini.
    for (const nama of ["toOrgUnitOptions", "toJabatanOptions", "toLookupOptions"]) {
      expect(source).toContain(nama);
    }
  });

  it("tidak ada modul server yang memanggil mapper lewat EntityPicker", () => {
    // Memanggilnya dari server akan melempar di build produksi ("Attempted to
    // call toOrgUnitOptions() from the server"), dan hanya pada cabang kode
    // yang benar-benar punya data — jadi test, bukan review, yang menjaganya.
    const pelanggar: string[] = [];
    for (const file of [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))]) {
      const source = readFileSync(file, "utf8");
      if (isClientModule(source)) continue;
      if (!/from\s+["']@\/components\/shared\/EntityPicker["']/.test(source)) continue;
      // Mengimpor tipe saja tidak apa-apa; memanggil fungsinya yang masalah.
      if (/\bto(OrgUnit|Jabatan|Lookup)Options\b/.test(source)) {
        pelanggar.push(path.relative(ROOT, file));
      }
    }
    expect(pelanggar).toEqual([]);
  });
});

describe("toOrgUnitOptions", () => {
  const options = toOrgUnitOptions(ORG_UNITS, ORG_UNIT_TYPE_LABELS);

  it("memetakan setiap baris, tanpa membuang satu pun", () => {
    expect(options).toHaveLength(ORG_UNITS.length);
  });

  it("menampilkan nama sebagai label dan kode + tipe sebagai keterangan", () => {
    const divisi = options.find((option) => option.id === ORG_UNIT_ID.divisi);
    const row = ORG_UNITS.find((unit) => unit.id === ORG_UNIT_ID.divisi);
    expect(divisi?.label).toBe(row?.nama);
    expect(divisi?.keterangan).toBe(`${row?.kode} · Divisi`);
  });

  it("tanpa peta label, tipe mentah yang dipakai — bukan kosong", () => {
    const [option] = toOrgUnitOptions([
      { id: "x", kode: "KODE", nama: "Nama", tipe: "divisi", status: "aktif" },
    ]);
    expect(option.keterangan).toBe("KODE · divisi");
  });

  it("status apa pun selain nonaktif dibaca sebagai aktif", () => {
    const [aktif, nonaktif] = toOrgUnitOptions([
      { id: "a", kode: "A", nama: "A", tipe: "divisi", status: "entah" },
      { id: "b", kode: "B", nama: "B", tipe: "divisi", status: "nonaktif" },
    ]);
    expect(aktif.status).toBe("aktif");
    expect(nonaktif.status).toBe("nonaktif");
  });

  it("meneruskan depth supaya pohon yang diratakan tetap terbaca", () => {
    const [option] = toOrgUnitOptions([
      { id: "a", kode: "A", nama: "A", tipe: "bagian", status: "aktif", depth: 3 },
    ]);
    expect(option.depth).toBe(3);
  });
});

describe("toJabatanOptions & toLookupOptions", () => {
  it("Jabatan memakai nama, Lookup memakai label (CONTEXT.md)", () => {
    const [jabatan] = toJabatanOptions(JABATAN.slice(0, 1));
    const [lookup] = toLookupOptions(LOOKUPS.slice(0, 1));
    expect(jabatan.label).toBe(JABATAN[0].nama);
    expect(lookup.label).toBe(LOOKUPS[0].label);
  });

  it("keduanya menaruh kode di keterangan", () => {
    const [jabatan] = toJabatanOptions(JABATAN.slice(0, 1));
    const [lookup] = toLookupOptions(LOOKUPS.slice(0, 1));
    expect(jabatan.keterangan).toBe(JABATAN[0].kode);
    expect(lookup.keterangan).toBe(LOOKUPS[0].kode);
  });

  it("daftar kosong menghasilkan daftar kosong, bukan lemparan", () => {
    expect(toJabatanOptions([])).toEqual([]);
    expect(toLookupOptions([])).toEqual([]);
  });
});
