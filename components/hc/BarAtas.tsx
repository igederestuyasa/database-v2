import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import Logo from "./Logo";

/**
 * Bar atas HC Panel — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * Tinggi 64 di HP, 72 mulai desktop. Kiri logo dan nama app; kanan keterangan
 * ringkas tentang siapa yang sedang masuk, disembunyikan di bawah 640px karena
 * di lebar itu nama app yang harus menang.
 *
 * Bukan navigasi. Di HC Core, delapan tujuan tetap tinggal di sidebar — bar ini
 * hanya memberi tahu "app apa ini, dan saya masuk sebagai siapa".
 *
 * PITA MEREK. Tepi paling atasnya garis 4px merah HK selebar layar
 * (docs/DESIGN.md §Komponen). Ditulis sebagai border-top, bukan elemen
 * sendiri: `box-sizing: border-box` membuat tinggi bar tetap 64/72 seperti
 * spesifikasi, dan tidak ada 4px tambahan yang mendorong seluruh halaman ke
 * bawah. Ini satu-satunya bidang merah penuh di sistem ini — yang membuat
 * layar terbaca sebagai milik Hutama Karya sebelum satu kata pun dibaca.
 */
export function BarAtas({
  nama = "HC Core",
  href = "/",
  kanan,
  className,
}: {
  nama?: string;
  href?: string;
  /** Keterangan di kanan — nama unit, email, atau role. */
  kanan?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-5",
        // Pita merek. `border-t-brand` menang atas `* { border-color: garis }`
        // di `globals.css` karena utilities terbit setelah base.
        "border-t-4 border-t-brand",
        "lg:h-bar-desktop lg:px-10",
        className,
      )}
    >
      <Link
        href={href}
        className={cn(
          "flex min-w-0 items-center gap-3 rounded-full",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        )}
      >
        <Logo ukuran={28} />
        <span className="truncate text-isi font-bold text-foreground">{nama}</span>
      </Link>

      {kanan ? (
        <span className="hidden min-w-0 truncate text-pendukung text-muted-foreground sm:block">
          {kanan}
        </span>
      ) : null}
    </header>
  );
}

/**
 * "Lewati ke konten" — harus jadi elemen yang bisa difokus PERTAMA di halaman,
 * jadi letaknya sebelum bar atas dan sebelum sidebar. Tampilannya diatur kelas
 * `.lewati-ke-konten` di `app/globals.css`: tersembunyi sampai di-Tab.
 */
export function LewatiKeKonten({ target = "#konten" }: { target?: string }) {
  return (
    <a href={target} className="lewati-ke-konten">
      Lewati ke konten
    </a>
  );
}

export default BarAtas;
