/**
 * Filter status di `/jabatan?status=…`, dipakai dua sisi sekaligus.
 *
 * Modul biasa — BUKAN `"use client"` — dan itulah seluruh alasan file ini ada.
 * Server Component yang mengimpor nilai dari modul client tidak menerima
 * nilainya, melainkan sebuah client reference; membaca `.includes` darinya
 * melempar "You cannot dot into a client module from a server component" saat
 * request, dan TypeScript tidak bisa melihatnya karena tipenya tetap benar.
 * Jadi nilai yang dibaca `page.tsx` maupun tabelnya tinggal di sini.
 */

export const STATUS_FILTERS = ["aktif", "nonaktif", "semua"] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  aktif: "Hanya aktif",
  nonaktif: "Hanya nonaktif",
  semua: "Semua status",
};

/** Baca `?status=`; apa pun yang tidak dikenali berarti daftar aktif. */
export function bacaStatusFilter(
  value: string | string[] | undefined,
): StatusFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return STATUS_FILTERS.includes(first as StatusFilter)
    ? (first as StatusFilter)
    : "aktif";
}
