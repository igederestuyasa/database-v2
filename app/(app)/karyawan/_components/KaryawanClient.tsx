"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import DetailPanel from "@/components/hc/DetailPanel";
import FilterTabs from "@/components/hc/FilterTabs";
import PembukaLayar from "@/components/hc/PembukaLayar";
import StatusLabel from "@/components/hc/StatusLabel";
import TataLetakDaftarDetail from "@/components/hc/TataLetakDaftarDetail";
import Tombol from "@/components/hc/Tombol";
import useDaftarDetail from "@/components/hc/useDaftarDetail";
import type { EntityOption } from "@/lib/entityOptions";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import type { LookupType } from "@/lib/validation/lookupTypes";

import KaryawanFilterBar from "./KaryawanFilterBar";
import SaranCari from "./SaranCari";
import KaryawanTable from "./KaryawanTable";
import {
  bersihkanFilter,
  karyawanHref,
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  ubahFilter,
  type KaryawanFilters,
} from "./karyawanFilters";
import type { KaryawanRow } from "./karyawanRows";

export type KaryawanClientProps = {
  rows: KaryawanRow[];
  filters: KaryawanFilters;
  page: number;
  perPage: number;
  total: number;
  isAdmin: boolean;
  pesanKosong?: string;
  unitOptions: EntityOption[];
  jabatanOptions: EntityOption[];
  lookupOptions: Record<LookupType, EntityOption[]>;
  /** Peringatan dari halaman — daftar terpotong, filter hierarki gagal. */
  peringatan?: React.ReactNode;
};

/** Baris deskripsi di kartu dan panel: unit terendah lalu rantai induknya. */
function tempat(row: KaryawanRow): string | null {
  return [row.unitNama, row.unitInduk].filter(Boolean).join(" · ") || null;
}

export function KaryawanClient({
  rows,
  filters,
  page,
  perPage,
  total,
  isAdmin,
  pesanKosong,
  unitOptions,
  jabatanOptions,
  lookupOptions,
  peringatan,
}: KaryawanClientProps) {
  const router = useRouter();
  const [pending, mulai] = React.useTransition();
  const [teks, setTeks] = React.useState(filters.q ?? "");

  React.useEffect(() => {
    setTeks(filters.q ?? "");
  }, [filters.q]);

  const pindah = React.useCallback(
    (berikutnya: KaryawanFilters) => {
      mulai(() => {
        router.push(karyawanHref({ ...berikutnya, q: teks.trim() || null }));
      });
    },
    [router, teks],
  );

  const bersihkan = React.useCallback(() => {
    setTeks("");
    mulai(() => {
      router.push(karyawanHref(bersihkanFilter(filters)));
    });
  }, [router, filters]);

  const bukaDetail = React.useCallback(
    (id: string) => {
      mulai(() => {
        router.push(`/karyawan/${id}`);
      });
    },
    [router],
  );

  /**
   * Pola daftar-detail. `kunciPencarian` diisi kata kunci yang SUDAH dijalankan
   * server (`filters.q`), bukan yang sedang diketik: daftar di layar masih
   * milik kata kunci lama sampai halamannya kembali, dan memindahkan panel
   * lebih dulu hanya menyorot baris yang sebentar lagi hilang.
   */
  const dd = useDaftarDetail({
    items: rows,
    idDari: (row) => row.id,
    kunciPencarian: filters.q ?? "",
  });

  const terpilih = dd.terpilih;

  return (
    <TataLetakDaftarDetail
      panelTerlihat={dd.panelTerlihat}
      pembuka={
        <PembukaLayar
          salam="Database central HC"
          judul={TERMS.karyawan}
          info={`Cari berdasarkan nama, ${TERMS.nip}, atau ${TERMS.personnelNumber}, lalu persempit dengan filter. Filter tersimpan di alamat halaman.`}
        >
          <SaranCari
            id="cari-karyawan"
            label={`${UI.cari} ${TERMS.karyawan}`}
            nilai={teks}
            onNilaiChange={setTeks}
            placeholder={`Nama, ${TERMS.nip}, atau ${TERMS.personnelNumber}`}
            disabled={pending}
            /* Enter menjalankan PENCARIAN, bukan membuka hasil teratas seperti
               di docs/DESIGN.md: daftar ini disaring di server, jadi hasil
               teratas untuk kata yang baru diketik belum ada sampai
               pencariannya jalan. Yang menjembatani jeda itu daftar saran di
               `SaranCari` — menekan salah satunya langsung membuka orangnya.
               Panah bawah tanpa saran terbuka tetap masuk ke baris tabel. */
            onSubmit={() => pindah(ubahFilter(filters, {}))}
            onPanahBawahDaftar={dd.fokusItemPertama}
          />
        </PembukaLayar>
      }
      panel={
        <DetailPanel
          entitas={TERMS.karyawan}
          nama={terpilih?.nama ?? null}
          kategori={terpilih?.jabatanNama ?? null}
          status={
            terpilih ? (
              <StatusLabel
                nada={terpilih.status === "aktif" ? "sukses" : "netral"}
              >
                {STATUS_LABELS[terpilih.status]}
              </StatusLabel>
            ) : null
          }
          deskripsi={terpilih ? tempat(terpilih) : null}
          baris={
            terpilih
              ? [
                  {
                    label: TERMS.personnelNumber,
                    nilai: terpilih.personnelNumber,
                  },
                  { label: TERMS.nip, nilai: terpilih.nip },
                  { label: TERMS.unitOrganisasi, nilai: terpilih.unitNama },
                  { label: TERMS.jabatan, nilai: terpilih.jabatanNama },
                  { label: "Person Grade", nilai: terpilih.personGrade },
                  { label: "Job Grade", nilai: terpilih.jobGrade },
                ]
              : undefined
          }
          pesanKosong={`Tidak ada ${TERMS.karyawan} yang cocok dengan filter ini.`}
          aksi={
            terpilih ? (
              <Tombol
                ukuran="panel"
                onClick={() => bukaDetail(terpilih.id)}
                disabled={pending}
              >
                Buka detail {TERMS.karyawan}
              </Tombol>
            ) : null
          }
        />
      }
    >
      <div className="space-y-6">
        {peringatan}

        <FilterTabs
          label={`${UI.filter} status ${TERMS.karyawan}`}
          aktif={filters.status}
          items={STATUS_FILTERS.map((nilai) => ({
            nilai,
            label: STATUS_FILTER_LABELS[nilai],
          }))}
          onPilih={(nilai) =>
            pindah(
              ubahFilter(filters, {
                status: nilai as KaryawanFilters["status"],
              }),
            )
          }
        />

        <KaryawanFilterBar
          filters={filters}
          unitOptions={unitOptions}
          jabatanOptions={jabatanOptions}
          lookupOptions={lookupOptions}
          pindah={pindah}
          bersihkan={bersihkan}
          pending={pending}
        />

        <KaryawanTable
          rows={rows}
          filters={filters}
          page={page}
          perPage={perPage}
          total={total}
          isAdmin={isAdmin}
          pesanKosong={pesanKosong}
          pindah={pindah}
          bukaDetail={bukaDetail}
          pending={pending}
          daftarDetail={dd}
        />
      </div>
    </TataLetakDaftarDetail>
  );
}

export default KaryawanClient;
