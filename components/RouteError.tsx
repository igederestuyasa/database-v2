"use client";

import { useEffect } from "react";

import Tombol from "@/components/hc/Tombol";
import { UI } from "@/lib/i18n/terms";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Page name, e.g. "Karyawan" — shown so the user knows what failed. */
  judul?: string;
};

/**
 * `error.message` is shown only outside production.
 *
 * In production Next already replaces a server error's message with a generic
 * one and keeps only `digest`, but a preview deployment or `next dev` hands
 * the real text over — and a PostgREST message names tables, constraints and
 * sometimes values. The digest is what staf HC reports and what the server log
 * is searched by, so it is always shown.
 */
const TAMPILKAN_PESAN = process.env.NODE_ENV !== "production";

/**
 * Shared error boundary UI. Every route ships an `error.tsx` that renders this,
 * so an unreachable database degrades to a readable page with a retry button
 * instead of an unrenderable 500.
 */
export default function RouteError({ error, reset, judul }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const kode = error.digest ? `Kode: ${error.digest}` : null;

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h2 className="text-judul-bagian text-foreground">
        {judul ? `Gagal memuat ${judul}` : UI.gagalMemuat}
      </h2>
      <p className="mt-2 text-pendukung text-muted-foreground">
        Terjadi kesalahan saat mengambil data. Coba lagi; kalau tetap gagal,
        laporkan {kode ? "kode" : "keterangan"} di bawah ini ke admin HC Core.
      </p>
      {kode || TAMPILKAN_PESAN ? (
        <pre className="mt-4 overflow-x-auto rounded-bidang border border-border bg-muted p-3 text-left text-mikro font-normal text-muted-foreground">
          {TAMPILKAN_PESAN ? error.message : null}
          {TAMPILKAN_PESAN && kode ? "\n" : null}
          {kode}
        </pre>
      ) : null}
      <Tombol className="mt-6" onClick={reset}>
        {UI.cobaLagi}
      </Tombol>
    </div>
  );
}
