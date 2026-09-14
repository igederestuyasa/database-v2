"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * SKELETON ONLY — the form does not submit anywhere yet.
 *
 * The login unit replaces this with a real Supabase Auth sign-in (email +
 * password or magic link) and a redirect to /karyawan. Keeping the markup here
 * means the route, the layout and the styling are already settled.
 */
export function LoginForm() {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email kantor</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nama@hutamakarya.com"
          disabled
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Kata sandi</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          disabled
        />
      </div>
      <Button type="submit" className="w-full" disabled>
        Masuk
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Halaman masuk masih dibangun.
      </p>
    </form>
  );
}
