/**
 * Membaca satu bagian samping halaman tanpa membiarkannya menjatuhkan halaman.
 *
 * Halaman detail menampilkan satu baris utama plus beberapa bacaan pelengkap
 * — rantai induk, jumlah pemegang, tujuan Merge, Riwayat Revisi, Data Pribadi
 * Sensitif. Setiap fungsi `lib/db/**` melempar `DbError` dan menyerahkan
 * keputusannya ke pemanggil, dan untuk bacaan pelengkap keputusannya selalu
 * sama: catat ke log server, lalu tampilkan halaman tanpa bagian itu. Sebuah
 * statement timeout pada `employee_private` tidak boleh membuat admin
 * kehilangan nama, Penempatan, dan seluruh Riwayat Karyawan yang ia buka.
 *
 * Sebelumnya keputusan itu ditulis ulang sebagai `bacaRantai`, `bacaPribadi`,
 * `hitungKaryawan`, `hitungPemegang`, `hitungPemakai`, dan tiga
 * `bacaTujuanMerge` di empat halaman. Sekarang satu fungsi.
 *
 * `undefined` berarti bacaannya GAGAL; `null` dari `baca()` (baris memang tidak
 * ada, RLS menyembunyikannya, belum diisi) diteruskan apa adanya, sehingga
 * pemanggil bisa membedakan "kosong" dari "tidak terbaca":
 *
 *     const pribadi = await bacaAman("[karyawan/detail] gagal memuat Data Pribadi Sensitif",
 *       () => getEmployeePrivate(client, id));
 *     const gagal = pribadi === undefined;
 *
 * Hanya untuk Server Component (folder `_lib` privat dari router, dan modul
 * ini menarik `lib/db` lewat pemanggilnya).
 */
export async function bacaAman<T>(
  pesanLog: string,
  baca: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await baca();
  } catch (error) {
    console.error(pesanLog, error);
    return undefined;
  }
}
