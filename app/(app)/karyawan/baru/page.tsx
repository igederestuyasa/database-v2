import type { Metadata } from "next";
import Link from "next/link";

import EmployeeForm from "@/components/forms/EmployeeForm";
import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/lib/auth/session";
import { TERMS, UI } from "@/lib/i18n/terms";

import { loadEmployeeFormOptions } from "./employeeFormOptions";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tambah Karyawan" };

/**
 * Tambah Karyawan (PRD #3).
 *
 * Admin saja, diperiksa dua kali sebelum database bahkan disentuh: di sini
 * (supaya seorang viewer membaca kalimat yang jelas, bukan form yang pasti
 * gagal), dan lagi di dalam `createEmployee()`. RLS `employees_insert` adalah
 * tembok ketiganya — keduanya wajib, bukan salah satu (CLAUDE.md).
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/karyawan/baru");

  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Tambah {TERMS.karyawan}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{UI.hanyaAdmin}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda masuk sebagai {TERMS.viewer}, jadi hanya bisa membaca data{" "}
          {TERMS.karyawan}.
        </p>
        <Button asChild className="mt-6">
          <Link href="/karyawan">Kembali ke daftar {TERMS.karyawan}</Link>
        </Button>
      </div>
    );
  }

  const options = await loadEmployeeFormOptions(client);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Tambah {TERMS.karyawan}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {TERMS.personnelNumber} wajib dan unik — itulah kunci bisnis yang
          dipakai {TERMS.konsumen} untuk merujuk seseorang. Kolom referensi
          dipilih dari daftar, tidak diketik bebas, dan {TERMS.karyawan}{" "}
          menunjuk {TERMS.unitOrganisasi} terendah tempatnya ditempatkan.
        </p>
      </header>

      {options.terpotong.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">Daftar pilihan belum lengkap.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {options.terpotong.map((daftar) => (
              <li key={daftar.nama}>
                {daftar.nama}: baru {daftar.dibaca} dari {daftar.total} baris
                yang terbaca.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Database membatasi jumlah baris per permintaan, jadi ada pilihan
            yang benar-benar ada tetapi tidak muncul di daftar. Jangan
            menyimpulkan sebuah nilai &laquo;belum ada&raquo; dari daftar ini
            sampai batas itu dinaikkan.
          </p>
        </div>
      ) : null}

      <EmployeeForm
        mode="tambah"
        options={{
          orgUnit: options.orgUnit,
          jabatan: options.jabatan,
          lookup: options.lookup,
        }}
      />
    </div>
  );
}
