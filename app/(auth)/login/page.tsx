import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./LoginForm";

// Nothing on this page is prerenderable once real auth lands. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Masuk" };

/**
 * SKELETON ONLY. The real sign-in flow (Supabase Auth, office-email domain,
 * session cookie, redirect to /karyawan) is built by the login unit. The
 * markup below exists so `/login` renders and the route is reserved.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Masuk ke HC Core</CardTitle>
          <CardDescription>
            Gunakan email kantor Anda. Hanya email kantor yang bisa mendaftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
