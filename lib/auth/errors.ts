/**
 * Supabase Auth failures, translated into something staf HC can act on.
 *
 * Two rules:
 *
 *   1. **Never render the raw error.** `invalid_credentials`,
 *      "Database error saving new user" and `AuthRetryableFetchError` are all
 *      English, and the middle one is what the office-domain trigger looks like
 *      from the outside — an unreadable 500 for what is really "pakai email
 *      kantor". Every branch below exists because the raw text would mislead.
 *   2. **Never render attacker-supplied text.** The callback Route Handler and
 *      `middleware.ts` hand the login page a CODE from the closed set below,
 *      never a message, so `/login?pesan=…` cannot be used to put chosen words
 *      on a page that looks like ours.
 *
 * PURE: no `process.env`. The caller passes the domain in.
 */
import { officeEmailMessage } from "./domain";

/** Anything shaped like a Supabase `AuthError`, without importing the class. */
export type AuthErrorLike =
  | {
      name?: string;
      message?: string | null;
      status?: number | null;
      code?: string | null;
    }
  | null
  | undefined;

/**
 * Which call failed.
 *
 * It decides whether "the office-domain trigger fired" is even a possible
 * explanation. `handle_new_user()` runs on INSERT into `auth.users`, so only a
 * magic link (which may create the account) can trip it. Blaming a password
 * sign-in on the email domain would send an `@hutamakarya.com` user off to
 * retype the address they already typed correctly.
 */
export type AuthContext =
  /** `signInWithPassword` — the account already exists. */
  | "masuk"
  /** `signInWithOtp` / the email callback — an account may be created. */
  | "pendaftaran";

const FALLBACK_MASUK =
  "Gagal masuk. Coba lagi; kalau tetap gagal, hubungi admin HC Core.";

const SERVER_BERMASALAH =
  "Server Supabase sedang bermasalah. Coba lagi sebentar lagi; kalau tetap gagal, hubungi admin HC Core.";

/**
 * Postgres `42501` from `handle_new_user()` reaches Supabase Auth as a generic
 * failure, so the domain rule has to be recognised by shape, not by code.
 *
 * Kept narrow on purpose: a bare "database error" is also what a Postgres
 * outage or a failing auth hook says, and neither has anything to do with the
 * email domain.
 */
export function looksLikeDomainRejection(message: string): boolean {
  const haystack = message.toLowerCase();
  return (
    haystack.includes("bukan email kantor") ||
    haystack.includes("saving new user") ||
    haystack.includes("granting user")
  );
}

export function authErrorMessage(
  error: AuthErrorLike,
  options: { allowedDomain: string; context?: AuthContext },
): string {
  if (!error) return FALLBACK_MASUK;

  const context = options.context ?? "masuk";
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  const name = error.name ?? "";
  const domainMessage = officeEmailMessage(options.allowedDomain);

  // The office-domain trigger — only reachable when an account can be created.
  if (context === "pendaftaran" && looksLikeDomainRejection(message)) {
    return domainMessage;
  }

  // Supabase is unreachable (which is also the state of this environment —
  // supabase.com is blocked, see ADR-005).
  if (
    name === "AuthRetryableFetchError" ||
    message.includes("failed to fetch")
  ) {
    return "Tidak bisa menghubungi server Supabase. Periksa koneksi, lalu coba lagi.";
  }

  switch (code) {
    case "invalid_credentials":
      return "Email atau kata sandi salah.";
    case "email_not_confirmed":
      return "Email Anda belum dikonfirmasi. Buka tautan konfirmasi yang dikirim ke email kantor Anda.";
    case "user_not_found":
      return "Akun dengan email itu belum ada di HC Core. Minta admin membuatkan akun Anda.";
    case "user_banned":
      return "Akun ini sedang dinonaktifkan. Hubungi admin HC Core.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Masuk lewat email sedang dimatikan di Supabase. Hubungi admin HC Core.";
    case "email_address_invalid":
    case "email_address_not_authorized":
    case "validation_failed":
      return "Format email tidak dikenali. Periksa lagi alamat email kantor Anda.";
    case "otp_expired":
      return "Tautan masuk sudah kedaluwarsa. Minta tautan baru.";
    case "over_email_send_rate_limit":
      return "Terlalu banyak permintaan tautan masuk. Tunggu beberapa menit, lalu coba lagi.";
    case "over_request_rate_limit":
      return "Terlalu banyak percobaan masuk. Tunggu beberapa menit, lalu coba lagi.";
    case "weak_password":
      return "Kata sandi terlalu lemah. Gunakan kata sandi yang lebih panjang.";
    case "same_password":
      return "Kata sandi baru harus berbeda dari yang lama.";
    default:
      break;
  }

  if (error.status === 429) {
    return "Terlalu banyak percobaan masuk. Tunggu beberapa menit, lalu coba lagi.";
  }
  if (message.includes("invalid login credentials")) {
    return "Email atau kata sandi salah.";
  }
  if (error.status === 500 || code === "unexpected_failure") {
    // Deliberately NOT the domain message: by the time Supabase answers, the
    // address has already passed the office-domain check in the action.
    return SERVER_BERMASALAH;
  }

  return FALLBACK_MASUK;
}

/**
 * The closed set of things `/login?pesan=…` may say.
 *
 * Every producer (middleware, the callback Route Handler, the sign-out button)
 * picks one of these codes; the login page looks the code up here and renders
 * nothing at all for anything it does not recognise.
 */
export const LOGIN_NOTICES = [
  "keluar",
  "konfigurasi",
  "profil",
  "domain",
  "tautan-kedaluwarsa",
  "tautan-gagal",
] as const;

export type LoginNotice = (typeof LOGIN_NOTICES)[number];

export type LoginNoticeText = {
  /** `info` is a neutral bar, `error` is the destructive one. */
  tone: "info" | "error";
  text: string;
};

export function loginNotice(
  raw: string | string[] | null | undefined,
  options: { allowedDomain: string },
): LoginNoticeText | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;

  switch (code as LoginNotice) {
    case "keluar":
      return { tone: "info", text: "Anda sudah keluar dari HC Core." };
    case "konfigurasi":
      return {
        tone: "error",
        text: "Koneksi ke Supabase belum dikonfigurasi, jadi belum ada yang bisa masuk. Hubungi admin HC Core.",
      };
    case "profil":
      return {
        tone: "error",
        text: "Akun Anda ada, tetapi profil penggunanya belum dibuat. Hubungi admin HC Core.",
      };
    case "domain":
      return { tone: "error", text: officeEmailMessage(options.allowedDomain) };
    case "tautan-kedaluwarsa":
      return {
        tone: "error",
        text: "Tautan masuk sudah kedaluwarsa atau sudah dipakai. Minta tautan baru ke admin HC Core.",
      };
    case "tautan-gagal":
      return {
        tone: "error",
        text: "Tautan masuk tidak bisa diproses. Minta tautan baru ke admin HC Core, lalu buka tautannya di peramban yang sama.",
      };
    default:
      return null;
  }
}
