"use client";

/**
 * "Keluar".
 *
 * It lives on `/login` because that route is the only one this unit owns that a
 * signed-in user can still reach — `app/(app)/layout.tsx`, where a sidebar
 * entry would naturally go, belongs to another unit. `/login` therefore doubles
 * as the account page: middleware deliberately does NOT bounce a signed-in
 * visitor away from it.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

import { signOut } from "./actions";

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
