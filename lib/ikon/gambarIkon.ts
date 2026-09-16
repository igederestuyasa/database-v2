/**
 * Aturan menggambar ikon generatif — docs/DESIGN.md §Ikon generatif,
 * bagian "Aturan render".
 *
 * Dipisahkan dari `GenerativeIcon.tsx` supaya bisa diuji. Seluruh isi berkas
 * ini aritmetika murni: sudut sel, jalur tiap bentuk, sudut putar, dan tunda
 * animasinya. Yang tersisa di komponen hanyalah menempelkan hasilnya ke elemen
 * SVG — jadi kalau sebuah koordinat salah, `gambarIkon.test.ts` yang gagal,
 * bukan mata seseorang enam bulan kemudian.
 *
 * `rancangIkon.ts` memutuskan bentuk APA di sel mana; berkas ini memutuskan
 * bentuk itu digambar DI MANA. Keduanya sengaja terpisah.
 */
import type { Bentuk, SelIkon } from "./rancangIkon";

/** Kisi 2×2 di dalam viewBox 48×48: sisi sel 15, tepi 9. */
export const SISI = 15;
export const SETENGAH_SISI = SISI / 2;

/** Elemen SVG yang perlu digambar untuk satu bentuk. */
export type GambarBentuk =
  | { elemen: "rect"; x: number; y: number; width: number; height: number }
  | { elemen: "circle"; cx: number; cy: number; r: number }
  | { elemen: "path"; d: string };

/** Sudut kiri atas sel ke-i: x = 9 + (i % 2) × 15, y = 9 + floor(i / 2) × 15. */
export function sudutSel(i: number): { x: number; y: number } {
  return { x: 9 + (i % 2) * SISI, y: 9 + Math.floor(i / 2) * SISI };
}

/** Titik pusat sel ke-i — poros putaran dan pusat lingkaran. */
export function pusatSel(i: number): { x: number; y: number } {
  const { x, y } = sudutSel(i);
  return { x: x + SETENGAH_SISI, y: y + SETENGAH_SISI };
}

/**
 * Bentuk apa adanya di sel ke-i, sebelum diputar.
 *
 * `kosong` sudah disaring `rancangIkon()` sebelum sampai ke sini, jadi ia
 * memang tidak punya gambar — `null` adalah jawabannya, bukan kelalaian.
 */
export function gambarBentuk(jenis: Bentuk, i: number): GambarBentuk | null {
  const { x, y } = sudutSel(i);

  switch (jenis) {
    case "kotak":
      return { elemen: "rect", x, y, width: SISI, height: SISI };
    case "bulat": {
      const pusat = pusatSel(i);
      return { elemen: "circle", cx: pusat.x, cy: pusat.y, r: SETENGAH_SISI };
    }
    case "seperempat":
      return {
        elemen: "path",
        d: `M ${x} ${y} H ${x + SISI} A ${SISI} ${SISI} 0 0 1 ${x} ${y + SISI} Z`,
      };
    case "setengah":
      return {
        elemen: "path",
        d: `M ${x} ${y} H ${x + SISI} A ${SETENGAH_SISI} ${SETENGAH_SISI} 0 0 1 ${x} ${y} Z`,
      };
    case "segitiga":
      return { elemen: "path", d: `M ${x} ${y} H ${x + SISI} L ${x} ${y + SISI} Z` };
    case "kosong":
      return null;
  }
}

/** Atribut `transform` pembungkus sel: berputar pada pusat selnya sendiri. */
export function putaranSel(sel: Pick<SelIkon, "i" | "putar">): string {
  const pusat = pusatSel(sel.i);
  return `rotate(${sel.putar}, ${pusat.x}, ${pusat.y})`;
}

/**
 * Tunda animasi satu bentuk: 260ms, ditambah 40ms per item (maksimal 16 item)
 * dan 55ms per bentuk.
 */
export function tundaBentuk(urutan: number, keBerapa: number): string {
  return `${260 + Math.min(Math.max(urutan, 0), 15) * 40 + keBerapa * 55}ms`;
}
