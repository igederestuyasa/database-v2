import { describe, expect, it } from "vitest";

import { rancangIkon } from "./rancangIkon";

/**
 * Penjaga kesepakatan lintas app.
 *
 * `rancangIkon()` bukan fungsi tampilan biasa: docs/DESIGN.md menjanjikan satu
 * nama menghasilkan ikon yang SAMA di HC Core dan di setiap app HC lainnya.
 * Tidak ada yang bisa menangkap pelanggarannya dari layar — dua ikon berbeda
 * sama-sama terlihat masuk akal. Jadi nilai di bawah dipatok apa adanya: kalau
 * ada yang menyentuh isi fungsi itu, test inilah yang berteriak, bukan pengguna
 * enam bulan kemudian.
 *
 * Kalau test ini gagal setelah sebuah perubahan, yang salah hampir pasti
 * perubahannya — bukan angka di sini.
 */
describe("rancangIkon", () => {
  it("memberi hasil yang persis sama untuk nama yang sama", () => {
    expect(rancangIkon("Karyawan")).toEqual(rancangIkon("Karyawan"));
  });

  it("mematok rancangan beberapa nama yang sudah disepakati", () => {
    expect(rancangIkon("Karyawan")).toEqual({
      gelap: false,
      sel: [
        { jenis: "segitiga", i: 0, putar: 180, aksen: false },
        { jenis: "kotak", i: 1, putar: 180, aksen: false },
        { jenis: "bulat", i: 2, putar: 180, aksen: false },
        { jenis: "seperempat", i: 3, putar: 90, aksen: false },
      ],
    });

    expect(rancangIkon("Divisi QHSSE")).toEqual({
      gelap: false,
      sel: [
        { jenis: "segitiga", i: 0, putar: 180, aksen: false },
        { jenis: "segitiga", i: 1, putar: 0, aksen: false },
        { jenis: "kotak", i: 2, putar: 180, aksen: false },
        { jenis: "segitiga", i: 3, putar: 0, aksen: false },
      ],
    });

    // Satu contoh bersel aksen, satu contoh berlatar gelap, dan satu contoh
    // yang selnya tidak penuh — supaya ketiga cabang itu ikut terpatok.
    expect(rancangIkon("Manager")).toEqual({
      gelap: false,
      sel: [
        { jenis: "segitiga", i: 0, putar: 90, aksen: false },
        { jenis: "segitiga", i: 1, putar: 90, aksen: true },
        { jenis: "setengah", i: 2, putar: 90, aksen: false },
        { jenis: "kotak", i: 3, putar: 0, aksen: false },
      ],
    });

    expect(rancangIkon("Café")).toEqual({
      gelap: true,
      sel: [
        { jenis: "kotak", i: 1, putar: 180, aksen: false },
        { jenis: "bulat", i: 2, putar: 0, aksen: false },
        { jenis: "bulat", i: 3, putar: 270, aksen: false },
      ],
    });
  });

  it("mengabaikan huruf besar-kecil dan aksen", () => {
    const dasar = rancangIkon("cafe");
    expect(rancangIkon("Café")).toEqual(dasar);
    expect(rancangIkon("CAFE")).toEqual(dasar);
    expect(rancangIkon("CAFÉ")).toEqual(dasar);
  });

  it("membedakan nama yang berbeda", () => {
    expect(rancangIkon("Karyawan")).not.toEqual(rancangIkon("Jabatan"));
  });

  it("selalu menggambar tiga atau empat sel, tidak pernah kurang", () => {
    for (let n = 0; n < 500; n += 1) {
      const { sel } = rancangIkon(`nama-${n}`);
      expect(sel.length).toBeGreaterThanOrEqual(3);
      expect(sel.length).toBeLessThanOrEqual(4);
    }
  });

  it("menempatkan sel di kisi 2×2 dengan putaran kelipatan 90°, dan paling banyak satu aksen", () => {
    for (let n = 0; n < 500; n += 1) {
      const { sel } = rancangIkon(`unit ${n}`);
      const posisi = sel.map((s) => s.i);

      expect(new Set(posisi).size).toBe(posisi.length);
      for (const satu of sel) {
        expect(satu.i).toBeGreaterThanOrEqual(0);
        expect(satu.i).toBeLessThanOrEqual(3);
        expect([0, 90, 180, 270]).toContain(satu.putar);
        expect(satu.jenis).not.toBe("kosong");
      }
      expect(sel.filter((s) => s.aksen).length).toBeLessThanOrEqual(1);
    }
  });

  it("menerima nama kosong tanpa melempar", () => {
    expect(() => rancangIkon("")).not.toThrow();
    expect(rancangIkon("").sel.length).toBeGreaterThanOrEqual(3);
  });
});
