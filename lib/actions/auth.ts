"use server";

/**
 * Sign-in, sign-out, and the magic link — the only three writes on this page.
 *
 * Shape follows `lib/actions/_reference.ts`: validate with zod, act, map every
 * failure to an Indonesian message, return an `ActionResult` instead of
 * throwing (a thrown Server Action reaches the browser as an opaque digest).
 *
 * There is no role guard here, on purpose: these run BEFORE anyone has a role.
 * The gate is the office email domain, checked twice — once here so the message
 * is readable, and once in the database by `handle_new_user()`, which is the
 * one that actually decides (see `lib/auth/domain.ts`).
 *
 * No Batch is opened: nothing in `public` is written. The `profiles` row a
 * first sign-in creates is inserted by the `on_auth_user_created` trigger, and
 * `log_revision` on `profiles` records it — ADR-005 §12, and the reason
 * application code must not write that row itself.
 */
import { z } from "zod";

import {
  actionFail,
  actionInvalid,
  actionOk,
  type ActionFailure,
  type ActionResult,
} from "@/lib/actions/_guard";
import {
  isOfficeEmail,
  isValidEmailShape,
  normalizeEmail,
  officeEmailMessage,
} from "@/lib/auth/domain";
import { authErrorMessage } from "@/lib/auth/errors";
import {
  loginHref,
  safeNextPath,
} from "@/lib/auth/redirect";
import { isSupabaseConfigured, readAllowedEmailDomain } from "@/lib/env";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

const emailField = z
  .string({ error: "Email kantor wajib diisi." })
  .trim()
  .min(1, { error: "Email kantor wajib diisi." })
  .max(254, { error: "Email terlalu panjang." })
  .refine(isValidEmailShape, { error: "Format email tidak dikenali." });

const nextField = z.string().optional();

const passwordSchema = z.object({
  email: emailField,
  password: z
    .string({ error: "Kata sandi wajib diisi." })
    .min(1, { error: "Kata sandi wajib diisi." }),
  next: nextField,
});

export type PasswordSignInInput = z.input<typeof passwordSchema>;

/** Sign in with email + password. */
export async function signInWithPassword(
  input: PasswordSignInInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);

  const email = normalizeEmail(parsed.data.email);
  const allowedDomain = readAllowedEmailDomain();

  if (!isOfficeEmail(email, allowedDomain)) {
    return actionFail("VALIDASI", officeEmailMessage(allowedDomain), {
      email: officeEmailMessage(allowedDomain),
    });
  }

  const configError = supabaseConfigFailure();
  if (configError) return configError;

  try {
    const client = await createClient();
    const { error } = await client.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

    if (error) {
      return actionFail(
        "GAGAL",
        // `context: "masuk"` — this call cannot create an account, so a 500
        // here is never the office-domain trigger (see lib/auth/errors.ts).
        authErrorMessage(error, { allowedDomain, context: "masuk" }),
      );
    }

    return actionOk({ redirectTo: safeNextPath(parsed.data.next) });
  } catch (error) {
    logError("login", error, { aksi: "signInWithPassword" });
    return actionFail(
      "GAGAL",
      authErrorMessage(asAuthError(error), { allowedDomain, context: "masuk" }),
    );
  }
}

/*
  TIDAK ADA `requestMagicLink()` DI SINI, DAN JANGAN DIBUAT LAGI.

  Dulu ada: satu Server Action yang memanggil `signInWithOtp()` untuk mengirim
  tautan masuk sekali pakai. Masalahnya `shouldCreateUser` dibiarkan pada
  bawaannya — `true` — sehingga panggilan itu MEMBUAT akun kalau alamatnya
  belum terdaftar. Artinya siapa pun yang punya alamat @domain kantor bisa
  membuatkan dirinya sendiri akun `viewer` dan langsung membaca data 1.475
  orang, termasuk kolom yang dipisahkan justru karena sensitif.

  Untuk database yang tunduk UU PDP (PRD §8), "semua orang di perusahaan boleh
  masuk" bukan kebijakan yang pernah diputuskan siapa pun — ia cuma bawaan
  sebuah pemanggilan. Akun sekarang dibuat admin di Supabase (README-HC §8b).

  Menghapusnya, bukan sekadar menyembunyikan tombolnya, karena Server Action
  adalah endpoint HTTP: selama fungsinya masih diekspor, ia tetap bisa
  dipanggil tanpa pernah melewati halaman Masuk.

  Yang TIDAK ikut dihapus: `app/(auth)/login/callback/route.ts` masih menerima
  `invite` dan `recovery`. Tautan undangan dan tautan setel-ulang kata sandi
  dikirim dari layar Supabase oleh admin, dan keduanya harus tetap mendarat.
*/

/**
 * Sign out and clear the session cookies.
 *
 * A reported error is logged but NOT turned into a failure. `auth-js` removes
 * the local session (i.e. expires the cookies) on every path that returns an
 * error other than a missing session — so by the time this returns, this
 * browser is signed out whether or not Supabase answered. Telling the user
 * "gagal" while their cookies are gone, and leaving them on the page, is the
 * one outcome that would be wrong: on a shared HC workstation they would walk
 * away believing they were still signed in, or that they were not.
 */
export async function signOut(): Promise<ActionResult<{ redirectTo: string }>> {
  const configError = supabaseConfigFailure();
  if (configError) return configError;

  try {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) {
      // Worth knowing about (other devices may still hold a session), but not
      // worth blocking the user on.
      logError("login", error, { aksi: "signOut" });
    }
    return actionOk({ redirectTo: loginHref({ pesan: "keluar" }) });
  } catch (error) {
    logError("login", error, { aksi: "signOut" });
    return actionFail(
      "GAGAL",
      "Gagal keluar. Tutup peramban untuk mengakhiri sesi, lalu coba lagi.",
    );
  }
}

/** One message for "the deployment has no Supabase", instead of a raw throw. */
function supabaseConfigFailure(): ActionFailure | null {
  if (isSupabaseConfigured()) return null;
  return actionFail(
    "GAGAL",
    "Koneksi ke Supabase belum dikonfigurasi, jadi belum ada yang bisa masuk. Hubungi admin HC Core.",
  );
}

/** Narrow an unknown throw to the shape `authErrorMessage` reads. */
function asAuthError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as { name?: string; message?: string };
    return { name: candidate.name, message: candidate.message };
  }
  return null;
}
