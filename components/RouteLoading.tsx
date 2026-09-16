import { Skeleton } from "@/components/ui/skeleton";

/**
 * Kerangka muat halaman — dirender oleh `loading.tsx` di setiap rute.
 *
 * Bentuknya sengaja meniru susunan HC Panel: pembuka (judul dan subjudul),
 * kontrol utama, lalu daftar. Kerangka yang tata letaknya berbeda dari halaman
 * jadinya membuat isi halaman seperti melompat saat data tiba — yang justru
 * terasa lebih lambat daripada tanpa kerangka sama sekali.
 */
export default function RouteLoading() {
  return (
    <div className="space-y-6 pt-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuat…</span>

      {/* Pembuka: judul lalu subjudul. */}
      <div className="space-y-3">
        <Skeleton className="h-10 w-64 rounded-bidang" />
        <Skeleton className="h-5 w-full max-w-subjudul rounded-bidang" />
      </div>

      {/* Kontrol utama. */}
      <Skeleton className="h-kontrol-utama w-full rounded-kartu" />

      {/* Daftar. */}
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((baris) => (
          <Skeleton key={baris} className="h-12 w-full rounded-bidang" />
        ))}
      </div>
    </div>
  );
}
