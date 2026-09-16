"use client";

/**
 * Saran nama sambil mengetik, di atas kolom cari Karyawan (PRD #2).
 *
 * KENAPA HANYA LAYAR INI. Jabatan, Master Data, dan API Key menyaring
 * daftarnya DI KLIEN: mengetik langsung memendekkan tabel di bawahnya, jadi
 * hasilnya sudah terlihat dan saran cuma akan mengulanginya. Karyawan
 * menyaring di SERVER — 1.475 baris tidak dibawa ke peramban — jadi sampai
 * Enter ditekan, layar masih memperlihatkan hasil kata kunci sebelumnya.
 * Orang yang cuma ingat "apri" tidak punya cara tahu apakah yang dicarinya
 * Aprilia, Apriliani, atau Aprianto. Daftar ini yang menjawabnya.
 *
 * MEMILIH, BUKAN MENAMPILKAN. Menekan satu saran membuka halaman detail orang
 * itu langsung — bukan mengisi kolom cari lalu menyuruh menekan Enter lagi.
 * Yang dicari orang di sini adalah orangnya, bukan kata kuncinya.
 *
 * Fokus berpindah sungguhan ke dalam daftar (bukan `aria-activedescendant`),
 * sama seperti pola daftar-detail di tabelnya: pembaca layar mengikutinya
 * tanpa perlu satu lapis atribut lagi yang bisa salah.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import SearchField from "@/components/hc/SearchField";
import StatusLabel from "@/components/hc/StatusLabel";
import {
  indeksBerikutnya,
  type KotakItem,
} from "@/components/hc/navigasiDaftar";
import { cariSaranKaryawan } from "@/lib/actions/employees";
import { cn } from "@/lib/utils";

import {
  TUNDA_KETIK,
  catatanSaran,
  jawabanMasihRelevan,
  layakDicari,
  pesanKosongSaran,
  type SaranKaryawan,
} from "@/lib/karyawan/saran";

export type SaranCariProps = {
  id: string;
  label: string;
  placeholder: string;
  nilai: string;
  onNilaiChange: (nilai: string) => void;
  /** Enter di kolom cari: menjalankan pencarian sungguhan. */
  onSubmit: () => void;
  /** Panah bawah saat tidak ada saran terbuka: masuk ke baris tabel. */
  onPanahBawahDaftar: () => void;
  disabled?: boolean;
};

export default function SaranCari({
  id,
  label,
  placeholder,
  nilai,
  onNilaiChange,
  onSubmit,
  onPanahBawahDaftar,
  disabled,
}: SaranCariProps) {
  const router = useRouter();
  const [saran, setSaran] = React.useState<SaranKaryawan[]>([]);
  const [total, setTotal] = React.useState(0);
  const [terbuka, setTerbuka] = React.useState(false);
  const [sedangMemuat, setSedangMemuat] = React.useState(false);
  const refDaftar = React.useRef<HTMLUListElement | null>(null);

  /*
    Satu permintaan per jeda ketik, dan jawaban yang sudah basi dibuang.

    `layakDicari` menahan kata kunci yang terlalu pendek; `TUNDA_KETIK`
    menahan setiap ketukan tombol. Yang tersisa bahaya urutan: permintaan
    untuk "ap" bisa tiba SESUDAH permintaan untuk "aprilia". Karena itu
    jawaban dicocokkan balik ke kata kunci yang sedang ada di kolom, lewat
    `jawabanMasihRelevan` — dan `dibatalkan` menjaga effect yang sudah
    dibersihkan tidak menyentuh state sama sekali.
  */
  React.useEffect(() => {
    const kunci = nilai.trim();
    if (!layakDicari(kunci)) {
      setSaran([]);
      setTotal(0);
      setSedangMemuat(false);
      return;
    }

    let dibatalkan = false;
    setSedangMemuat(true);
    const penunda = window.setTimeout(async () => {
      const hasil = await cariSaranKaryawan({ q: kunci });
      if (dibatalkan || !jawabanMasihRelevan(kunci, nilai)) return;
      setSedangMemuat(false);
      if (!hasil.ok) {
        setSaran([]);
        setTotal(0);
        return;
      }
      setSaran(hasil.data.saran);
      setTotal(hasil.data.total);
    }, TUNDA_KETIK);

    return () => {
      dibatalkan = true;
      window.clearTimeout(penunda);
    };
  }, [nilai]);

  const tampil = terbuka && layakDicari(nilai) && !sedangMemuat;
  const catatan = catatanSaran(saran.length, total);
  const kosong = pesanKosongSaran(total);

  const elemenSaran = React.useCallback(
    () =>
      Array.from(
        refDaftar.current?.querySelectorAll<HTMLElement>("[data-saran]") ?? [],
      ),
    [],
  );

  const buka = (id: string) => {
    setTerbuka(false);
    router.push(`/karyawan/${id}`);
  };

  const panahAntarSaran = (event: React.KeyboardEvent) => {
    const elemen = elemenSaran();
    if (elemen.length === 0) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setTerbuka(false);
      document.getElementById(id)?.focus();
      return;
    }

    const aktif = document.activeElement;
    const sekarang = elemen.findIndex((el) => el === aktif);
    const kotak: KotakItem[] = elemen.map((el) => {
      const k = el.getBoundingClientRect();
      return { kiri: k.left, atas: k.top };
    });

    const tujuan = indeksBerikutnya(kotak, sekarang, event.key);
    if (tujuan === null) return;
    event.preventDefault();
    elemen[tujuan]?.focus();
  };

  return (
    <div
      className="relative"
      onFocus={() => setTerbuka(true)}
      onBlur={(event) => {
        // Hanya tutup kalau fokus benar-benar keluar dari kolom DAN daftarnya;
        // berpindah dari kolom ke saran pertama juga sebuah blur.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setTerbuka(false);
        }
      }}
    >
      <SearchField
        id={id}
        label={label}
        nilai={nilai}
        onNilaiChange={onNilaiChange}
        placeholder={placeholder}
        disabled={disabled}
        onSubmit={() => {
          setTerbuka(false);
          onSubmit();
        }}
        onPanahBawah={() => {
          // Kalau ada saran terbuka, panah bawah masuk ke situ — bukan
          // melompati daftar yang sedang terbuka menuju tabel di belakangnya.
          if (tampil && saran.length > 0) elemenSaran()[0]?.focus();
          else onPanahBawahDaftar();
        }}
      />

      {tampil ? (
        <div
          className={cn(
            // z-50, bukan z-30: kartu filter di bawahnya ikut membentuk konteks
            // penumpukan sendiri, dan pada z-30 panah pemilihnya menembus
            // daftar ini. Dialog dan popover juga z-50 tetapi di-portal ke
            // <body> dan dirender belakangan, jadi mereka tetap menang.
            "hc-permukaan absolute left-0 right-0 top-full z-50 mt-2",
            "overflow-hidden rounded-kartu border border-border bg-card shadow-popover",
          )}
        >
          <ul
            ref={refDaftar}
            role="listbox"
            aria-label={`Saran ${label}`}
            onKeyDown={panahAntarSaran}
            className="max-h-80 overflow-y-auto"
          >
            {saran.map((orang) => (
              <li key={orang.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  data-saran=""
                  onClick={() => buka(orang.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                    "transition-colors duration-150 ease-standar hover:bg-muted",
                    "focus-visible:bg-muted focus-visible:outline focus-visible:outline-2",
                    "focus-visible:-outline-offset-2 focus-visible:outline-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-foreground">
                      {orang.nama}
                    </span>
                    <span className="block truncate text-mikro font-normal text-muted-foreground">
                      {orang.personnelNumber}
                      {orang.keterangan ? ` · ${orang.keterangan}` : ""}
                    </span>
                  </span>
                  {orang.status === "nonaktif" ? (
                    <StatusLabel nada="netral">Nonaktif</StatusLabel>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {kosong ? (
            <p className="px-4 py-3 text-pendukung text-muted-foreground">
              {kosong}
            </p>
          ) : null}
          {catatan ? (
            <p className="border-t border-border px-4 py-2 text-mikro font-normal text-muted-foreground">
              {catatan}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
