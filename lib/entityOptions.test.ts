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

import {
  toJabatanOptions,
  toLookupOptions,
  toOrgUnitOptions,
} from "./entityOptions";

const ROOT = path.resolve(import.meta.dirname, "..");

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
    const source = readFileSync(
      path.join(ROOT, "lib/entityOptions.ts"),
      "utf8",
    );
    expect(isClientModule(source)).toBe(false);
  });

  it("EntityPicker.tsx tetap modul client, dan tetap mengekspor ketiganya", () => {
    const source = readFileSync(
      path.join(ROOT, "components/shared/EntityPicker.tsx"),
      "utf8",
    );
    expect(isClientModule(source)).toBe(true);
    // Kontrak beku Wave 1: unit lain sudah mengimpor dari sini.
    for (const nama of [
      "toOrgUnitOptions",
      "toJabatanOptions",
      "toLookupOptions",
    ]) {
      expect(source).toContain(nama);
    }
  });

  it("tidak ada modul server yang memanggil mapper lewat EntityPicker", () => {
    // Memanggilnya dari server akan melempar di build produksi ("Attempted to
    // call toOrgUnitOptions() from the server"), dan hanya pada cabang kode
    // yang benar-benar punya data — jadi test, bukan review, yang menjaganya.
    const pelanggar: string[] = [];
    // `components/` is walked too: `StrukturClient.tsx` lives there and calls
    // `toOrgUnitOptions()`. It is a client module today, so it passes — but a
    // helper added next to it that is not would be the same crash again.
    const kandidat = [
      ...walk(path.join(ROOT, "app")),
      ...walk(path.join(ROOT, "lib")),
      ...walk(path.join(ROOT, "components")),
    ];
    for (const file of kandidat) {
      const source = readFileSync(file, "utf8");
      if (isClientModule(source)) continue;
      if (!/from\s+["']@\/components\/shared\/EntityPicker["']/.test(source))
        continue;
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

  it("nama jadi label, tingkatnya jadi keterangan", () => {
    const divisi = options.find((option) => option.id === ORG_UNIT_ID.divisi);
    const row = ORG_UNITS.find((unit) => unit.id === ORG_UNIT_ID.divisi);
    expect(divisi?.label).toBe(row?.nama);
    /*
      Kodenya IKUT di sini, dan itu justru buktinya bekerja: fixture memang
      memuat "Divisi Contoh" bersama "DIVISI CONTOH" — sepasang data kotor yang
      persis seperti yang datang dari Excel. Dua baris yang terlihat identik di
      sebuah picker berarti salah pilih menulis penempatan yang salah, jadi di
      baris seperti inilah kodenya harus tetap ada.

      Untuk nama yang benar-benar unik, keterangannya cuma tingkatnya — dijaga
      test "tanpa peta label" dan "memunculkan kode hanya pada baris yang
      namanya kembar" di bawah.
    */
    expect(divisi?.keterangan).toBe(`Divisi · ${row?.kode}`);
  });

  it("tanpa peta label, tipe mentah yang dipakai — bukan kosong", () => {
    const [option] = toOrgUnitOptions([
      { id: "x", kode: "KODE", nama: "Nama", tipe: "divisi", status: "aktif" },
    ]);
    expect(option.keterangan).toBe("divisi");
  });

  /**
   * INI ALASAN KODENYA TIDAK DIHAPUS BEGITU SAJA.
   *
   * Data seed masuk apa adanya (ADR-002), jadi dua Unit Organisasi bernama
   * sama betul-betul hidup berdampingan sampai ada yang me-Merge-nya. Di
   * sebuah picker, dua baris yang identik berarti salah pilih menulis
   * penempatan yang salah pada seseorang — bukan sekadar tampilan yang
   * membingungkan.
   */
  it("memunculkan kode hanya pada baris yang namanya kembar", () => {
    const hasil = toOrgUnitOptions(
      [
        {
          id: "a",
          kode: "OU-HC",
          nama: "Divisi Human Capital",
          tipe: "divisi",
          status: "aktif",
        },
        {
          id: "b",
          kode: "OU-HC-2",
          nama: "Divisi Human Capital",
          tipe: "divisi",
          status: "aktif",
        },
        {
          id: "c",
          kode: "OU-TEK",
          nama: "Divisi Teknik",
          tipe: "divisi",
          status: "aktif",
        },
      ],
      { divisi: "Divisi" },
    );
    expect(hasil[0].keterangan).toBe("Divisi · OU-HC");
    expect(hasil[1].keterangan).toBe("Divisi · OU-HC-2");
    // Yang namanya unik tetap bersih.
    expect(hasil[2].keterangan).toBe("Divisi");
  });

  it("nama yang hanya beda spasi atau huruf besar juga dihitung kembar", () => {
    // Justru pasangan seperti ini yang lahir dari Excel, dan mata tidak bisa
    // membedakannya di daftar pilih.
    const hasil = toOrgUnitOptions(
      [
        {
          id: "a",
          kode: "OU-Q",
          nama: "Divisi QHSSE",
          tipe: "divisi",
          status: "aktif",
        },
        {
          id: "b",
          kode: "OU-Q2",
          nama: "DIVISI  QHSSE ",
          tipe: "divisi",
          status: "aktif",
        },
      ],
      { divisi: "Divisi" },
    );
    expect(hasil[0].keterangan).toBe("Divisi · OU-Q");
    expect(hasil[1].keterangan).toBe("Divisi · OU-Q2");
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
      {
        id: "a",
        kode: "A",
        nama: "A",
        tipe: "bagian",
        status: "aktif",
        depth: 3,
      },
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

  it("tanpa nama kembar, keduanya tidak menampilkan kode sama sekali", () => {
    const [jabatan] = toJabatanOptions(JABATAN.slice(0, 1));
    const [lookup] = toLookupOptions(LOOKUPS.slice(0, 1));
    expect(jabatan.keterangan).toBeUndefined();
    expect(lookup.keterangan).toBeUndefined();
  });

  it("kode muncul lagi begitu ada label kembar", () => {
    const jabatan = toJabatanOptions([
      { id: "a", kode: "JBT-1", nama: "Manager", status: "aktif" },
      { id: "b", kode: "JBT-2", nama: "Manager", status: "aktif" },
      { id: "c", kode: "JBT-3", nama: "Officer", status: "aktif" },
    ]);
    expect(jabatan.map((o) => o.keterangan)).toEqual([
      "JBT-1",
      "JBT-2",
      undefined,
    ]);

    const lookup = toLookupOptions([
      { id: "a", kode: "L1", label: "Tetap", status: "aktif" },
      { id: "b", kode: "L2", label: "tetap", status: "aktif" },
    ]);
    expect(lookup.map((o) => o.keterangan)).toEqual(["L1", "L2"]);
  });

  it("daftar kosong menghasilkan daftar kosong, bukan lemparan", () => {
    expect(toJabatanOptions([])).toEqual([]);
    expect(toLookupOptions([])).toEqual([]);
  });
});
