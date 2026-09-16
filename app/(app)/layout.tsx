import Link from "next/link";
import {
  BriefcaseBusiness,
  History,
  KeyRound,
  ListTree,
  Network,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";

import BarAtas, { LewatiKeKonten } from "@/components/hc/BarAtas";
import KakiHalaman from "@/components/hc/KakiHalaman";
import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";
import { readSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { NAV_LABELS, ROLE_LABELS } from "@/lib/i18n/terms";
import { logError } from "@/lib/log";

/**
 * Every page in this group reads live data from Supabase, so nothing here is
 * prerenderable — the build machine has no database. Setting it on the layout
 * makes the whole segment dynamic; each page repeats it so the rule survives a
 * page being moved. See ADR-005.
 */
export const dynamic = "force-dynamic";

/**
 * THE SIDEBAR. All eight destinations live here, in this one file, so that no
 * two units ever edit the same nav markup.
 */
const NAV_ITEMS: readonly SidebarNavItem[] = [
  { href: "/karyawan", label: NAV_LABELS.karyawan, ikon: Users },
  { href: "/struktur", label: NAV_LABELS.struktur, ikon: Network },
  { href: "/jabatan", label: NAV_LABELS.jabatan, ikon: BriefcaseBusiness },
  { href: "/master-data", label: NAV_LABELS["master-data"], ikon: ListTree },
  { href: "/bereskan", label: NAV_LABELS.bereskan, ikon: TriangleAlert },
  { href: "/log", label: NAV_LABELS.log, ikon: History },
  { href: "/api-keys", label: NAV_LABELS["api-keys"], ikon: KeyRound },
  { href: "/pengguna", label: NAV_LABELS.pengguna, ikon: UserCog },
];

/**
 * Who is signed in, for the account block at the foot of the sidebar.
 *
 * `readSession()` rather than `requirePageSession()`: sending someone to
 * /login from the LAYOUT would fire on every page in the group and hide
 * whatever the page itself wanted to say about the problem. `middleware.ts` is
 * the boundary; this only decides what the sidebar shows.
 *
 * Nothing here throws, by choice. Next routes an error thrown by a layout to
 * the *parent's* boundary — `app/error.tsx`, which exists — but that boundary
 * replaces the whole shell, sidebar included, for a read whose only job is to
 * print an email address. Rendering the shell without the account block is
 * the kinder failure for a transient `profiles` hiccup; the page inside will
 * hit the same cached `readVerifiedSession()` and report it properly.
 * A missing `.env.local` is the same story, hence the configured check.
 *
 * `null` means "render the shell without an account block" — never an error.
 */
async function bacaAkun() {
  if (!isSupabaseConfigured()) return null;
  try {
    const state = await readSession();
    return state.status === "masuk" ? state.user : null;
  } catch (error) {
    logError("layout", error, { aksi: "baca sesi untuk sidebar" });
    return null;
  }
}

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // THE WAY OUT. Without this block a signed-in user has no way to sign out:
  // `SignOutButton` existed but the only page rendering it was /login, which
  // the sidebar never links to.
  const akun = await bacaAkun();

  return (
    <div className="min-h-screen bg-background">
      {/* Harus jadi elemen yang bisa difokus pertama di halaman. */}
      <LewatiKeKonten />

      {/*
        Bar atas memegang logo dan nama app; sidebar di bawahnya memegang
        tujuan. Sengaja tidak dua-duanya membawa logo — docs/DESIGN.md menaruh
        identitas app di bar, dan mengulangnya di kepala sidebar hanya membuat
        dua hal yang harus diubah bersamaan setiap kali nama app berganti.
      */}
      <BarAtas
        href="/karyawan"
        kanan={akun ? `${akun.email} · ${ROLE_LABELS[akun.role]}` : undefined}
      />

      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
          {/* Sticky di bawah bar atas, jadi navigasi tetap terjangkau pada
              halaman sepanjang Log Perubahan. */}
          <div className="sticky top-0 flex max-h-screen flex-col gap-4 overflow-y-auto p-4">
            <SidebarNav items={NAV_ITEMS} />

            {akun ? (
              <div className="mt-auto border-t border-border pt-4">
                <p
                  className="truncate text-pendukung font-medium text-foreground"
                  title={akun.email}
                >
                  {akun.email}
                </p>
                <p className="text-mikro font-normal text-muted-foreground">
                  {ROLE_LABELS[akun.role]}
                </p>
                <SignOutButton className="mt-3 w-full" />
              </div>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Di bawah 1024px kedelapan tujuan jadi strip yang bisa digeser. */}
          <div className="border-b border-border px-5 py-2 lg:hidden">
            <SidebarNav items={NAV_ITEMS} arah="mendatar" />
          </div>

          <div className="mx-auto max-w-wadah px-5 lg:px-10">
            <main id="konten" className="min-w-0">
              {children}
            </main>

            <KakiHalaman>
              <p>
                HC Core — sumber kebenaran data Karyawan PT Hutama Karya
                (Persero).
              </p>
              <p className="mt-1">
                Setiap perubahan tercatat dan bisa dikembalikan lewat{" "}
                <Link
                  href="/log"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {NAV_LABELS.log}
                </Link>
                . Ada data yang janggal? Hubungi admin HC Core.
              </p>
            </KakiHalaman>
          </div>
        </div>
      </div>
    </div>
  );
}
