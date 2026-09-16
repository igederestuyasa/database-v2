import * as React from "react";

import Info from "./Info";
import { cn } from "@/lib/utils";

/**
 * Pembuka layar HC Panel — docs/DESIGN.md §Spasi, bentuk, tata letak.
 *
 * Tiga elemen: salam, judul, kontrol utama.
 *
 * SALAM ADALAH BARIS MEREK. Warnanya merah HK, bukan redup: satu baris pendek
 * di atas judul adalah tempat paling murah untuk menaruh warna merek — ia ada
 * di setiap layar, tidak pernah dibaca dua kali, dan tidak bersaing dengan
 * apa pun. Kontrasnya 5,5:1 di mode terang dan 5,2:1 di gelap, jadi ia tetap
 * teks biasa yang bisa dibaca, bukan hiasan.
 *
 * KETERANGAN HALAMAN TIDAK LAGI JADI PARAGRAF. Kalimat yang dulu berdiri
 * sebagai subjudul abu-abu di bawah judul kini tinggal di balik penanda "i" di
 * samping judulnya: isinya sama, tapi hanya muncul kalau dicari. Kalimat
 * seperti itu dibaca sekali di hari pertama dan sesudahnya cuma memakan tempat
 * di layar yang dibuka setiap hari.
 *
 * Tundanya 0, 60, dan 110ms, naik 14px sambil muncul. Ketiganya mati sendiri
 * saat `prefers-reduced-motion: reduce`.
 */
export function PembukaLayar({
  salam,
  judul,
  info,
  children,
  className,
}: {
  /** Baris merek opsional di atas judul, mis. "Database central HC". */
  salam?: React.ReactNode;
  judul: React.ReactNode;
  /** Keterangan halaman; tampil di balik penanda "i" di samping judul. */
  info?: React.ReactNode;
  /** Kontrol utama layar — biasanya `<SearchField>`. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("min-w-0", className)}>
      {salam ? (
        <p
          className="animate-naik-muncul text-isi font-medium text-brand"
          style={{ animationDelay: "0ms" }}
        >
          {salam}
        </p>
      ) : null}

      <div
        className={cn("animate-naik-muncul flex items-center gap-2", salam ? "mt-2" : null)}
        style={{ animationDelay: "60ms" }}
      >
        <h1 className="text-balance text-judul-halaman text-foreground">{judul}</h1>
        {info ? <Info label={`Keterangan ${typeof judul === "string" ? judul : "halaman"}`}>{info}</Info> : null}
      </div>

      {children ? (
        <div className="animate-naik-muncul mt-6" style={{ animationDelay: "110ms" }}>
          {children}
        </div>
      ) : null}
    </header>
  );
}

export default PembukaLayar;
