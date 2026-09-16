"use client";

/**
 * The sign-in form (PRD #21).
 *
 * SATU JALAN MASUK: email kantor dan kata sandi.
 *
 * Dulu ada jalan kedua, "Kirim tautan masuk ke email", dan itu dicabut dengan
 * sengaja. Panggilannya memakai `shouldCreateUser` bawaan — yaitu `true` —
 * jadi siapa pun yang punya alamat @domain kantor bisa membuatkan dirinya
 * sendiri akun `viewer` dan langsung membaca data 1.475 orang. Untuk database
 * yang memuat tanggal lahir, agama, dan status pernikahan (UU PDP, PRD §8),
 * "semua orang di perusahaan boleh masuk" bukan kebijakan yang pernah
 * diputuskan siapa pun — ia cuma bawaan sebuah pemanggilan.
 *
 * Akun sekarang dibuat admin di Supabase (README-HC §8b) dan tidak ada jalan
 * lain. Menyembunyikan tombolnya saja tidak cukup untuk itu: Server Action
 * adalah endpoint HTTP yang bisa dipanggil tanpa melewati halaman ini, jadi
 * `requestMagicLink()` ikut dihapus dari `lib/actions/auth.ts`.
 *
 * All the deciding happens in `lib/actions/auth.ts`; this component
 * only collects the input, shows what came back, and never sees a raw
 * PostgREST or Supabase Auth message.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import Tombol from "@/components/hc/Tombol";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { ActionFailure } from "@/lib/actions/_guard";
import { isValidEmailShape, officeEmailPlaceholder } from "@/lib/auth/domain";

import { signInWithPassword } from "@/lib/actions/auth";

const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, { error: "Email kantor wajib diisi." })
    .max(254, { error: "Email terlalu panjang." })
    .refine(isValidEmailShape, { error: "Format email tidak dikenali." }),
  password: z.string().min(1, { error: "Kata sandi wajib diisi." }),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export type LoginFormProps = {
  /** `ALLOWED_EMAIL_DOMAIN`, read on the server and handed down. */
  allowedDomain: string;
  /** Sanitised `?next=` — where to go once the session exists. */
  next: string;
};

export function LoginForm({ allowedDomain, next }: LoginFormProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "", password: "" },
  });

  /** Put the failure where the user is looking: on the field, and in a toast. */
  const showFailure = React.useCallback(
    (failure: ActionFailure["error"]) => {
      const fieldErrors = failure.fieldErrors ?? {};
      for (const [field, message] of Object.entries(fieldErrors)) {
        if (field === "email" || field === "password") {
          form.setError(field, { type: "server", message });
        }
      }
      toast.error(failure.message);
    },
    [form],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await signInWithPassword({
        email: values.email,
        password: values.password,
        next,
      });

      if (!result.ok) {
        showFailure(result.error);
        return;
      }

      toast.success("Berhasil masuk.");
      router.replace(result.data.redirectTo);
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email kantor</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={officeEmailPlaceholder(allowedDomain)}
                  disabled={pending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Kata sandi</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  disabled={pending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Tombol type="submit" className="w-full" disabled={pending}>
          {pending ? "Memproses…" : "Masuk"}
        </Tombol>
      </form>
    </Form>
  );
}

export default LoginForm;
