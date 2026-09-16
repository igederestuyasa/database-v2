"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type SidebarNavItem = {
  href: string;
  label: string;
  /** Ikon tujuan. Bentuknya, bukan keterangannya, yang menandai tiap tujuan. */
  ikon: LucideIcon;
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
        const Ikon = item.ikon;

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
                `bg-card`, bukan `bg-muted`. Di HC Panel `muted` DAN
                `background` sama-sama token latar, jadi pil ber-`bg-muted` di
                atas kanvas halaman tidak terlihat sama sekali — yang
                membedakan cuma tebal hurufnya. Kartu di atas kanvas adalah
                beda permukaan yang memang dipakai sistem ini.
              */
              active
                ? "border border-border bg-card font-bold text-foreground"
                : "border border-transparent font-[650] text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            <Ikon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
