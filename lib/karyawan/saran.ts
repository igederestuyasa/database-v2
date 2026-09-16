/**
 * Saran nama untuk kolom cari Karyawan (PRD #2) — aturan dan bentuknya.
 *
 * MURNI, dan ada di `lib/` justru karena dua sisi memakainya: Server Action
 * `cariSaranKaryawan()` di `lib/actions/employees.ts`, dan komponen kliennya
 * `app/(app)/karyawan/_components/SaranCari.tsx`.
 *
 * Kenapa bukan diletakkan di berkas action-nya saja: berkas itu `"use server"`,
 * dan Next hanya mengizinkan **fungsi async** diekspor dari sana — sebuah
 * `export const` di situ menggagalkan `npm run build` dengan "Only async
 * functions are allowed to be exported in a 'use server' file". Yang tidak
 * menangkapnya: `npm run lint`, `npm run typecheck`, DAN `npm test`.
 *
 * Kenapa bukan di `_components/` bersama komponennya: `lib/` tidak pernah
 * mengimpor dari `app/` (CLAUDE.md), jadi action-nya tidak akan bisa
 * membacanya dari sana, dan kedua sisi akan menyimpan angkanya sendiri-sendiri.
 */

/**
 * Berapa nama yang ditawarkan sekaligus.
 *
 * Delapan, bukan dua puluh: daftar saran yang harus digulir sudah bukan saran
 * lagi, ia daftar hasil kedua yang bersaing dengan tabel di bawahnya. Kalau
 * yang dicari tidak ada di delapan teratas, kata kuncinya yang perlu
 * dipersempit — dan `catatanSaran()` mengatakan itu.
 */
export const MAKS_SARAN = 8;

/**
 * Minimal dua huruf sebelum bertanya ke server.
 *
 * Satu huruf cocok dengan ratusan orang; jawabannya tidak memberi tahu apa pun
 * dan ongkosnya satu query per ketukan tombol.
 */
export const MIN_HURUF_SARAN = 2;

/** Jeda sebelum kata kunci dikirim ke server, dalam milidetik. */
export const TUNDA_KETIK = 250;

/**
 * Satu nama di daftar saran — bukan `KaryawanRow`.
 *
 * Sengaja lebih sedikit daripada baris tabel: yang ada di sini persis yang
 * dipakai untuk MEMILIH satu orang dari beberapa nama mirip, bukan untuk
 * menampilkan datanya.
 */
export type SaranKaryawan = {
  id: string;
  nama: string;
  personnelNumber: string;
  /** Unit terendah dan Jabatan, digabung — pembeda dua orang bernama sama. */
  keterangan: string | null;
  status: "aktif" | "nonaktif";
};

/**
 * Apakah kata kunci ini layak dikirim ke server.
 *
 * Dinormalkan dulu — mengetik spasi di ujung bukan kata kunci baru, dan tanpa
 * ini setiap spasi memicu satu query yang jawabannya sama persis.
 */
export function layakDicari(teks: string): boolean {
  return teks.trim().length >= MIN_HURUF_SARAN;
}

/**
 * Apakah jawaban yang baru tiba masih relevan.
 *
 * INI BUKAN KEREWELAN. Permintaan untuk "ap" bisa tiba SESUDAH permintaan
 * untuk "aprilia" — jaringan tidak menjamin urutan — dan tanpa penjaga ini
 * daftar saran akan menampilkan hasil kata kunci yang sudah tidak ada di
 * kolomnya. Yang dibandingkan kata kuncinya sendiri, bukan nomor urut, supaya
 * jawaban yang kebetulan masih cocok tetap terpakai.
 */
export function jawabanMasihRelevan(
  kunciJawaban: string,
  kunciSekarang: string,
): boolean {
  return kunciJawaban === kunciSekarang.trim();
}

/**
 * Kalimat di kaki daftar, atau `null` kalau daftarnya sudah memuat semuanya.
 *
 * Ada supaya daftar yang terpotong tidak terbaca sebagai "cuma segini yang
 * ada" — orang yang tidak menemukan namanya di delapan teratas harus tahu
 * bahwa mempersempit kata kunci akan menolong.
 */
export function catatanSaran(
  jumlahTampil: number,
  total: number,
): string | null {
  if (total <= jumlahTampil) return null;
  return `${jumlahTampil} dari ${total} yang cocok. Ketik lebih lengkap untuk mempersempit.`;
}

/** Baris "tidak ada yang cocok", atau `null` kalau memang ada hasilnya. */
export function pesanKosongSaran(total: number): string | null {
  return total === 0 ? "Tidak ada nama yang cocok." : null;
}
