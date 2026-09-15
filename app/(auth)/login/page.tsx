import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loginNotice } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { readSession } from "@/lib/auth/session";
import { isSupabaseConfigured, readAllowedEmailDomain } from "@/lib/env";
import { ROLE_LABELS } from "@/lib/i18n/terms";
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Masuk ke HC Core</CardTitle>
          <CardDescription>
            Database central data Karyawan PT Hutama Karya (Persero).
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {notice ? (
            <p
              role="status"
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                notice.tone === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {notice.text}
            </p>
          ) : null}

          {!configured ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Aplikasi belum terhubung ke Supabase.
              </p>
              <p>
                <code className="rounded bg-muted px-1">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>{" "}
                dan{" "}
                <code className="rounded bg-muted px-1">
                  NEXT_PUBLIC_SUPABASE_ANON_KEY
                </code>{" "}
                belum diisi, jadi belum ada yang bisa masuk. Hubungi admin HC
                Core.
              </p>
            </div>
          ) : state.status === "masuk" ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Anda sudah masuk sebagai{" "}
                <span className="font-medium text-foreground">
                  {state.user.email}
                </span>{" "}
                ({ROLE_LABELS[state.user.role]}).
              </p>
              <Button asChild className="w-full">
                <Link href={next}>Lanjut ke aplikasi</Link>
              </Button>
            </div>
          ) : state.status === "tanpa-profil" ? (
            <div className="space-y-3 text-sm text-muted-foreground">
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
