/**
 * The top of the Karyawan detail page: who this is, at a glance.
 *
 * Two things it must get right:
 *
 *   * **A nonaktif Karyawan still renders, and says so.** Nothing is ever
 *     deleted in HC Core (PRD §6 Non-Goals, CONTEXT.md "Status Karyawan"), so
 *     this page has to work for someone who left in 2019. The status is a
 *     badge next to the name and a note under it with the Tanggal Keluar —
 *     including when that date was never filled in, which is worth saying out
 *     loud rather than hiding.
 *   * **"Ubah" only for an admin.** A viewer reads (ARCHITECTURE.md §5). The
 *     Server Action behind the form checks the role again, and so does RLS;
 *     this only decides whether the link is drawn.
 */
import Link from "next/link";

import { formatTanggal } from "@/components/revisions/revisionDiff";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TERMS, UI } from "@/lib/i18n/terms";
import type { VEmployee } from "@/lib/types/db";
import { cn } from "@/lib/utils";

import { labelStatus, rantaiUnit } from "./employeeDetailFields";

export type EmployeeHeaderProps = {
  employee: VEmployee;
  isAdmin: boolean;
};

/** Personnel Number · NIP · Jabatan — the one-line identity under the name. */
function baris(employee: VEmployee): string {
  return [
    `${TERMS.personnelNumber} ${employee.personnel_number}`,
    employee.nip ? `${TERMS.nip} ${employee.nip}` : null,
    employee.jabatan_nama,
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

export default function EmployeeHeader({
  employee,
  isAdmin,
}: EmployeeHeaderProps) {
  const nonaktif = employee.status === "nonaktif";
  const tanggalKeluar = employee.tanggal_keluar
    ? formatTanggal(employee.tanggal_keluar)
    : null;

  return (
    <header className="space-y-4">
      <Link
        href="/karyawan"
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Kembali ke daftar {TERMS.karyawan}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {employee.full_name}
            </h1>
            <Badge variant={nonaktif ? "secondary" : "default"}>
              {labelStatus(employee.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{baris(employee)}</p>
          <p className="text-sm text-muted-foreground">{rantaiUnit(employee)}</p>
        </div>

        {isAdmin ? (
          <Link
            href={`/karyawan/${employee.id}/edit`}
            className={cn(buttonVariants(), "shrink-0")}
          >
            {UI.ubah} data {TERMS.karyawan}
          </Link>
        ) : null}
      </div>

      {nonaktif ? (
        <div className="rounded-md border bg-muted/40 p-4 text-sm">
          <p className="font-medium">
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
