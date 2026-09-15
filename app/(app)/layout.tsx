import Link from "next/link";

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

        {akun ? (
          <div className="border-t px-4 py-4">
            <p className="truncate text-sm font-medium" title={akun.email}>
              {akun.email}
            </p>
            <p className="text-xs text-muted-foreground">
              {ROLE_LABELS[akun.role]}
            </p>
            <SignOutButton className="mt-3 w-full" />
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Narrow screens get the same destinations as a scrolling strip —
            and, at the end of it, the same way out as the sidebar. */}
        <div className="flex items-center gap-2 border-b bg-muted/30 p-2 md:hidden">
          <div className="min-w-0 flex-1 overflow-x-auto">
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

          {akun ? (
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="max-w-[10rem] truncate text-xs text-muted-foreground"
                title={`${akun.email} · ${ROLE_LABELS[akun.role]}`}
              >
                {akun.email}
              </span>
              <SignOutButton variant="ghost" />
            </div>
          ) : null}
        </div>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
