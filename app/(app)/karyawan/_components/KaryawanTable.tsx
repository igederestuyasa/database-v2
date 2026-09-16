"use client";

/**
 * Tabel daftar Karyawan (PRD #2).
 *
 * `DataTable` dipakai dalam **mode server**: satu halaman hasil query dikirim
 * ke sini apa adanya, dan tabel hanya menggambarnya. Dua hal yang sengaja tidak
 * dikerjakan di sisi klien, karena keduanya akan berbohong tentang cakupannya:
 *
 *   * **Pencarian** — sudah dimatikan `DataTable` sendiri di mode server; kotak
 *     pencarian yang sesungguhnya ada di `KaryawanFilterBar` dan bekerja di
 *     query, atas ±1.500 Karyawan, bukan atas 50 baris yang terlihat.
 *   * **Pengurutan** — setiap kolom di sini `enableSorting: false`. Kalau
 *     dibiarkan menyala, mengklik "Nama" hanya mengurutkan halaman yang sedang
 *     dibuka sambil tampak seperti mengurutkan seluruh daftar; orang yang
 *     mencari "A" paling atas justru akan yakin sudah melihatnya. Urutan
 *     dipilih lewat menu Urutkan di bawah, masuk ke URL, dan dikerjakan
 *     `listEmployees()` atas seluruh hasil filter.
 *
 * Setiap baris menuju `/karyawan/[id]`. Baris bisa diklik, dan nama tetap
 * berupa tautan sungguhan supaya pengguna keyboard dan "buka di tab baru"
 * tetap bekerja.
 */
import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import StatusLabel from "@/components/hc/StatusLabel";
import Tombol from "@/components/hc/Tombol";
import type { DaftarDetail } from "@/components/hc/useDaftarDetail";
import { DataTable } from "@/components/shared/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KOSONG } from "@/lib/derived";
import { STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";

import {
  SORT_OPTIONS,
  ubahFilter,
  type KaryawanFilters,
  type SortValue,
} from "./karyawanFilters";
import type { KaryawanRow } from "./karyawanRows";

export type KaryawanTableProps = {
  rows: KaryawanRow[];
  filters: KaryawanFilters;
  /** Halaman yang benar-benar dikembalikan query, bukan yang diminta URL. */
  page: number;
  perPage: number;
  /** Jumlah seluruh Karyawan yang cocok, dari hitungan exact PostgREST. */
  total: number;
  /** Admin boleh menambah Karyawan (PRD #3); viewer hanya membaca. */
  isAdmin: boolean;
  /**
   * Pesan pengganti saat tabel kosong bukan karena tidak ada yang cocok.
   * Halaman memakainya ketika filternya sendiri gagal diterapkan — "tidak ada
   * yang cocok" untuk query yang tidak pernah jalan adalah jawaban yang salah.
   */
  pesanKosong?: string;
  pindah: (filters: KaryawanFilters) => void;
  /** Buka halaman detail satu Karyawan (unit B2). */
  bukaDetail: (id: string) => void;
  pending: boolean;
  /** Pola daftar-detail: sorot baris, panah antarbaris, penanda terpilih. */
  daftarDetail: DaftarDetail<KaryawanRow>;
};

/** Sel kosong selalu tampil sebagai tanda yang sama (`lib/derived`). */
function teks(nilai: string | null | undefined): string {
  return nilai && nilai.trim() !== "" ? nilai : KOSONG;
}

export function KaryawanTable({
  rows,
  filters,
  page,
  perPage,
  total,
  isAdmin,
  pesanKosong,
  pindah,
  bukaDetail,
  pending,
  daftarDetail,
}: KaryawanTableProps) {
  /**
   * Delapan kolom tidak muat berdampingan dengan panel detail, dan tabel yang
   * terpotong diam-diam lebih buruk daripada tabel yang lebih ringkas: kolom
   * yang hilang di balik tepi kartu tidak memberi tanda apa pun bahwa ia ada.
   *
   * Jadi saat panel terlihat, tabel menyisakan kolom yang dipakai untuk MEMILIH
   * baris — Personnel Number, Nama, Unit Organisasi, Status — dan kolom yang
   * dipakai untuk MEMBACA satu orang pindah ke panel di sebelahnya, tempat
   * keempatnya memang sudah ditampilkan. Di bawah 1280px panelnya tidak ada,
   * dan kedelapan kolom kembali utuh.
   */
  const panelTerlihat = daftarDetail.panelTerlihat;

  const columns = React.useMemo<ColumnDef<KaryawanRow>[]>(() => {
    const semua: ColumnDef<KaryawanRow>[] = [
      {
        accessorKey: "personnelNumber",
        header: TERMS.personnelNumber,
        enableSorting: false,
        meta: { angka: true },
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.personnelNumber}</span>
        ),
      },
      {
        accessorKey: "nama",
        header: "Nama",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/karyawan/${row.original.id}`}
            // Barisnya sudah bisa diklik; tanpa ini satu klik pada tautan
            // menjalankan dua navigasi ke alamat yang sama.
            onClick={(event) => event.stopPropagation()}
            className="font-medium underline-offset-2 hover:underline"
            /* Barisnya sendiri sudah bisa difokus dan dibuka lewat Enter;
               tautan ini tidak perlu jadi perhentian Tab kedua untuk tujuan
               yang sama. */
            tabIndex={-1}
          >
            {row.original.nama}
          </Link>
        ),
      },
      {
        accessorKey: "nip",
        // Pindah ke panel detail saat panel terlihat — lihat catatan di atas.
        id: "sekunder-" + 'nip',
        header: TERMS.nip,
        enableSorting: false,
        meta: { angka: true },
        cell: ({ row }) => (
          <span className="tabular-nums">{teks(row.original.nip)}</span>
        ),
      },
      {
        accessorKey: "unitNama",
        header: TERMS.unitOrganisasi,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <span className="block">{teks(row.original.unitNama)}</span>
            {row.original.unitInduk ? (
              <span className="block text-mikro font-normal text-muted-foreground">
                {row.original.unitInduk}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "jabatanNama",
        // Pindah ke panel detail saat panel terlihat — lihat catatan di atas.
        id: "sekunder-" + 'jabatanNama',
        header: TERMS.jabatan,
        enableSorting: false,
        cell: ({ row }) => teks(row.original.jabatanNama),
      },
      {
        accessorKey: "personGrade",
        // Pindah ke panel detail saat panel terlihat — lihat catatan di atas.
        id: "sekunder-" + 'personGrade',
        header: "Person Grade",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{teks(row.original.personGrade)}</span>
        ),
      },
      {
        accessorKey: "jobGrade",
        // Pindah ke panel detail saat panel terlihat — lihat catatan di atas.
        id: "sekunder-" + 'jobGrade',
        header: "Job Grade",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{teks(row.original.jobGrade)}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusLabel nada={row.original.status === "aktif" ? "sukses" : "netral"}>
            {STATUS_LABELS[row.original.status]}
          </StatusLabel>
        ),
      },
    ];

    return semua.filter(
      (kolom) => !(panelTerlihat && kolom.id?.startsWith("sekunder-")),
    );
  }, [panelTerlihat]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={pending}
      emptyMessage={
        pesanKosong ?? `Tidak ada ${TERMS.karyawan} yang cocok dengan filter ini.`
      }
      onRowClick={(row) => bukaDetail(row.id)}
      propsDaftar={daftarDetail.propsDaftar()}
      /* Baris jadi perhentian Tab dan bisa dibuka dengan Enter, supaya aksi
         utama item terjangkau tanpa tetikus. Panah antarbaris ditangani
         `propsDaftar` di atas. */
      propsBaris={(row) => ({
        ...daftarDetail.propsItem(row),
        tabIndex: 0,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          bukaDetail(row.id);
        },
      })}
      pagination={{
        page,
        perPage,
        total,
        onPageChange: (halaman) => pindah(ubahFilter(filters, { page: halaman })),
      }}
      toolbar={
        <>
          <Select
            value={filters.sort}
            onValueChange={(nilai) =>
              pindah(ubahFilter(filters, { sort: nilai as SortValue }))
            }
            disabled={pending}
          >
            <SelectTrigger className="h-11 w-[210px] text-isi" aria-label="Urutkan daftar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin ? (
            <Tombol asChild className="ml-auto">
              <Link href="/karyawan/baru">
                {UI.tambah} {TERMS.karyawan}
              </Link>
            </Tombol>
          ) : (
            <span className="ml-auto text-mikro font-normal text-muted-foreground">
              {UI.hanyaAdmin}
            </span>
          )}
        </>
      }
    />
  );
}

export default KaryawanTable;
