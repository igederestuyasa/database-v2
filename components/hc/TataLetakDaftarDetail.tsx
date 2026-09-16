import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tata letak daftar-detail — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * Mulai `AMBANG_PANEL` (1280 di HC Core, lihat `useDaftarDetail.ts`): dua kolom `minmax(0,1fr) minmax(320px,400px)` berjarak 64,
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
        "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] xl:gap-x-16 xl:gap-y-8 xl:pt-8",
        className,
      )}
    >
      <div className="min-w-0 xl:col-start-1 xl:row-start-1">{pembuka}</div>

      <div className="min-w-0 xl:col-start-1 xl:row-start-2">{children}</div>

      {panelTerlihat && panel ? (
        <aside className="hidden xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:block">
          <div className="sticky top-6">{panel}</div>
        </aside>
      ) : null}
    </div>
  );
}

export default TataLetakDaftarDetail;
