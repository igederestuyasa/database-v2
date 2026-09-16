/**
 * Panah antaritem "mengikuti posisi visual" — docs/DESIGN.md §Aksesibilitas.
 *
 * Kalimat itu tidak sama dengan "mengikuti urutan di DOM". Di grid kartu dua
 * kolom, Panah bawah harus turun satu baris pada kolom yang sama, bukan
 * meloncat ke tetangga kanan. Jadi yang menentukan bukan indeks melainkan
 * letak: baris disusun dari koordinat atas, kolom dari koordinat kiri.
 *
 * Murni dan bisa diuji: pemanggilnya yang mengukur DOM, berkas ini hanya
 * berhitung. Itu sebabnya ia `.ts` dan bukan bagian dari komponennya —
 * `navigasiDaftar.test.ts` di sebelahnya ikut terkumpul `npm test`.
 */

/** Letak satu item, seperti yang dilaporkan `getBoundingClientRect()`. */
export type KotakItem = { kiri: number; atas: number };

/** Dua item dianggap sebaris kalau bedanya lebih kecil dari ini (px). */
const TOLERANSI_BARIS = 4;

/** Indeks item, dikelompokkan per baris visual dan diurutkan kiri ke kanan. */
function perBaris(kotak: readonly KotakItem[]): number[][] {
  const indeks = kotak.map((_, i) => i);
  indeks.sort((a, b) => kotak[a].atas - kotak[b].atas || kotak[a].kiri - kotak[b].kiri);

  const baris: number[][] = [];
  for (const i of indeks) {
    const terakhir = baris[baris.length - 1];
    const sebaris =
      terakhir !== undefined &&
      Math.abs(kotak[terakhir[0]].atas - kotak[i].atas) <= TOLERANSI_BARIS;
    if (sebaris) terakhir.push(i);
    else baris.push([i]);
  }
  for (const satu of baris) satu.sort((a, b) => kotak[a].kiri - kotak[b].kiri);
  return baris;
}

/** Di baris mana, kolom ke berapa. */
function letak(baris: number[][], indeks: number): { b: number; k: number } | null {
  for (let b = 0; b < baris.length; b += 1) {
    const k = baris[b].indexOf(indeks);
    if (k !== -1) return { b, k };
  }
  return null;
}

/** Item di baris `b` yang paling dekat secara mendatar dengan `kiri`. */
function terdekatMendatar(
  kotak: readonly KotakItem[],
  baris: readonly number[],
  kiri: number,
): number {
  let pilihan = baris[0];
  let jarak = Math.abs(kotak[pilihan].kiri - kiri);
  for (const i of baris) {
    const ini = Math.abs(kotak[i].kiri - kiri);
    if (ini < jarak) {
      jarak = ini;
      pilihan = i;
    }
  }
  return pilihan;
}

/**
 * Indeks tujuan setelah sebuah tombol panah ditekan, atau `null` kalau tombol
 * itu bukan urusan daftar (biarkan lewat) atau sudah mentok.
 *
 * `sekarang` boleh -1, artinya belum ada yang fokus: panah apa pun masuk ke
 * item pertama, persis seperti Panah bawah dari kolom cari.
 */
export function indeksBerikutnya(
  kotak: readonly KotakItem[],
  sekarang: number,
  tombol: string,
): number | null {
  if (kotak.length === 0) return null;

  const baris = perBaris(kotak);
  const urutanVisual = baris.flat();

  if (tombol === "Home") return urutanVisual[0];
  if (tombol === "End") return urutanVisual[urutanVisual.length - 1];

  const arahDikenal = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
  if (!arahDikenal.includes(tombol)) return null;

  if (sekarang < 0 || sekarang >= kotak.length) return urutanVisual[0];

  const posisi = letak(baris, sekarang);
  if (!posisi) return urutanVisual[0];

  if (tombol === "ArrowRight" || tombol === "ArrowLeft") {
    const di = urutanVisual.indexOf(sekarang);
    const tujuan = tombol === "ArrowRight" ? di + 1 : di - 1;
    if (tujuan < 0 || tujuan >= urutanVisual.length) return null;
    return urutanVisual[tujuan];
  }

  const barisTujuan = tombol === "ArrowDown" ? posisi.b + 1 : posisi.b - 1;
  if (barisTujuan < 0 || barisTujuan >= baris.length) return null;
  return terdekatMendatar(kotak, baris[barisTujuan], kotak[sekarang].kiri);
}
