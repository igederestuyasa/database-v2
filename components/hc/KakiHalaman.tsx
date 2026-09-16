import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Kaki halaman HC Panel — docs/DESIGN.md §Komponen.
 *
 * Garis atas, padding 24 di atas dan 48 di bawah, teks 14 redup. Isinya hal
 * yang dicari orang saat data di layar terasa janggal: kapan terakhir berubah,
 * dan harus bertanya ke siapa.
 */
export function KakiHalaman({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "mt-12 border-t border-border pb-12 pt-6 text-pendukung text-muted-foreground",
        className,
      )}
    >
      {children}
    </footer>
  );
}

export default KakiHalaman;
