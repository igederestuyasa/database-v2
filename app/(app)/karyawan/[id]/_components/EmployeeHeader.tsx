import Link from "next/link";

import { formatTanggal } from "@/components/revisions/revisionDiff";
import StatusLabel from "@/components/hc/StatusLabel";
import Tombol from "@/components/hc/Tombol";
import { TERMS, UI } from "@/lib/i18n/terms";
import type { VEmployee } from "@/lib/types/db";

import { labelStatus, rantaiUnit } from "./employeeDetailFields";

export type EmployeeHeaderProps = {
  employee: VEmployee;
  isAdmin: boolean;
};

function baris(employee: VEmployee): string {
  return [
    `${TERMS.personnelNumber} ${employee.personnel_number}`,
    employee.nip ? `${TERMS.nip} ${employee.nip}` : null,
    employee.jabatan_nama,
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

/**
 * Pembuka halaman detail Karyawan.
 *
 * Nama orangnya adalah judul halaman, jadi ia memakai skala h1 HC Panel — yang
 * dicari orang saat membuka halaman ini memang "ini datanya siapa". Satu tombol
 * utama per tampilan: "Ubah data Karyawan", dan hanya untuk admin.
 */
export default function EmployeeHeader({
  employee,
  isAdmin,
}: EmployeeHeaderProps) {
  const nonaktif = employee.status === "nonaktif";
  const tanggalKeluar = employee.tanggal_keluar
    ? formatTanggal(employee.tanggal_keluar)
    : null;

  return (
    <header className="space-y-4 pt-6">
      <Link
        href="/karyawan"
        className="inline-block text-pendukung text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        ← Kembali ke daftar {TERMS.karyawan}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-balance text-judul-halaman text-foreground">
              {employee.full_name}
            </h1>
            <StatusLabel nada={nonaktif ? "netral" : "sukses"}>
              {labelStatus(employee.status)}
            </StatusLabel>
          </div>
          <p className="text-pendukung text-muted-foreground">{baris(employee)}</p>
          <p className="text-pendukung text-muted-foreground">
            {rantaiUnit(employee)}
          </p>
        </div>

        {isAdmin ? (
          <Tombol asChild className="shrink-0">
            <Link href={`/karyawan/${employee.id}/edit`}>
              {UI.ubah} data {TERMS.karyawan}
            </Link>
          </Tombol>
        ) : null}
      </div>

      {nonaktif ? (
        <div className="hc-permukaan rounded-kartu border border-border bg-card p-4 text-pendukung">
          <p className="text-label text-foreground">
            {TERMS.karyawan} ini berstatus {labelStatus(employee.status)}.
          </p>
          <p className="mt-1 text-muted-foreground">
            {tanggalKeluar
              ? `Tanggal Keluar: ${tanggalKeluar}.`
              : "Tanggal Keluar belum diisi."}{" "}
            Datanya tetap tersimpan utuh — di HC Core tidak ada data yang
            dihapus, hanya dinonaktifkan.
          </p>
        </div>
      ) : null}
    </header>
  );
}
