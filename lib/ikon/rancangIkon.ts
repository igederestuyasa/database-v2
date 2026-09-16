/**
 * Ikon generatif HC Panel — docs/DESIGN.md §Ikon generatif.
 *
 * SATU NAMA SELALU MENGHASILKAN IKON YANG SAMA DI SEMUA APP HC. Itu satu-satunya
 * alasan berkas ini ada dan satu-satunya aturan yang mengikatnya: fungsi di bawah
 * disalin PERSIS dari docs/DESIGN.md, sampai ke urutan pemanggilan `acak()`.
 * Jangan "merapikan" apa pun di dalamnya — menukar dua baris saja sudah cukup
 * untuk membuat "Divisi QHSSE" bergambar lain di HC Core daripada di app HC
 * sebelahnya, dan tidak ada satu pun test di app lain yang akan menangkapnya.
 * `rancangIkon.test.ts` mematok beberapa nama sebagai penjaganya.
 *
 * Murni: tanpa React, tanpa DOM, tanpa import. Aturan menggambarnya ada di
 * `components/hc/GenerativeIcon.tsx`; berkas ini hanya memutuskan bentuk apa,
 * di sel mana, diputar berapa.
 */
const BENTUK = ["kotak", "bulat", "seperempat", "setengah", "segitiga", "kosong"] as const;
type Bentuk = (typeof BENTUK)[number];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function hash(teks: string) {
  let h = 2166136261;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pengacak(benih: number) {
  let a = benih;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rancangIkon(nama: string) {
  const acak = pengacak(hash(norm(nama)));
  const pilih = (tanpaKosong: boolean): Bentuk => BENTUK[Math.floor(acak() * (tanpaKosong ? 5 : 6))];
  const gelap = acak() < 0.55;
  const isi: Bentuk[] = [pilih(false), pilih(false), pilih(false), pilih(false)];
  for (let i = 0; i < 4 && isi.filter((b) => b !== "kosong").length < 3; i++) {
    if (isi[i] === "kosong") isi[i] = pilih(true);
  }
  const aksen = acak() < 0.5 ? Math.floor(acak() * 4) : -1;
  const sel = isi.map((jenis, i) => ({ jenis, i, putar: Math.floor(acak() * 4) * 90, aksen: i === aksen }));
  return { gelap, sel: sel.filter((s) => s.jenis !== "kosong") };
}

/** Satu sel yang benar-benar digambar — hasil `rancangIkon().sel[n]`. */
export type SelIkon = ReturnType<typeof rancangIkon>["sel"][number];
/** Rancangan utuh satu ikon. */
export type RancanganIkon = ReturnType<typeof rancangIkon>;
export type { Bentuk };
