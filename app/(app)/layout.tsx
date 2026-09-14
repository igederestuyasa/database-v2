import Link from "next/link";

import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { NAV_LABELS } from "@/lib/i18n/terms";

/**
 * Every page in this group reads live data from Supabase, so nothing here is
 * prerenderable — the build machine has no database. Setting it on the layout
 * makes the whole segment dynamic; each page repeats it so the rule survives a
 * page being moved. See ADR-005.
 */
export const dynamic = "force-dynamic";

/**
 * THE SIDEBAR. All eight destinations live here, in this one file, so that no
 * two units ever edit the same nav markup. Routes whose page is still a stub
 * render a placeholder until their unit lands — that is expected.
 */
const NAV_ITEMS: readonly SidebarNavItem[] = [
  {
    href: "/karyawan",
    label: NAV_LABELS.karyawan,
    keterangan: "Cari & kelola data Karyawan",
  },
  {
    href: "/struktur",
    label: NAV_LABELS.struktur,
    keterangan: "Hierarki Unit Organisasi",
  },
  {
    href: "/jabatan",
    label: NAV_LABELS.jabatan,
    keterangan: "Daftar nama pekerjaan",
  },
  {
    href: "/master-data",
    label: NAV_LABELS["master-data"],
    keterangan: "Semua tipe Lookup",
  },
  {
    href: "/bereskan",
    label: NAV_LABELS.bereskan,
    keterangan: "Temuan data kotor",
  },
  {
    href: "/log",
    label: NAV_LABELS.log,
    keterangan: "Batch & Revisi, bisa dikembalikan",
  },
  {
    href: "/api-keys",
    label: NAV_LABELS["api-keys"],
    keterangan: "Konsumen & whitelist kolom",
  },
  {
    href: "/pengguna",
    label: NAV_LABELS.pengguna,
    keterangan: "Role admin / viewer",
  },
];

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex">
        <div className="border-b px-6 py-5">
          <Link href="/karyawan" className="block">
            <span className="text-lg font-semibold tracking-tight">
              HC Core
            </span>
            <span className="block text-xs text-muted-foreground">
              Data Karyawan PT Hutama Karya
            </span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav items={NAV_ITEMS} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Narrow screens get the same destinations as a scrolling strip. */}
        <div className="overflow-x-auto border-b bg-muted/30 p-2 md:hidden">
          <div className="flex gap-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
