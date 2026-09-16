/**
 * Template Excel tidak boleh berbohong.
 *
 * Dua arah yang dijaga di sini, dan dua-duanya pernah jadi bug di aplikasi
 * lain: template yang memuat kolom yang TIDAK dibaca kode (pengisi mengisinya
 * dengan rajin, datanya dibuang diam-diam), dan pemetaan yang punya tujuan
 * yang TIDAK diwakili template (kolomnya ada di kode, tapi tidak ada yang tahu
 * cara mengisinya).
 */
import { describe, expect, it } from "vitest";

import {
  HEADER_ROW,
  HEADER_TARGETS,
  buildHeaderPlan,
  canonicalHeader,
} from "./excelMapping";
import { TEMPLATE_KOLOM, buildTemplateRows, templateColWidths } from "./template";

const HEADERS = TEMPLATE_KOLOM.map((k) => k.header);

describe("template Impor", () => {
  it("setiap kolomnya dikenali pemetaan — tidak ada satu pun yang tidak dikenal", () => {
    const plan = buildHeaderPlan(HEADERS);
    expect(plan.unknown).toEqual([]);
    expect(plan.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("tidak ada dua kolom yang memetakan ke tujuan yang sama", () => {
    const plan = buildHeaderPlan(HEADERS);
    expect(plan.issues.filter((i) => i.kode === "kolom_ganda")).toEqual([]);
  });

  it("memuat kedua kolom wajib, jadi template kosong pun bisa diunggah", () => {
    const plan = buildHeaderPlan(HEADERS);
    expect(plan.issues.filter((i) => i.kode === "kolom_wajib_hilang")).toEqual([]);
  });

  /**
   * Arah sebaliknya: tiap tujuan yang bisa diisi dari Excel harus punya satu
   * kolom di template. Kalau sebuah kolom ditambahkan ke `HEADER_TARGETS` dan
   * template tidak ikut, test ini yang memberi tahu — bukan staf HC enam bulan
   * kemudian.
   */
  it("mewakili setiap tujuan yang ada di HEADER_TARGETS", () => {
    const plan = buildHeaderPlan(HEADERS);
    const diTemplate = new Set(
      plan.columns.map((c) =>
        c.target.kind === "lookup"
          ? `lookup:${c.target.tipe}`
          : c.target.kind === "org"
            ? `org:${c.target.level}`
            : c.target.kind === "text" || c.target.kind === "date"
              ? `${c.target.kind}:${c.target.field}`
              : c.target.kind === "private_text"
                ? `private_text:${c.target.field}`
                : c.target.kind,
      ),
    );

    const seharusnya = new Set(
      HEADER_TARGETS.map(([, target]) =>
        target.kind === "lookup"
          ? `lookup:${target.tipe}`
          : target.kind === "org"
            ? `org:${target.level}`
            : target.kind === "text" || target.kind === "date"
              ? `${target.kind}:${target.field}`
              : target.kind === "private_text"
                ? `private_text:${target.field}`
                : target.kind,
      ),
    );

    const hilang = [...seharusnya].filter((t) => !diTemplate.has(t)).sort();
    expect(hilang, `tujuan tanpa kolom di template: ${hilang.join(", ")}`).toEqual([]);
  });

  it("mewakili kedua slot kolom kembar, bukan cuma satu", () => {
    const plan = buildHeaderPlan(HEADERS);
    const fields = plan.columns.flatMap((c) =>
      c.target.kind === "text" ? [c.target.field] : [],
    );
    expect(fields).toContain("nomor_surat_pg");
    expect(fields).toContain("nomor_surat_jg");
    expect(fields).toContain("keterangan_rangkap_1");
    expect(fields).toContain("keterangan_rangkap_2");
  });

  it("header-nya persis di HEADER_ROW, jadi template yang diisi terbaca jalur biasa", () => {
    const rows = buildTemplateRows();
    expect(rows[HEADER_ROW - 1]).toEqual(HEADERS);
    // Baris contoh tepat di bawahnya.
    expect(rows[HEADER_ROW]).toHaveLength(HEADERS.length);
  });

  /**
   * Baris judul adalah satu-satunya tempat aturan berkas ini terbaca oleh
   * orang yang sedang mengisinya. Aturan Email Kantor masuk ke situ karena ia
   * satu-satunya yang bisa MEMBATALKAN seluruh unggahan — sebuah alamat kembar
   * menggagalkan 1.475 baris sekaligus, dan orang yang mengetiknya tidak
   * sedang membuka README.
   */
  it("baris judulnya menyebut aturan yang bisa membatalkan seluruh impor", () => {
    const judul = buildTemplateRows()
      .slice(0, HEADER_ROW - 1)
      .flat()
      .join(" ");

    expect(judul).toMatch(/Personnel Number/);
    expect(judul).toMatch(/Email Kantor/);
    expect(judul).toMatch(/satu alamat hanya boleh milik satu orang/i);
    // Sel kosong yang tidak menghapus adalah janji nomor 1 impor berulang.
    expect(judul).toMatch(/TIDAK menghapus/);
  });

  it("judulnya tidak pernah menggeser baris header", () => {
    // Baris judul keempat akan mendorong header keluar dari HEADER_ROW, dan
    // template itu tidak akan terbaca oleh jalur baca yang sama.
    const rows = buildTemplateRows();
    expect(rows.slice(0, HEADER_ROW - 1)).toHaveLength(HEADER_ROW - 1);
    expect(rows[HEADER_ROW - 1][0]).toBe(TEMPLATE_KOLOM[0].header);
  });

  it("tidak ada header yang kembar setelah dinormalkan", () => {
    const canonical = HEADERS.map(canonicalHeader);
    expect(new Set(canonical).size).toBe(canonical.length);
  });

  it("lebar kolom sebanyak kolomnya", () => {
    expect(templateColWidths()).toHaveLength(TEMPLATE_KOLOM.length);
  });
});
