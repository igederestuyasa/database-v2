"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Tab filter HC Panel — docs/DESIGN.md §Komponen.
 *
 * Satu baris, tinggi 44, garis bawah 2px merah HK di atas garis dasar 1px
 * garis — aksen merek yang sama seperti pita di bar atas.
 * Di layar sempit barisnya digeser, dan tepinya memudar HANYA saat memang ada
 * yang tersembunyi di sisi itu — memudarkan tepi yang tidak meluap justru
 * membuat tab pertama terlihat seperti terpotong padahal tidak.
 *
 * DUA BENTUK, SATU TAMPILAN. Tab yang mengubah URL dirender sebagai `Link`
 * dengan `aria-current="page"`; tab yang hanya mengubah keadaan di halaman
 * dirender sebagai `button` dengan `aria-pressed`. Keduanya ada di HC Core
 * sebelum redesign ini (Master Data memakai Link, filter status memakai
 * keadaan), dan `aria-pressed` pada sebuah tautan bukan hal yang sah.
 */
export type ItemTab = {
  /** Nilai unik; dibandingkan dengan `aktif`. */
  nilai: string;
  label: string;
  /** Angka kecil di samping label — jumlah baris di tab itu. */
  jumlah?: number;
  /** Isi untuk merender tautan. Tanpa ini, tab jadi tombol. */
  href?: string;
  disabled?: boolean;
};

export type FilterTabsProps = {
  /** Dibacakan sebagai nama kelompok tabnya, mis. "Tipe Lookup". */
  label: string;
  aktif: string;
  items: readonly ItemTab[];
  /** Wajib untuk tab bentuk tombol; diabaikan oleh tab bentuk tautan. */
  onPilih?: (nilai: string) => void;
  className?: string;
};

const KELAS_TAB = [
  "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1",
  "text-pendukung font-medium transition-colors duration-150 ease-standar",
  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground",
  "disabled:pointer-events-none disabled:opacity-50",
].join(" ");

/**
 * Garisnya merah, teksnya tetap tinta. Merah di sini cuma menegaskan tab yang
 * sudah ditandai `aria-current`/`aria-pressed` dan dibedakan warna teksnya dari
 * yang lain — bukan satu-satunya yang membedakan, jadi tetap terbaca tanpa
 * warna.
 */
function kelasNada(aktif: boolean): string {
  return aktif
    ? "border-brand text-foreground"
    : "border-transparent text-muted-foreground hover:text-foreground";
}

function Jumlah({ nilai }: { nilai: number }) {
  return <span className="text-mikro font-medium tabular-nums opacity-70">{nilai}</span>;
}

export function FilterTabs({ label, aktif, items, onPilih, className }: FilterTabsProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [tepi, setTepi] = React.useState({ kiri: false, kanan: false });

  const ukur = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const meluap = el.scrollWidth > el.clientWidth + 1;
    setTepi({
      kiri: meluap && el.scrollLeft > 1,
      kanan: meluap && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    ukur();
    window.addEventListener("resize", ukur);
    return () => window.removeEventListener("resize", ukur);
  }, [ukur, items]);

  const memudar = tepi.kiri || tepi.kanan;
  const topeng = memudar
    ? `linear-gradient(to right, ${tepi.kiri ? "transparent" : "black"}, black 24px, black calc(100% - 24px), ${
        tepi.kanan ? "transparent" : "black"
      })`
    : undefined;

  return (
    <div
      ref={ref}
      onScroll={ukur}
      role="group"
      aria-label={label}
      className={cn(
        "flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={topeng ? { maskImage: topeng, WebkitMaskImage: topeng } : undefined}
    >
      {items.map((item) => {
        const ini = item.nilai === aktif;
        const isi = (
          <>
            {item.label}
            {item.jumlah === undefined ? null : <Jumlah nilai={item.jumlah} />}
          </>
        );

        // -mb-px menaruh garis 2px tab aktif TEPAT di atas garis dasar 1px,
        // bukan 1px di bawahnya.
        const kelas = cn(KELAS_TAB, kelasNada(ini), "-mb-px");

        return item.href ? (
          <Link
            key={item.nilai}
            href={item.href}
            aria-current={ini ? "page" : undefined}
            className={kelas}
          >
            {isi}
          </Link>
        ) : (
          <button
            key={item.nilai}
            type="button"
            aria-pressed={ini}
            disabled={item.disabled}
            onClick={() => onPilih?.(item.nilai)}
            className={kelas}
          >
            {isi}
          </button>
        );
      })}
    </div>
  );
}

export default FilterTabs;
