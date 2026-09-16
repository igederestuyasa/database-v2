import { describe, expect, it } from "vitest";

import { gambarBentuk, pusatSel, putaranSel, sudutSel, tundaBentuk } from "./gambarIkon";
import { rancangIkon } from "./rancangIkon";

/**
 * Geometri ikon generatif, dipatok terhadap docs/DESIGN.md §Ikon generatif.
 *
 * Sama seperti `rancangIkon.test.ts`: ikon yang koordinatnya meleset tetap
 * terlihat "seperti ikon", jadi tidak ada yang akan melaporkannya. Angka di
 * bawah disalin dari spesifikasi, bukan dari keluaran kode.
 */
describe("sudutSel", () => {
  it("menata empat sel sebagai kisi 2×2 bersisi 15 dengan tepi 9", () => {
    expect(sudutSel(0)).toEqual({ x: 9, y: 9 });
    expect(sudutSel(1)).toEqual({ x: 24, y: 9 });
    expect(sudutSel(2)).toEqual({ x: 9, y: 24 });
    expect(sudutSel(3)).toEqual({ x: 24, y: 24 });
  });

  it("menaruh pusat sel tepat di tengahnya", () => {
    expect(pusatSel(0)).toEqual({ x: 16.5, y: 16.5 });
    expect(pusatSel(3)).toEqual({ x: 31.5, y: 31.5 });
  });

  it("tidak pernah keluar dari viewBox 48×48", () => {
    for (let i = 0; i < 4; i += 1) {
      const { x, y } = sudutSel(i);
      expect(x + 15).toBeLessThanOrEqual(48);
      expect(y + 15).toBeLessThanOrEqual(48);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("gambarBentuk", () => {
  it("menggambar kotak sebagai persegi sepenuh sel", () => {
    expect(gambarBentuk("kotak", 0)).toEqual({
      elemen: "rect",
      x: 9,
      y: 9,
      width: 15,
      height: 15,
    });
  });

  it("menggambar bulat sebagai lingkaran ber-r 7,5 di pusat sel", () => {
    expect(gambarBentuk("bulat", 3)).toEqual({
      elemen: "circle",
      cx: 31.5,
      cy: 31.5,
      r: 7.5,
    });
  });

  it("memakai jalur persis seperti di spesifikasi", () => {
    expect(gambarBentuk("seperempat", 0)).toEqual({
      elemen: "path",
      d: "M 9 9 H 24 A 15 15 0 0 1 9 24 Z",
    });
    expect(gambarBentuk("setengah", 0)).toEqual({
      elemen: "path",
      d: "M 9 9 H 24 A 7.5 7.5 0 0 1 9 9 Z",
    });
    expect(gambarBentuk("segitiga", 0)).toEqual({
      elemen: "path",
      d: "M 9 9 H 24 L 9 24 Z",
    });
  });

  it("menggeser jalur mengikuti sel", () => {
    expect(gambarBentuk("segitiga", 3)).toEqual({
      elemen: "path",
      d: "M 24 24 H 39 L 24 39 Z",
    });
  });

  it("tidak menggambar apa pun untuk sel kosong", () => {
    expect(gambarBentuk("kosong", 0)).toBeNull();
  });

  it("punya gambar untuk setiap bentuk yang bisa keluar dari rancangIkon", () => {
    for (let n = 0; n < 300; n += 1) {
      for (const sel of rancangIkon(`entitas ${n}`).sel) {
        expect(gambarBentuk(sel.jenis, sel.i)).not.toBeNull();
      }
    }
  });
});

describe("putaranSel", () => {
  it("memutar pada pusat sel, bukan pusat ikon", () => {
    expect(putaranSel({ i: 0, putar: 90 })).toBe("rotate(90, 16.5, 16.5)");
    expect(putaranSel({ i: 3, putar: 270 })).toBe("rotate(270, 31.5, 31.5)");
  });
});

describe("tundaBentuk", () => {
  it("mulai 260ms, lalu 40ms per item dan 55ms per bentuk", () => {
    expect(tundaBentuk(0, 0)).toBe("260ms");
    expect(tundaBentuk(0, 1)).toBe("315ms");
    expect(tundaBentuk(1, 0)).toBe("300ms");
    expect(tundaBentuk(2, 3)).toBe("505ms");
  });

  it("berhenti menambah setelah item ke-16, supaya daftar panjang tidak menunggu", () => {
    expect(tundaBentuk(15, 0)).toBe("860ms");
    expect(tundaBentuk(16, 0)).toBe("860ms");
    expect(tundaBentuk(500, 0)).toBe("860ms");
  });
});
