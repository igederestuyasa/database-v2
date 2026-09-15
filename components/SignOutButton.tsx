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

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { signOut } from "@/lib/actions/auth";

export function SignOutButton({
  className,
  variant = "outline",
}: {
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={pending}
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
      {pending ? "Memproses…" : "Keluar"}
    </Button>
  );
}

export default SignOutButton;
