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
 *     const pribadi = await bacaAman("karyawan/detail", "muat Data Pribadi Sensitif",
 *       () => getEmployeePrivate(client, id));
 *     const gagal = pribadi === undefined;
 *
 * Hanya untuk Server Component (folder `_lib` privat dari router, dan modul
 * ini menarik `lib/db` lewat pemanggilnya).
 */
import { logError } from "@/lib/log";

export async function bacaAman<T>(
  /** Halaman yang membaca, untuk log: `"struktur/detail"`. */
  where: string,
  /** Apa yang dibaca, untuk log: `"muat rantai induk"`. */
  aksi: string,
  baca: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await baca();
  } catch (error) {
    logError(where, error, { aksi });
    return undefined;
  }
}
