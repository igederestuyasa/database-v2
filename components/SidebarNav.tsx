"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  History,
  KeyRound,
  ListTree,
  Network,
  TriangleAlert,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Ikon tujuan, dipilih lewat NAMA — bukan lewat komponennya.
 *
 * Sidebar ini Client Component dan yang merakit daftarnya `app/(app)/layout.tsx`,
 * sebuah Server Component. Prop yang menyeberang batas itu harus bisa
 * diserialisasi, dan `lucide-react` tidak membawa `"use client"` sendiri: di
 * Server Component ikonnya jadi fungsi biasa, dan React menolaknya dengan
 * "Functions cannot be passed directly to Client Components". Layout melempar,
 * `app/error.tsx` mengambil alih, dan SETIAP halaman di grup ini — termasuk
 * tujuan setelah login — berubah jadi "Gagal memuat HC Core".
 *
 * Karena itu yang menyeberang cuma string, dan pemetaannya ke komponen terjadi
 * di sini, di sisi klien. Menambah tujuan berarti menambah satu baris di sini
 * dan satu di layout; TypeScript menolak nama yang tidak ada di tabel ini.
 */
const IKON = {
  orang: Users,
  jaringan: Network,
  koper: BriefcaseBusiness,
  daftar: ListTree,
  seru: TriangleAlert,
  riwayat: History,
  kunci: KeyRound,
  "atur-orang": UserCog,
} as const satisfies Record<string, LucideIcon>;

/** Nama ikon yang boleh dipakai `SidebarNavItem.ikon`. */
export type NamaIkon = keyof typeof IKON;

export type SidebarNavItem = {
  href: string;
  label: string;
  /** Ikon tujuan. Bentuknya, bukan keterangannya, yang menandai tiap tujuan. */
  ikon: NamaIkon;
};

/**
 * Navigasi utama HC Core, dalam dua bentuk dari satu daftar.
 *
 * `tegak` untuk sidebar mulai 1024px, `mendatar` untuk strip yang bisa digeser
 * di bawah bar atas pada layar sempit. Keduanya di sini supaya kedelapan tujuan
 * itu tidak pernah punya dua markup yang bisa berbeda diam-diam.
 *
 * SATU BARIS PER TUJUAN. Dulu tiap tujuan membawa satu baris keterangan redup
 * di bawah namanya — delapan baris abu-abu yang menetap di layar sepanjang hari
 * dan hanya benar-benar dibaca sekali. Yang menggantikannya ikon: ia menandai
 * tujuan dengan bentuk, bukan dengan kalimat, dan tidak memakan baris kedua.
 *
 * Bukan `FilterTabs`: ini navigasi, bukan filter, jadi pembungkusnya `<nav>`
 * dan penanda halaman aktifnya `aria-current="page"`.
 */
export function SidebarNav({
  items,
  arah = "tegak",
}: {
  items: readonly SidebarNavItem[];
  arah?: "tegak" | "mendatar";
}) {
  const pathname = usePathname();
  const mendatar = arah === "mendatar";

  return (
    <nav
      aria-label="Navigasi utama"
      className={cn(
        mendatar
          ? "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex flex-col gap-1",
      )}
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Ikon = IKON[item.ikon];

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-full px-3",
              "text-pendukung transition-colors duration-150 ease-standar",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground",
              /*
                TUJUAN AKTIF BERLATAR MEREK. Bukan `bg-muted`: di HC Panel
                `muted` DAN `background` sama-sama token latar, jadi pil
                ber-`bg-muted` di atas kanvas halaman tidak terlihat sama
                sekali — yang membedakan cuma tebal hurufnya. Yang dipakai
                sekarang `merah-latar`, aksen merek yang sama dengan sorotan
                hasil cari: satu bidang merah muda di kolom kiri, cukup untuk
                menandai tempat tanpa menambah permukaan baru.

                Warna bukan satu-satunya penanda — `aria-current="page"` dan
                huruf tebal tetap ada, jadi tujuan aktif tetap terbaca di mode
                kontras paksa dan buat yang tidak membedakan warna.
              */
              active
                ? "bg-brand-latar font-bold text-foreground"
                : "font-[650] text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            <Ikon
              aria-hidden="true"
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                active ? "text-brand" : null,
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
