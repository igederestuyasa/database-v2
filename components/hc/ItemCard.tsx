import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import GenerativeIcon from "./GenerativeIcon";

/**
 * Kartu item HC Panel — docs/DESIGN.md §Komponen ("Kartu item").
 *
 * Grid tiga kolom dengan ikon menjangkau dua baris, jadi deskripsi sepanjang
 * apa pun tetap rata dengan nama di atasnya dan tidak pernah menyelinap ke
 * bawah ikon.
 *
 * Aksi utama item dijalankan dengan mengklik KARTUNYA, bukan sebuah tombol di
 * dalamnya: `href` merender tautan sungguhan (bisa dibuka di tab baru, terbaca
 * pembaca layar sebagai tautan), `onKlik` merender tombol. Salah satu harus ada
 * kecuali kartunya memang belum tersedia.
 */
export type ItemCardProps = {
  nama: string;
  deskripsi?: string | null;
  /** Label status di ujung kanan — biasanya `<StatusLabel>`. */
  status?: React.ReactNode;
  /** Aksi utama berupa perpindahan halaman. */
  href?: string;
  /** Aksi utama berupa tindakan di halaman ini. */
  onKlik?: () => void;
  /** Belum tersedia: putus-putus, nama redup, ikon versi rencana. */
  rencana?: boolean;
  /** Nomor urut untuk menunda animasi ikon. */
  urutan?: number;
  className?: string;
} & Record<`data-${string}`, string | undefined>;

export function ItemCard({
  nama,
  deskripsi,
  status,
  href,
  onKlik,
  rencana = false,
  urutan = 0,
  className,
  ...sisa
}: ItemCardProps) {
  const kelas = cn(
    "hc-permukaan group grid w-full grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 rounded-kartu border p-4 text-left",
    "transition duration-150 ease-standar",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
    rencana
      ? "border-dashed border-garis-putus bg-transparent"
      : "border-border bg-card hover:border-foreground data-[terpilih]:border-foreground active:scale-[0.99]",
    className,
  );

  const isi = (
    <>
      <span className="col-start-1 row-span-2 row-start-1 self-start">
        <GenerativeIcon nama={nama} ukuran={40} rencana={rencana} urutan={urutan} />
      </span>

      <span
        className={cn(
          "col-start-2 row-start-1 min-w-0 self-center text-judul-item",
          rencana ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {nama}
      </span>

      <span className="col-start-3 row-start-1 flex h-status items-center gap-2 self-center">
        {status}
        {rencana ? null : (
          <ArrowUpRight
            aria-hidden="true"
            className={cn(
              "h-[18px] w-[18px] text-muted-foreground",
              "transition duration-200 ease-standar",
              "group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand",
            )}
          />
        )}
      </span>

      {deskripsi ? (
        <span className="col-span-2 col-start-2 row-start-2 line-clamp-3 min-w-0 text-pendukung text-muted-foreground">
          {deskripsi}
        </span>
      ) : null}
    </>
  );

  if (rencana || (!href && !onKlik)) {
    return (
      <div className={kelas} {...sisa}>
        {isi}
      </div>
    );
  }

  return href ? (
    <Link href={href} className={kelas} {...sisa}>
      {isi}
    </Link>
  ) : (
    <button type="button" onClick={onKlik} className={kelas} {...sisa}>
      {isi}
    </button>
  );
}

export default ItemCard;
