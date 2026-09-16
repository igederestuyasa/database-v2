import type { DaftarTerpotong } from "@/lib/db/shared";

/**
 * "Daftar ini belum lengkap." — satu peringatan untuk setiap bacaan yang
 * pulang terpotong.
 *
 * PostgREST memotong sebuah bacaan pada `db-max-rows` (bawaan 1000) SEBELUM
 * `.limit()` pemanggil dan melaporkannya sebagai sukses, jadi satu-satunya
 * yang bisa mengatakan "ada yang hilang" adalah `FullRead.truncated`
 * (`lib/db/shared.ts`). Tujuh halaman menampilkannya, dan tiap halaman dulu
 * menulis ulang kotak yang sama; yang benar-benar berbeda per halaman hanya
 * kalimat akibatnya — daftar Merge yang tidak lengkap, hierarki yang keliru,
 * pilihan filter yang hilang — dan itulah `keterangan`.
 *
 * Tidak dirender sama sekali kalau `daftar` kosong, supaya pemanggil tidak
 * perlu membungkusnya dengan kondisi.
 *
 * Server Component (tanpa `"use client"`): dipanggil dari page.
 */
export default function DaftarTerpotongAlert({
  daftar,
  judul = "Daftar ini belum lengkap.",
  keterangan,
}: {
  daftar: readonly DaftarTerpotong[];
  /** Kalimat pertama, tebal. */
  judul?: string;
  /** Apa akibatnya di halaman ini, dan apa yang harus dilakukan. */
  keterangan: string;
}) {
  if (daftar.length === 0) return null;

  return (
    <div
      role="alert"
      className="hc-permukaan rounded-kartu border border-destructive/40 bg-destructive/5 p-4 text-pendukung"
    >
      <p className="text-label text-foreground">{judul}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {daftar.map((satu) => (
          <li key={satu.nama}>
            Baru {satu.dibaca} dari {satu.total} {satu.nama} yang berhasil dimuat.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">
        Database membatasi jumlah baris per permintaan. {keterangan}
      </p>
    </div>
  );
}
