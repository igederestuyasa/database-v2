"use client";

/**
 * The sign-in form (PRD #21).
 *
 * Two ways in, because HC staff have both: a password for accounts an admin
 * set up, and a one-time link by email for everyone else — the link is also
 * what creates a first-time account, which `on_auth_user_created` then either
 * refuses (not an office address) or accepts as a `viewer`.
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

import { requestMagicLink, signInWithPassword } from "@/lib/actions/auth";

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
  const [linkSentTo, setLinkSentTo] = React.useState<string | null>(null);

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
    setLinkSentTo(null);
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

  const onMagicLink = async () => {
    setLinkSentTo(null);
    // The password is irrelevant to this path, so validate only the email.
    const emailOk = await form.trigger("email");
    if (!emailOk) return;

    const email = form.getValues("email");
    startTransition(async () => {
      const result = await requestMagicLink({ email, next });

      if (!result.ok) {
        showFailure(result.error);
        return;
      }

      setLinkSentTo(result.data.email);
      toast.success("Tautan masuk sudah dikirim.");
    });
  };

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

        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-border" />
          <span className="text-mikro font-normal text-muted-foreground">atau</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Tombol
          type="button"
          nada="sekunder"
          className="w-full"
          onClick={onMagicLink}
          disabled={pending}
        >
          Kirim tautan masuk ke email
        </Tombol>

        <p className="text-mikro font-normal text-muted-foreground" aria-live="polite">
          {linkSentTo
            ? `Tautan masuk sudah dikirim ke ${linkSentTo}. Buka tautannya di peramban ini, berlakunya terbatas.`
            : `Belum punya kata sandi? Pakai tautan masuk — hanya email kantor (@${allowedDomain}) yang diterima.`}
        </p>
      </form>
    </Form>
  );
}

export default LoginForm;
