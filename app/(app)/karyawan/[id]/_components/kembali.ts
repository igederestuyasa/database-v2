/**
 * Ke mana tombol "← Karyawan" kembali.
 *
 * MASALAHNYA. Daftar Karyawan menyimpan seluruh filternya di alamat halaman —
 * kata kunci, unit, jabatan, status, urutan, halaman keberapa. Membuka satu
 * orang lalu menekan kembali dulu selalu mendarat di `/karyawan` polos, jadi
 * filternya hilang dan harus disusun ulang. Untuk pekerjaan yang wajar —
 * menyaring satu divisi lalu memeriksa orangnya satu per satu — itu berarti
 * mengetik ulang filter yang sama belasan kali.
 *
 * Karena itu daftar menitipkan alamatnya sendiri di `?kembali=`, dan halaman
 * detail memakainya kalau ada.
 *
 * KENAPA DIPERIKSA. `kembali` datang dari alamat halaman, dan alamat halaman
 * bisa ditulis siapa saja. Tanpa pemeriksaan, `?kembali=https://…` mengubah
 * tombol "kembali" jadi tautan ke situs orang lain yang terlihat berasal dari
 * HC Core — pengalihan terbuka. Yang diterima di sini hanya alamat daftar
 * Karyawan itu sendiri; apa pun yang lain dijatuhkan ke `/karyawan`, bukan
 * ditolak dengan galat, karena tombol kembali yang salah bukan alasan
 * menggagalkan halaman.
 */
const DAFTAR = "/karyawan";

export function hrefKembali(raw: string | string[] | undefined): string {
  const nilai = Array.isArray(raw) ? raw[0] : raw;
  if (typeof nilai !== "string" || nilai === "") return DAFTAR;

  // `/karyawan` sendiri, atau `/karyawan?…`. Bukan `/karyawan/123`, bukan
  // `//jahat.example` (yang bagi peramban adalah host lain meski diawali
  // garis miring), dan bukan `https://…`.
  if (nilai === DAFTAR) return DAFTAR;
  if (nilai.startsWith(`${DAFTAR}?`)) return nilai;
  return DAFTAR;
}
