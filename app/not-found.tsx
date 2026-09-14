import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Alamat yang Anda buka tidak ada di HC Core.
      </p>
      <Button asChild>
        <Link href="/karyawan">Kembali ke Karyawan</Link>
      </Button>
    </main>
  );
}
