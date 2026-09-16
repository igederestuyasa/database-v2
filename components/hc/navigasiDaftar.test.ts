import { describe, expect, it } from "vitest";

import { indeksBerikutnya, type KotakItem } from "./navigasiDaftar";

/** Grid dua kolom, empat item: 0 1 / 2 3. */
const DUA_KOLOM: KotakItem[] = [
  { kiri: 0, atas: 0 },
  { kiri: 200, atas: 0 },
  { kiri: 0, atas: 100 },
  { kiri: 200, atas: 100 },
];

/** Satu kolom (tabel, atau grid di HP): 0 / 1 / 2. */
const SATU_KOLOM: KotakItem[] = [
  { kiri: 0, atas: 0 },
  { kiri: 0, atas: 48 },
  { kiri: 0, atas: 96 },
];

describe("indeksBerikutnya", () => {
  it("turun satu baris pada kolom yang sama, bukan ke tetangga kanan", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 0, "ArrowDown")).toBe(2);
    expect(indeksBerikutnya(DUA_KOLOM, 1, "ArrowDown")).toBe(3);
  });

  it("naik satu baris pada kolom yang sama", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 3, "ArrowUp")).toBe(1);
    expect(indeksBerikutnya(DUA_KOLOM, 2, "ArrowUp")).toBe(0);
  });

  it("bergerak mendatar mengikuti urutan visual", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 0, "ArrowRight")).toBe(1);
    expect(indeksBerikutnya(DUA_KOLOM, 1, "ArrowRight")).toBe(2);
    expect(indeksBerikutnya(DUA_KOLOM, 2, "ArrowLeft")).toBe(1);
  });

  it("berhenti di tepi, tidak berputar", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 0, "ArrowUp")).toBeNull();
    expect(indeksBerikutnya(DUA_KOLOM, 0, "ArrowLeft")).toBeNull();
    expect(indeksBerikutnya(DUA_KOLOM, 3, "ArrowDown")).toBeNull();
    expect(indeksBerikutnya(DUA_KOLOM, 3, "ArrowRight")).toBeNull();
  });

  it("di satu kolom, panah bawah dan kanan sama-sama maju satu", () => {
    expect(indeksBerikutnya(SATU_KOLOM, 0, "ArrowDown")).toBe(1);
    expect(indeksBerikutnya(SATU_KOLOM, 0, "ArrowRight")).toBe(1);
    expect(indeksBerikutnya(SATU_KOLOM, 2, "ArrowUp")).toBe(1);
  });

  it("Home dan End ke ujung urutan visual", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 2, "Home")).toBe(0);
    expect(indeksBerikutnya(DUA_KOLOM, 1, "End")).toBe(3);
  });

  it("masuk ke item pertama kalau belum ada yang fokus", () => {
    expect(indeksBerikutnya(DUA_KOLOM, -1, "ArrowDown")).toBe(0);
    expect(indeksBerikutnya(DUA_KOLOM, -1, "ArrowUp")).toBe(0);
  });

  it("membiarkan tombol lain lewat", () => {
    expect(indeksBerikutnya(DUA_KOLOM, 0, "Enter")).toBeNull();
    expect(indeksBerikutnya(DUA_KOLOM, 0, "a")).toBeNull();
    expect(indeksBerikutnya(DUA_KOLOM, 0, "Tab")).toBeNull();
  });

  it("tidak melakukan apa pun pada daftar kosong", () => {
    expect(indeksBerikutnya([], -1, "ArrowDown")).toBeNull();
    expect(indeksBerikutnya([], 0, "Home")).toBeNull();
  });

  it("menoleransi baris yang tingginya berbeda beberapa piksel", () => {
    // Kartu dengan deskripsi dua baris membuat tetangganya tidak persis sejajar.
    const miring: KotakItem[] = [
      { kiri: 0, atas: 0 },
      { kiri: 200, atas: 2 },
      { kiri: 0, atas: 120 },
    ];
    expect(indeksBerikutnya(miring, 0, "ArrowRight")).toBe(1);
    expect(indeksBerikutnya(miring, 1, "ArrowDown")).toBe(2);
  });

  it("mengurutkan baris dari koordinat, bukan dari urutan larik", () => {
    // Item yang ditulis terbalik di DOM tapi tampil di baris atas.
    const terbalik: KotakItem[] = [
      { kiri: 0, atas: 100 },
      { kiri: 0, atas: 0 },
    ];
    expect(indeksBerikutnya(terbalik, 1, "ArrowDown")).toBe(0);
    expect(indeksBerikutnya(terbalik, 0, "ArrowUp")).toBe(1);
    expect(indeksBerikutnya(terbalik, 0, "Home")).toBe(1);
  });
});
