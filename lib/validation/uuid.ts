/**
 * Bentuk uuid — satu regex untuk seluruh aplikasi.
 *
 * Dulu disalin di enam file (empat halaman detail, `/log`, filter Karyawan)
 * plus satu lagi di `lib/api/query.ts`. Halaman memakainya untuk mengubah id
 * yang bukan uuid menjadi `notFound()` sebelum menyentuh database — PostgREST
 * menjawab uuid yang salah bentuk dengan `22P02`, dan itu bukan kalimat yang
 * pantas dibaca staf HC untuk sesuatu yang sebenarnya cuma "halaman tidak ada".
 *
 * Murni: tanpa zod, supaya bisa dipakai di modul client maupun server. Untuk
 * validasi input Server Action tetap pakai `uuidField()` di `common.ts`.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
