import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import EmployeeForm from "@/components/forms/EmployeeForm";
import EmployeePrivateForm from "@/components/forms/EmployeePrivateForm";
import EmployeeStatusDialog from "@/components/forms/EmployeeStatusDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePageSession } from "@/lib/auth/session";
import { getEmployeePrivate, getEmployeeRowById } from "@/lib/db/employees";
import { TERMS, UI } from "@/lib/i18n/terms";
import { uuidField } from "@/lib/validation/common";

// Modul ini duduk di folder `baru/` karena kedua halaman form — tambah dan
// ubah — memakainya, dan keduanya milik unit yang sama.
import { loadEmployeeFormOptions } from "../../baru/employeeFormOptions";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ubah Karyawan" };

type PageProps = { params: Promise<{ id: string }> };

/**
 * Ubah Karyawan (PRD #4), menonaktifkan/mengaktifkan (PRD #5), dan Data
 * Pribadi Sensitif (PRD #22) — tiga form yang sengaja terpisah.
 *
 * Yang dibaca di sini adalah baris `employees` **mentah** lewat
 * `getEmployeeRowById()`, bukan `v_employees`: form mengisi FK id ke dalam
 * picker, dan label dari view justru bukan yang dibutuhkan. `v_employees_private`
 * juga tidak pernah dibaca — INNER JOIN-nya membuat viewer menerima nol baris
 * alih-alih kolom NULL, jadi bagian sensitifnya dibaca terpisah dengan
 * `getEmployeePrivate()` (ADR-005 §10).
 */
export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const { client, user } = await requirePageSession(`/karyawan/${id}/edit`);

  // Id yang bukan uuid tidak perlu sampai ke database: PostgREST akan
  // menjawabnya sebagai error sintaks, dan "22P02" bukan kalimat yang pantas
  // dibaca staf HC untuk sesuatu yang sebenarnya cuma "halaman tidak ada".
  // Halaman "tidak ditemukan"-nya benar, status HTTP-nya 200 — `loading.tsx`
  // sudah mengalirkan kerangka halaman sebelum baris ini jalan. Disengaja,
  // diukur, dan dijelaskan di docs/adr/ADR-007.
  if (!uuidField("Karyawan").safeParse(id).success) notFound();

  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ubah {TERMS.karyawan}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{UI.hanyaAdmin}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda masuk sebagai {TERMS.viewer}, jadi hanya bisa membaca data{" "}
          {TERMS.karyawan}.
        </p>
        <Button asChild className="mt-6">
          <Link href={`/karyawan/${id}`}>Lihat detail {TERMS.karyawan}</Link>
        </Button>
      </div>
    );
  }

  const employee = await getEmployeeRowById(client, id);
  if (!employee) notFound();

  const [options, privateData] = await Promise.all([
    loadEmployeeFormOptions(client),
    getEmployeePrivate(client, id),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/karyawan/${employee.id}`} className="hover:underline">
            &larr; {employee.full_name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ubah {TERMS.karyawan}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {TERMS.personnelNumber} {employee.personnel_number}. Setiap
          penyimpanan tercatat sebagai {TERMS.revisi} — siapa, kapan, dan kolom
          apa yang bergerak — dan bisa dikembalikan lewat Log Perubahan.
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
            yang benar-benar ada tetapi tidak muncul di daftar — termasuk,
            mungkin, yang sedang dipakai {TERMS.karyawan} ini. Periksa dulu
            sebelum menyimpan.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{TERMS.statusKaryawan}</CardTitle>
          <CardDescription>
            Status dan tanggal keluar diatur di sini, bukan di form di bawah,
            supaya keduanya tidak pernah berbeda cerita (PRD #5).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmployeeStatusDialog
            employee={{
              id: employee.id,
              full_name: employee.full_name,
              status: employee.status,
              tanggal_keluar: employee.tanggal_keluar,
              keterangan: employee.keterangan,
            }}
          />
        </CardContent>
      </Card>

      <EmployeeForm
        mode="ubah"
        // Kunci per id: berpindah dari satu Karyawan ke Karyawan lain tanpa
        // memuat ulang tidak boleh meninggalkan isian orang sebelumnya.
        key={employee.id}
        employee={employee}
        options={{
          orgUnit: options.orgUnit,
          jabatan: options.jabatan,
          lookup: options.lookup,
        }}
      />

      <EmployeePrivateForm
        key={`private-${employee.id}`}
        employeeId={employee.id}
        privateData={privateData}
      />
    </div>
  );
}
