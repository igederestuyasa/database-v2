import type { Metadata } from "next";
import Link from "next/link";

import Tombol from "@/components/hc/Tombol";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loginNotice } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { readSession } from "@/lib/auth/session";
import { isSupabaseConfigured, readAllowedEmailDomain } from "@/lib/env";
import { ROLE_LABELS } from "@/lib/i18n/terms";
import Logo from "@/components/hc/Logo";
import { cn } from "@/lib/utils";

import { SignOutButton } from "@/components/SignOutButton";

import { LoginForm } from "./_components/LoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Masuk" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/login` — the only page a stranger can open, and the account page for
 * everyone else.
 *
 * `middleware.ts` does not redirect a signed-in visitor away from here, so this
 * page has to render four states: not configured, signed in, signed in without
 * a `profiles` row, and the ordinary sign-in form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const allowedDomain = readAllowedEmailDomain();
  const notice = loginNotice(params.pesan, { allowedDomain });
  const next = safeNextPath(firstValue(params.next));

  const configured = isSupabaseConfigured();
  const state = configured ? await readSession() : { status: "tamu" as const };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-5 py-12">
      <Logo ukuran={48} />

      <Card className="hc-permukaan w-full max-w-sm rounded-panel border-border shadow-none">
        {/*
          Judul saja, tanpa kalimat penjelas.

          "Database central data Karyawan PT Hutama Karya (Persero)" tidak
          menolong siapa pun yang berdiri di layar ini: yang sampai ke sini
          sudah tahu app apa ini, dan yang tidak tahu tidak boleh masuk.
        */}
        <CardHeader>
          <CardTitle className="text-judul-panel">Masuk ke HC Core</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {notice ? (
            <p
              role="status"
              className={cn(
                "rounded-bidang border px-3 py-2 text-pendukung",
                notice.tone === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {notice.text}
            </p>
          ) : null}

          {!configured ? (
            <div className="space-y-2 text-pendukung text-muted-foreground">
              <p className="font-medium text-foreground">
                Aplikasi belum terhubung ke Supabase.
              </p>
              <p>
                <code className="rounded-sm bg-muted px-1 font-mono text-mikro font-normal">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>{" "}
                dan{" "}
                <code className="rounded-sm bg-muted px-1 font-mono text-mikro font-normal">
                  NEXT_PUBLIC_SUPABASE_ANON_KEY
                </code>{" "}
                belum diisi, jadi belum ada yang bisa masuk. Hubungi admin HC
                Core.
              </p>
            </div>
          ) : state.status === "masuk" ? (
            <div className="space-y-3 text-pendukung">
              <p className="text-muted-foreground">
                Anda sudah masuk sebagai{" "}
                <span className="font-medium text-foreground">
                  {state.user.email}
                </span>{" "}
                ({ROLE_LABELS[state.user.role]}).
              </p>
              <Tombol asChild className="w-full">
                <Link href={next}>Lanjut ke aplikasi</Link>
              </Tombol>
            </div>
          ) : state.status === "tanpa-profil" ? (
            <div className="space-y-3 text-pendukung text-muted-foreground">
              <p className="font-medium text-foreground">
                Profil pengguna belum dibuat.
              </p>
              <p>
                Akun Anda ada di Supabase Auth, tetapi belum punya baris di
                daftar Pengguna, jadi role Anda belum diketahui. Hubungi admin
                HC Core.
              </p>
            </div>
          ) : (
            <LoginForm allowedDomain={allowedDomain} next={next} />
          )}
        </CardContent>

        {configured && state.status !== "tamu" ? (
          <CardFooter>
            <SignOutButton className="w-full" />
          </CardFooter>
        ) : null}
      </Card>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
