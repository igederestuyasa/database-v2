"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { UI } from "@/lib/i18n/terms";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Page name, e.g. "Karyawan" — shown so the user knows what failed. */
  judul?: string;
};

/**
 * Shared error boundary UI. Every route ships an `error.tsx` that renders this,
 * so an unreachable database degrades to a readable page with a retry button
 * instead of an unrenderable 500.
 */
export default function RouteError({ error, reset, judul }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h2 className="text-lg font-semibold">
        {judul ? `Gagal memuat ${judul}` : UI.gagalMemuat}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Terjadi kesalahan saat mengambil data. Coba lagi; kalau tetap gagal,
        laporkan pesan di bawah ini.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
        {error.message}
        {error.digest ? `\n(digest: ${error.digest})` : ""}
      </pre>
      <Button className="mt-6" onClick={reset}>
        {UI.cobaLagi}
      </Button>
    </div>
  );
}
