import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Nama-nama token HC Panel yang ditambahkan ke `tailwind.config.ts`.
 *
 * KENAPA HARUS DIDAFTARKAN DI SINI JUGA. tailwind-merge tidak membaca konfigurasi
 * Tailwind; ia menebak arti sebuah kelas dari namanya. Nama buatan sendiri tidak
 * dikenalinya, dan akibatnya ada dua, keduanya diam-diam:
 *
 *   1. `text-*` yang tidak dikenal dianggap WARNA, lalu warna sungguhan yang
 *      berpasangan dengannya dibuang karena dianggap bentrok. `cn("text-
 *      primary-foreground", "text-label")` menyisakan `text-label` saja —
 *      tombol utama jadi teks hitam di atas latar hitam. `text-judul-halaman
 *      text-foreground` kehilangan ukurannya — h1 sebesar teks biasa.
 *   2. `rounded-kartu`, `shadow-kontrol`, `h-kontrol-utama` dan kawan-kawan
 *      tidak menimpa kelas bawaan yang sepadan, jadi `<Card className="rounded-
 *      kartu">` menyisakan `rounded-lg rounded-kartu` dan yang menang ditentukan
 *      urutan di CSS, bukan oleh yang menulis.
 *
 * Keduanya lolos lint, typecheck, build, dan seluruh unit test. Yang menangkap
 * cuma mata, setelah halamannya benar-benar digambar.
 *
 * `utils.test.ts` mencocokkan setiap daftar di bawah dengan isi
 * `tailwind.config.ts`, jadi token baru yang lupa didaftarkan menggagalkan
 * `npm test` alih-alih menunggu ditemukan di layar.
 */
export const UKURAN_HURUF = [
  "judul-halaman",
  "judul-panel",
  "judul-bagian",
  "subjudul",
  "judul-item",
  "isi",
  "label",
  "pendukung",
  "mikro",
] as const;

export const RADIUS = ["panel", "kartu", "bidang"] as const;
export const BAYANGAN = ["kontrol", "popover"] as const;
export const SPASI = ["kontrol-utama", "kontrol-teks", "status", "bar-desktop"] as const;
export const KURVA = ["keluar", "standar", "pantul"] as const;
export const ANIMASI = ["naik-muncul", "bentuk-masuk", "panel-masuk"] as const;
export const TEBAL_HURUF = ["650"] as const;
export const LEBAR_MAKS = ["wadah", "subjudul"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...UKURAN_HURUF],
      radius: [...RADIUS],
      shadow: [...BAYANGAN],
      spacing: [...SPASI],
      ease: [...KURVA],
      animate: [...ANIMASI],
      "font-weight": [...TEBAL_HURUF],
    },
    classGroups: {
      // `max-w` bukan skala tema tersendiri di tailwind-merge, jadi kelompoknya
      // yang dilebarkan langsung.
      "max-w": [{ "max-w": [...LEBAR_MAKS] }],
    },
  },
});

/** Merge Tailwind class names, letting later classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
