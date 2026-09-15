"use client";

/**
 * Satu-satunya pemilik navigasi di halaman daftar Karyawan.
 *
 * Filter, urutan, dan penomoran halaman sama-sama menulis URL, dan ketiganya
 * harus memakai transisi yang sama: kalau masing-masing memegang
 * `useTransition()` sendiri, mengganti filter membuat tabel tetap terlihat
 * "selesai" sambil menampilkan baris hasil filter yang lama. Di sini satu
 * `pending` menutupi semuanya — tabel berkata sedang memuat, kontrol filter
 * terkunci, dan tidak ada yang tampak seperti jawaban yang sudah benar padahal
 * belum.
 *
 * Isi kotak pencarian juga tinggal di sini, karena setiap perpindahan harus
 * membawanya. Kalau teks yang sudah terketik dibiarkan menggantung di komponen
 * filter, mengganti urutan atau berpindah halaman akan menampilkan daftar yang
 * tidak pernah disaring namanya — sementara kotaknya masih berbunyi "budi".
 *
 * Komponen ini sengaja tipis: bentuk URL diputuskan `karyawanFilters.ts` (modul
 * biasa, dipakai juga oleh Server Component), tampilannya oleh dua komponen di
 * bawahnya.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import type { EntityOption } from "@/components/shared/entityOptions";
import type { LookupType } from "@/lib/validation/lookupTypes";

import KaryawanFilterBar from "./KaryawanFilterBar";
import KaryawanTable from "./KaryawanTable";
import {
  FILTER_KOSONG,
  karyawanHref,
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
  /** Pesan pengganti saat tabel kosong karena sesuatu gagal, bukan karena nihil. */
  pesanKosong?: string;
  unitOptions: EntityOption[];
  jabatanOptions: EntityOption[];
  lookupOptions: Record<LookupType, EntityOption[]>;
};

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
}: KaryawanClientProps) {
  const router = useRouter();
  const [pending, mulai] = React.useTransition();

  // Kotak pencarian dikirim dengan Enter, tombol Cari, atau perubahan filter
  // apa pun — bukan setiap ketukan tombol, yang berarti satu navigasi per huruf
  // dan urutan jawaban yang bisa saling mendahului. Disamakan lagi dengan URL
  // kalau URL-nya berubah dari luar (tombol Back, tautan dari halaman lain).
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

  /** Bersihkan semua filter, termasuk teks yang belum sempat dikirim. */
  const bersihkan = React.useCallback(() => {
    setTeks("");
    mulai(() => {
      // Urutan bukan filter (`hitungFilterAktif` tidak menghitungnya), jadi
      // tombol yang berjanji membersihkan N filter tidak boleh diam-diam
      // mengembalikan urutan yang dipilih pemakainya.
      router.push(karyawanHref({ ...FILTER_KOSONG, sort: filters.sort }));
    });
  }, [router, filters.sort]);

  const bukaDetail = React.useCallback(
    (id: string) => {
      mulai(() => {
        router.push(`/karyawan/${id}`);
      });
    },
    [router],
  );

  return (
    <div className="space-y-4">
      <KaryawanFilterBar
        filters={filters}
        unitOptions={unitOptions}
        jabatanOptions={jabatanOptions}
        lookupOptions={lookupOptions}
        teks={teks}
        setTeks={setTeks}
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
      />
    </div>
  );
}

export default KaryawanClient;
