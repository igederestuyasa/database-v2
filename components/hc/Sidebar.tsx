"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";
import Tombol from "@/components/hc/Tombol";
import { cn } from "@/lib/utils";

/**
 * Sidebar HC Core: navigasi yang bisa digulir, blok akun yang tidak.
 *
 * DUA MASALAH YANG DIPERBAIKI DI SINI, dan keduanya soal tata letak yang sama.
 *
 * **1. Tombol Keluar dulu berhenti di tengah.** Susunannya `mt-auto` di dalam
 * kotak ber-`max-h-screen`. `max-height` bukan tinggi: kalau isinya pendek,
 * kotaknya ikut pendek, dan `margin-top: auto` tidak punya ruang sisa untuk
 * mendorong apa pun — jadi blok akun menempel persis di bawah tujuan terakhir,
 * di tengah-tengah layar. Sekarang tingginya DIPATOK `100vh` dikurangi bar
 * atas, dan blok akun benar-benar duduk di dasarnya.
 *
 * **2. Tombol Keluar ikut tergulir.** Dulu satu kotak memegang navigasi DAN
 * blok akun, dan kotak itulah yang `overflow-y-auto`. Sekarang yang bisa
 * digulir hanya bagian navigasinya (`flex-1 overflow-y-auto`); blok akun ada di
 * luar area gulir, jadi Keluar selalu ada di tempat yang sama.
 *
 * MENEMPEL DI BAWAH BAR. `top` dan tingginya dihitung dari `--tinggi-bar`, satu
 * sumber yang sama dengan bar itu sendiri — lihat `app/globals.css`.
 *
 * Client Component karena memegang satu keadaan: diciutkan atau tidak. Blok
 * akunnya tetap dirakit Server Component (`app/(app)/layout.tsx`) dan masuk ke
 * sini sebagai teks biasa, bukan komponen — batas server/klien hanya boleh
 * dilewati nilai yang bisa diserialisasi.
 */
export default function Sidebar({
  items,
  email,
  role,
}: {
  items: readonly SidebarNavItem[];
  /** `null` berarti sesi tidak terbaca; sidebar tetap dirender tanpa blok akun. */
  email: string | null;
  role: string | null;
}) {
  const [ciut, setCiut] = React.useState(false);

  /*
    Pilihan ciut diingat per peramban, dan dibaca SESUDAH render pertama.
    Membacanya saat render akan membuat HTML server dan klien berbeda —
    React melaporkannya sebagai hydration mismatch dan membuang hasil server.
    Harganya satu kedipan saat halaman dibuka dalam keadaan ciut; itu lebih
    murah daripada menghapus seluruh pohon.

    try/catch karena `localStorage` melempar, bukan mengembalikan null, di
    jendela penyamaran dan saat data situs diblokir. Sidebar tidak boleh mati
    karena sebuah preferensi tampilan.
  */
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(KUNCI_CIUT) === "1") setCiut(true);
    } catch {
      // Sengaja diam: lihat alasannya di atas.
    }
  }, []);

  const ubahCiut = () => {
    setCiut((sebelumnya) => {
      const berikutnya = !sebelumnya;
      try {
        window.localStorage.setItem(KUNCI_CIUT, berikutnya ? "1" : "0");
      } catch {
        // Sengaja diam: preferensinya hilang saat reload, sidebarnya tidak.
      }
      return berikutnya;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-[var(--tinggi-bar)] hidden h-[calc(100vh-var(--tinggi-bar))] shrink-0",
        "flex-col border-r border-border lg:flex",
        "transition-[width] duration-200 ease-standar",
        ciut ? "w-20" : "w-64",
      )}
    >
      {/* Satu-satunya bagian yang boleh digulir. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SidebarNav items={items} ciut={ciut} />
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <Tombol
          type="button"
          nada="halus"
          ukuran="ringkas"
          onClick={ubahCiut}
          aria-expanded={!ciut}
          className={cn("mb-3", ciut ? "w-11 px-0" : "w-full")}
          title={ciut ? "Lebarkan sidebar" : "Ciutkan sidebar"}
        >
          {ciut ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
          <span className={cn(ciut && "sr-only")}>
            {ciut ? "Lebarkan" : "Ciutkan"}
          </span>
        </Tombol>

        {email ? (
          <>
            {ciut ? null : (
              <>
                <p
                  className="truncate text-pendukung font-medium text-foreground"
                  title={email}
                >
                  {email}
                </p>
                {role ? (
                  <p className="text-mikro font-normal text-muted-foreground">
                    {role}
                  </p>
                ) : null}
              </>
            )}
            <SignOutButton
              className={cn("mt-3", ciut ? "w-11 px-0" : "w-full")}
              ukuran="ringkas"
              ciut={ciut}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}

/** Kunci `localStorage` untuk keadaan ciut. Per peramban, bukan per akun. */
const KUNCI_CIUT = "hc-core:sidebar-ciut";
