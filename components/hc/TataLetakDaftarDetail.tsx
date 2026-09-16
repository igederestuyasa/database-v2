import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tata letak daftar-detail — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * Mulai 1024px: dua kolom `minmax(0,1fr) minmax(320px,400px)` berjarak 64,
 * pembuka dan konten di kolom kiri, panel menempel di kanan sejajar baris
 * pembuka. Di bawah itu satu kolom dan PANEL TIDAK DIRENDER SAMA SEKALI —
 * bukan sekadar disembunyikan dengan CSS, supaya isinya tidak ikut terbaca
 * pembaca layar di layar yang tidak menampilkannya.
 *
 * `minmax(0,1fr)` bukan `1fr`: tanpa itu, satu tabel lebar di kolom kiri
 * memaksa gridnya melebar dan seluruh halaman jadi bisa digeser mendatar.
 */
export function TataLetakDaftarDetail({
  pembuka,
  panel,
  children,
  panelTerlihat,
  className,
}: {
  pembuka: React.ReactNode;
  /** Panel detail. Diabaikan selama `panelTerlihat` masih false. */
  panel?: React.ReactNode;
  children: React.ReactNode;
  /** Dari `useDaftarDetail()`; false sampai lebar layar terukur di browser. */
  panelTerlihat: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-12 pt-6",
        "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:gap-x-16 lg:gap-y-8 lg:pt-8",
        className,
      )}
    >
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{pembuka}</div>

      <div id="konten" className="min-w-0 lg:col-start-1 lg:row-start-2">
        {children}
      </div>

      {panelTerlihat && panel ? (
        <aside className="hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block">
          <div className="sticky top-6">{panel}</div>
        </aside>
      ) : null}
    </div>
  );
}

export default TataLetakDaftarDetail;
