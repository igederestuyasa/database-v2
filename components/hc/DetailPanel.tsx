import * as React from "react";

import { cn } from "@/lib/utils";
import GenerativeIcon from "./GenerativeIcon";

/**
 * Panel detail HC Panel — docs/DESIGN.md §Pola daftar-detail.
 *
 * TINGGI ISI DIPATOK. Isinya kolom flex ber-`min-height` tetap supaya area
 * aksi di bawah tidak berpindah-pindah saat kursor berjalan dari item yang
 * datanya lengkap ke item yang datanya sedikit. Tombol yang melompat saat
 * hendak diklik adalah tombol yang salah pencet.
 *
 * IKON DIRAKIT ULANG. Pemanggil tidak perlu ingat: `key` pada ikon dan pada
 * pembungkus isi memakai nama item, jadi setiap pergantian item memasang
 * ulang keduanya — animasi masuk panel dan perakitan ikon jalan bersama.
 */
export type BarisDetail = {
  label: string;
  /** Sudah diformat. Baris tanpa isi tidak dikirim ke sini. */
  nilai: React.ReactNode;
};

export type DetailPanelProps = {
  /** Nama entitasnya, untuk label kepala: "Detail Karyawan". */
  entitas: string;
  /** Nama item terpilih. `null` berarti belum ada yang bisa ditampilkan. */
  nama: string | null;
  /** Kategori item — tipe unit, tipe Lookup, jenis Batch. */
  kategori?: string | null;
  /** Label status, biasanya `<StatusLabel>`. */
  status?: React.ReactNode;
  deskripsi?: string | null;
  baris?: readonly BarisDetail[];
  /** Tombol utama selebar panel, atau catatan putus-putus. */
  aksi?: React.ReactNode;
  rencana?: boolean;
  /** Kalimat saat belum ada item terpilih. */
  pesanKosong?: string;
  className?: string;
};

export function DetailPanel({
  entitas,
  nama,
  kategori,
  status,
  deskripsi,
  baris,
  aksi,
  rencana = false,
  pesanKosong,
  className,
}: DetailPanelProps) {
  const terisi = React.useMemo(
    () => (baris ?? []).filter((satu) => satu.nilai !== null && satu.nilai !== ""),
    [baris],
  );

  return (
    <section
      aria-label={`Detail ${entitas}`}
      className={cn(
        "hc-permukaan rounded-panel border border-border bg-card p-6",
        className,
      )}
    >
      <header>
        <p className="text-label font-[650] text-foreground">Detail {entitas}</p>
        <p className="mt-1 text-pendukung text-muted-foreground">
          Arahkan kursor ke item untuk melihat detailnya.
        </p>
      </header>

      <hr className="my-4 border-border" />

      {/* min-h 460: tinggi susunan di docs/DESIGN.md, penjaga posisi tombol. */}
      <div
        key={nama ?? "__kosong__"}
        className="flex min-h-[28.75rem] animate-panel-masuk flex-col"
      >
        {nama === null ? (
          <p className="text-pendukung text-muted-foreground">
            {pesanKosong ?? `Belum ada ${entitas} yang bisa ditampilkan.`}
          </p>
        ) : (
          <>
            <GenerativeIcon key={nama} nama={nama} ukuran={96} rencana={rencana} />

            {kategori || status ? (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-pendukung font-medium text-muted-foreground">
                {kategori}
                {status}
              </p>
            ) : null}

            <h2 className="mt-2 text-judul-panel text-foreground">{nama}</h2>

            {deskripsi ? (
              <p className="mt-2 text-isi text-muted-foreground">{deskripsi}</p>
            ) : null}

            {terisi.length > 0 ? (
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-pendukung">
                {terisi.map((satu) => (
                  <React.Fragment key={satu.label}>
                    <dt className="text-muted-foreground">{satu.label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium text-foreground">
                      {satu.nilai}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
          </>
        )}

        {aksi ? <div className="mt-auto pt-8">{aksi}</div> : null}
      </div>
    </section>
  );
}

/**
 * Pengganti tombol untuk item yang belum tersedia — docs/DESIGN.md meminta
 * catatan berbingkai putus-putus, bukan tombol yang tidak bisa ditekan.
 */
export function CatatanPanel({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-kartu border border-dashed border-garis-putus px-4 py-3 text-center text-pendukung text-muted-foreground">
      {children}
    </p>
  );
}

export default DetailPanel;
