"use client";

import * as React from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";
import Logo from "@/components/hc/Logo";
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
 * MEMEGANG IDENTITAS APP. Di desktop tidak ada lagi bar atas: logo dan nama
 * app pindah ke kepala sidebar ini, sejajar dengan tujuan-tujuan di bawahnya,
 * dan sidebar menempel penuh setinggi layar. Bar atas tinggal untuk layar
 * sempit, tempat sidebar ini memang tidak dirender.
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
        "sticky top-0 hidden h-screen shrink-0",
        "flex-col border-r border-border lg:flex",
        "transition-[width] duration-200 ease-standar",
        ciut ? "w-20" : "w-64",
      )}
    >
      {/*
        Kepala sidebar: identitas app, lalu tombol ciut.

        Tombolnya di ATAS, bukan di kaki bersama blok akun. Ciut/lebar adalah
        pengaturan navigasi, dan tempatnya di dekat yang diaturnya; di kaki ia
        duduk bersebelahan dengan Keluar — dua tombol berdampingan yang satu
        mengubah tampilan dan satu lagi mengakhiri sesi, dan yang salah pencet
        di antaranya mahal.

        Tanpa kata "Ciutkan": ikon panel dengan panah sudah dipakai di
        mana-mana untuk hal yang sama persis, dan `title` plus `aria-expanded`
        tetap mengatakannya untuk yang membutuhkan.
      */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-border p-4",
          // Di 80px, logo 28px dan tombol 44px tidak muat bersebelahan.
          ciut ? "flex-col" : "h-[4.5rem] flex-row",
        )}
      >
        <Link
          href="/karyawan"
          title={ciut ? "HC Core" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-full",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          )}
        >
          <Logo ukuran={28} />
          <span
            className={cn(
              "truncate text-isi font-bold text-foreground",
              ciut && "sr-only",
            )}
          >
            HC Core
          </span>
        </Link>

        <Tombol
          type="button"
          nada="halus"
          ukuran="ringkas"
          onClick={ubahCiut}
          aria-expanded={!ciut}
          className={cn("w-11 px-0", ciut ? "mt-1" : "ml-auto")}
          title={ciut ? "Lebarkan sidebar" : "Ciutkan sidebar"}
        >
          {ciut ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
          <span className="sr-only">
            {ciut ? "Lebarkan sidebar" : "Ciutkan sidebar"}
          </span>
        </Tombol>
      </div>

      {/* Satu-satunya bagian yang boleh digulir. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SidebarNav items={items} ciut={ciut} />
      </div>

      <div className="shrink-0 border-t border-border p-4">
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
