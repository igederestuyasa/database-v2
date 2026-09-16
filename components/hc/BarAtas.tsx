import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import Logo from "./Logo";

/**
 * Bar atas HC Panel — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * HANYA UNTUK LAYAR SEMPIT. Mulai 1024px sidebar mengambil alih seluruh
 * tugasnya — logo, nama app, dan blok akun semuanya ada di kepala dan kaki
 * sidebar — jadi pemanggilnya menyembunyikan bar ini dengan `lg:hidden`. Di
 * bawah lebar itu sidebar tidak dirender sama sekali, dan bar inilah
 * satu-satunya tempat identitas app dan jalan keluar bisa ada.
 *
 * Bukan navigasi. Delapan tujuan tetap tinggal di sidebar (atau, di layar
 * sempit, di strip yang bisa digeser di bawah bar ini).
 *
 * MENEMPEL DI ATAS. `sticky top-0` dengan `bg-background` sendiri — tanpa
 * latar, isi halaman terlihat menembusnya saat digulir — dan `z-40`: di atas
 * isi halaman tapi di bawah dialog dan popover (z-50 di `components/ui/*`),
 * supaya bar tidak pernah menutupi hal yang sedang ditunggu jawabannya.
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
        "sticky top-0 z-40 bg-background",
        "flex h-16 shrink-0 items-center justify-between gap-4",
        "border-b border-border px-5",
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

      {kanan ? <div className="shrink-0">{kanan}</div> : null}
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
