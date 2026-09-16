import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Pembuka layar HC Panel — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * Empat elemen, tidak pernah lebih: salam, judul, subjudul, kontrol utama.
 * Batas itu yang membuat setiap layar terbaca dalam sekali pandang, jadi
 * keterangan tambahan masuk ke subjudul — bukan jadi paragraf kelima.
 *
 * Tundanya 0, 60, 110, dan 170ms, naik 14px sambil muncul. Keempatnya mati
 * sendiri saat `prefers-reduced-motion: reduce`.
 */
export function PembukaLayar({
  salam,
  judul,
  subjudul,
  children,
  className,
}: {
  /** Baris pembuka opsional, mis. "Database central HC". */
  salam?: React.ReactNode;
  judul: React.ReactNode;
  /** Maksimal 20 kata; lebih dari itu tidak terbaca sebagai subjudul. */
  subjudul?: React.ReactNode;
  /** Kontrol utama layar — biasanya `<SearchField>`. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("min-w-0", className)}>
      {salam ? (
        <p
          className="animate-naik-muncul text-isi font-medium text-muted-foreground"
          style={{ animationDelay: "0ms" }}
        >
          {salam}
        </p>
      ) : null}

      <h1
        className={cn(
          "animate-naik-muncul text-balance text-judul-halaman text-foreground",
          salam ? "mt-2" : null,
        )}
        style={{ animationDelay: "60ms" }}
      >
        {judul}
      </h1>

      {subjudul ? (
        <p
          className="animate-naik-muncul mt-3 max-w-subjudul text-subjudul text-muted-foreground"
          style={{ animationDelay: "110ms" }}
        >
          {subjudul}
        </p>
      ) : null}

      {children ? (
        <div className="animate-naik-muncul mt-6" style={{ animationDelay: "170ms" }}>
          {children}
        </div>
      ) : null}
    </header>
  );
}

export default PembukaLayar;
