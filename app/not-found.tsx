import Link from "next/link";

import Logo from "@/components/hc/Logo";
import Tombol from "@/components/hc/Tombol";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-5 py-12 text-center">
      <Logo ukuran={48} />
      <div className="space-y-3">
        <h1 className="text-balance text-judul-halaman text-foreground">
          Halaman tidak ditemukan
        </h1>
        <p className="mx-auto max-w-subjudul text-subjudul text-muted-foreground">
          Alamat yang Anda buka tidak ada di HC Core.
        </p>
      </div>
      <Tombol asChild>
        <Link href="/karyawan">Kembali ke Karyawan</Link>
      </Tombol>
    </main>
  );
}
