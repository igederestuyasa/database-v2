import type { Metadata } from "next";
import Link from "next/link";

import EmployeeForm from "@/components/forms/EmployeeForm";
import DaftarTerpotongAlert from "@/components/shared/DaftarTerpotongAlert";
import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/lib/auth/session";
import { loadReferenceOptions } from "@/lib/db/referenceOptions";
import { TERMS, UI } from "@/lib/i18n/terms";

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

  const options = await loadReferenceOptions(client);

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

      <DaftarTerpotongAlert
        daftar={options.terpotong}
        judul="Daftar pilihan belum lengkap."
        keterangan="Ada pilihan yang benar-benar ada tetapi tidak muncul di daftar. Jangan menyimpulkan sebuah nilai «belum ada» dari daftar ini sampai batas itu dinaikkan."
      />

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
