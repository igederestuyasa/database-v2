"use client";

import * as React from "react";
import { Info as IkonInfo } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Penanda informasi: huruf "i" kecil yang membuka keterangan saat diketuk.
 *
 * KENAPA ADA. Keterangan panjang berwarna redup di bawah setiap judul dan
 * setiap kolom membuat halaman terasa sesak, dan yang membacanya cuma orang di
 * hari pertama. Penanda ini menyimpan kalimat yang sama, tapi hanya muncul
 * kalau memang dicari.
 *
 * YANG BOLEH MASUK KE SINI HANYA PENJELASAN. Kalau sebuah baris membawa DATA —
 * kode di balik sebuah nama, nomor surat, berapa yang aktif — ia tetap terlihat
 * di halaman. Menyembunyikan data di balik ketukan berarti data itu hilang bagi
 * siapa pun yang tidak tahu harus mengetuk.
 *
 * Popover, bukan tooltip: tooltip hanya terbuka dengan kursor, dan staf HC juga
 * membuka halaman ini dari tablet.
 */
export function Info({
  children,
  label = "Keterangan",
  className,
}: {
  /** Kalimat penjelasnya. */
  children: React.ReactNode;
  /** Dibacakan pembaca layar sebagai nama tombolnya. */
  label?: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle",
            "text-muted-foreground transition-colors duration-150 ease-standar",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
            className,
          )}
        >
          <IkonInfo aria-hidden="true" className="h-[14px] w-[14px]" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="hc-permukaan w-72 rounded-kartu border-border p-4 text-pendukung text-muted-foreground shadow-popover"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default Info;
