import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Keadaan kosong HC Panel — docs/DESIGN.md §Komponen.
 *
 * Kotak putus-putus, satu kalimat ajakan, satu tombol aksi. Putus-putus di HC
 * Panel selalu berarti "belum ada isinya", jadi bentuk ini dipakai untuk daftar
 * yang masih kosong — bukan untuk daftar yang kosong KARENA filter. Yang kedua
 * bukan keadaan kosong melainkan hasil pencarian nihil, dan kalimatnya harus
 * menawarkan jalan keluar: ubah kata kunci, atau bersihkan filternya.
 */
export function EmptyState({
  judul,
  ajakan,
  aksi,
  className,
}: {
  judul: string;
  /** Satu kalimat: apa langkah berikutnya. Diakhiri titik. */
  ajakan: string;
  /** Satu tombol. Lebih dari satu berarti layarnya yang belum diputuskan. */
  aksi?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-kartu border border-dashed border-garis-putus px-6 py-8 text-center",
        className,
      )}
    >
      <p className="text-subjudul font-bold text-foreground">{judul}</p>
      <p className="mx-auto mt-2 max-w-subjudul text-pendukung text-muted-foreground">
        {ajakan}
      </p>
      {aksi ? <div className="mt-6 flex justify-center">{aksi}</div> : null}
    </div>
  );
}

export default EmptyState;
