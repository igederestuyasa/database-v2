"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type SidebarNavItem = {
  href: string;
  label: string;
  /** Short Indonesian hint shown under the label. */
  keterangan: string;
};

/**
 * Navigasi utama HC Core, dalam dua bentuk dari satu daftar.
 *
 * `tegak` untuk sidebar mulai 1024px, `mendatar` untuk strip yang bisa digeser
 * di bawah bar atas pada layar sempit. Keduanya di sini supaya kedelapan tujuan
 * itu tidak pernah punya dua markup yang bisa berbeda diam-diam.
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

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-colors duration-150 ease-standar",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground",
              mendatar
                ? "flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-pendukung font-medium"
                : "rounded-kartu px-3 py-2",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className={cn("block", mendatar ? null : "text-pendukung font-semibold")}>
              {item.label}
            </span>
            {mendatar ? null : (
              <span className="mt-0.5 block text-mikro font-normal text-muted-foreground">
                {item.keterangan}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
