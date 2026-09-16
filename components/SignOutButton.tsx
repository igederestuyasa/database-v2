"use client";

/**
 * "Keluar".
 *
 * Rendered in two places, which is why it lives in `components/` rather than
 * next to the login page: `/login`, which doubles as the account page
 * (middleware deliberately does NOT bounce a signed-in visitor away from it),
 * and the account block at the foot of the sidebar in `app/(app)/layout.tsx`
 * — the one a signed-in user can actually find. Keep both: /login is the only
 * page reachable when `profiles` has no row, and the sidebar is the only one
 * reachable while working.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import Tombol from "@/components/hc/Tombol";
import { toast } from "@/components/ui/sonner";
import { signOut } from "@/lib/actions/auth";

export function SignOutButton({
  className,
  nada = "sekunder",
  ukuran = "biasa",
  ciut = false,
}: {
  className?: string;
  nada?: "utama" | "sekunder" | "halus";
  ukuran?: "biasa" | "ringkas" | "panel";
  /**
   * Sidebar sedang diciutkan: ikon saja.
   *
   * Kata "Keluar" tidak dihapus, hanya di-`sr-only` — tanpa itu tombol ini
   * jadi gambar tanpa nama untuk pembaca layar. Yang berubah cuma apa yang
   * TERLIHAT; `title` menggantikannya untuk pengguna berkursor.
   */
  ciut?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Tombol
      nada={nada}
      ukuran={ukuran}
      className={className}
      disabled={pending}
      title={ciut ? "Keluar" : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await signOut();
          if (!result.ok) {
            toast.error(result.error.message);
            return;
          }
          router.replace(result.data.redirectTo);
          router.refresh();
        });
      }}
    >
      {ciut ? <LogOut aria-hidden="true" /> : null}
      <span className={ciut ? "sr-only" : undefined}>
        {pending ? "Memproses…" : "Keluar"}
      </span>
    </Tombol>
  );
}

export default SignOutButton;
