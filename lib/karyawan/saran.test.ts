import { describe, expect, it } from "vitest";

import {
  MIN_HURUF_SARAN,
  catatanSaran,
  jawabanMasihRelevan,
  layakDicari,
  pesanKosongSaran,
} from "./saran";

describe("layakDicari", () => {
  it("menolak kata kunci yang lebih pendek dari ambangnya", () => {
    expect(layakDicari("")).toBe(false);
    expect(layakDicari("a")).toBe(false);
    expect(layakDicari("ap")).toBe(MIN_HURUF_SARAN <= 2);
  });

  it("spasi di ujung bukan kata kunci baru", () => {
    // Tanpa trim, "a " lolos ambang dua huruf dan memicu query yang percuma.
    expect(layakDicari("a ")).toBe(false);
    expect(layakDicari("   ")).toBe(false);
  });
});

describe("jawabanMasihRelevan", () => {
  it("memakai jawaban yang kata kuncinya masih yang di kolom", () => {
    expect(jawabanMasihRelevan("april", "april")).toBe(true);
    expect(jawabanMasihRelevan("april", "april ")).toBe(true);
  });

  /**
   * Jawaban lambat untuk kata kunci pendek yang tiba setelah kata kunci
   * panjang adalah cara paling gampang daftar saran menampilkan hasil yang
   * salah. Dibuang, bukan ditampilkan.
   */
  it("membuang jawaban yang kata kuncinya sudah berganti", () => {
    expect(jawabanMasihRelevan("ap", "aprilia")).toBe(false);
    expect(jawabanMasihRelevan("aprilia", "ap")).toBe(false);
  });
});

describe("catatanSaran", () => {
  it("diam kalau daftarnya memang sudah lengkap", () => {
    expect(catatanSaran(3, 3)).toBeNull();
    expect(catatanSaran(8, 8)).toBeNull();
    expect(catatanSaran(0, 0)).toBeNull();
  });

  it("mengatakan berapa yang tidak muat, dan apa yang bisa dilakukan", () => {
    const teks = catatanSaran(8, 41);
    expect(teks).toContain("8 dari 41");
    expect(teks).toMatch(/persempit/i);
  });
});

describe("pesanKosongSaran", () => {
  it("hanya muncul kalau benar-benar nol", () => {
    expect(pesanKosongSaran(0)).toMatch(/tidak ada/i);
    expect(pesanKosongSaran(1)).toBeNull();
  });
});
