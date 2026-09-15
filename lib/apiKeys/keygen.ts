/**
 * Membuat dan meng-hash API Key (PRD #19, API-CONTRACT.md §Auth).
 *
 * Satu-satunya tempat sebuah API Key dibuat, dan satu-satunya tempat sebuah
 * API Key di-hash. Dua pihak memakai modul ini dari ujung yang berlawanan:
 *
 *   * `lib/actions/apiKeys.ts` membuat key baru, menyimpan `key_hash` +
 *     `key_prefix`, lalu menampilkan key penuhnya **sekali**;
 *   * `lib/api/auth.ts` menerima `Authorization: Bearer <key>` dari Konsumen,
 *     meng-hash-nya, dan mencari barisnya lewat `findActiveApiKeyByHash()`.
 *
 * Keduanya harus menghitung hash yang **sama persis**, sampai ke ejaan
 * hurufnya; kalau tidak, setiap key yang baru dibuat langsung ditolak 401 dan
 * tidak ada satu pun pesan error yang menjelaskan kenapa. Karena itu bentuknya
 * dikunci di sini, bukan di masing-masing pemanggil:
 *
 *     key        = "hck_" + 40 karakter dari [A-Za-z0-9]
 *     key_hash   = sha256(utf8(key)) heksadesimal huruf kecil (64 karakter)
 *     key_prefix = 8 karakter pertama key ("hck_" + 4 karakter acak)
 *
 * Hash dihitung atas key **penuh apa adanya**, termasuk awalan `hck_`, tanpa
 * normalisasi apa pun — tidak di-trim, tidak di-lowercase. Pemanggil yang
 * menerima key dari jaringan memangkas spasinya sendiri dulu dan memeriksa
 * bentuknya (`apiKeyTokenSchema` di `lib/validation/apiKey.ts`), supaya
 * "hck_… " dengan satu spasi di ujung tidak diam-diam jadi hash yang lain.
 *
 * Yang TIDAK ada di sini, dan memang tidak boleh ada: cara membaca kembali key
 * dari hash-nya. SHA-256 satu arah, dan itulah seluruh gunanya — `key_hash`
 * yang bocor dari log, dari dump, atau dari `revisions.after` tetap tidak bisa
 * dipakai memanggil API. Konsekuensinya harus dikatakan apa adanya di UI:
 * admin yang menutup dialog "key berhasil dibuat" tanpa menyalin key-nya
 * kehilangan key itu selamanya dan harus membuat key baru.
 *
 * Modul Node murni (`node:crypto`), jadi jangan diimpor dari Client Component.
 */
import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PATTERN, API_KEY_PREFIX } from "@/lib/validation/apiKey";

export { API_KEY_PATTERN, API_KEY_PREFIX };

/** Jumlah karakter acak setelah `hck_` (API-CONTRACT.md §Auth). */
export const API_KEY_SECRET_LENGTH = 40;

/** Panjang `api_keys.key_prefix`: 8 karakter pertama, untuk ditampilkan. */
export const API_KEY_PREFIX_LENGTH = 8;

/** Nama algoritma hash, dieja sekali supaya kedua sisi tidak bisa berbeda. */
export const API_KEY_HASH_ALGORITHM = "sha256";

/** Panjang hash heksadesimalnya — 32 byte SHA-256 = 64 karakter. */
export const API_KEY_HASH_LENGTH = 64;

/**
 * Abjad key: 62 karakter, tanpa tanda baca.
 *
 * Bukan base64: sebuah key ikut dalam header HTTP, ditempel ke file `.env`,
 * dan sesekali diketik ulang orang. `+`, `/` dan `=` membuat ketiganya rawan
 * (escaping di shell, padding yang terpotong saat disalin). Semua [A-Za-z0-9]
 * aman di ketiga tempat itu, dan sesuai `API_KEY_PATTERN`.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Ambang penolakan byte, untuk menghindari modulo bias.
 *
 * 256 bukan kelipatan 62: `byte % 62` saja membuat 8 karakter pertama abjad
 * muncul sedikit lebih sering daripada 54 sisanya. Byte ≥ 248 dibuang dan
 * diganti byte berikutnya, sehingga setiap karakter benar-benar berpeluang
 * sama. Dengan 62 pilihan dan 40 karakter, sebuah key punya ±238 bit entropi
 * — jauh di atas kebutuhan; yang dijaga di sini adalah agar angka itu tidak
 * tergerus diam-diam oleh distribusi yang miring.
 */
const REJECT_AT = 256 - (256 % ALPHABET.length);

/** Sumber acak. Diganti HANYA oleh test, supaya pemetaan byte bisa diperiksa. */
export type RandomBytes = (size: number) => Uint8Array;

/** Sebuah API Key yang baru dibuat, dalam tiga bentuk yang dipakai berbeda. */
export type ApiKeyMaterial = {
  /** Key penuh. Ditampilkan SEKALI ke admin, tidak pernah disimpan. */
  key: string;
  /** `api_keys.key_prefix` — 8 karakter pertama, boleh ditampilkan kapan saja. */
  keyPrefix: string;
  /** `api_keys.key_hash` — SHA-256 heksadesimal huruf kecil. */
  keyHash: string;
};

/**
 * 40 karakter acak kriptografis dari `ALPHABET`.
 *
 * `randomBytes` (CSPRNG), bukan `Math.random()`: sebuah key yang bisa ditebak
 * dari waktu pembuatannya adalah kredensial yang tidak menjaga apa pun. Byte
 * diambil sedikit berlebih sekaligus supaya penolakan bias di atas hampir
 * tidak pernah memerlukan permintaan kedua.
 */
export function generateApiKeySecret(random: RandomBytes = randomBytes): string {
  let secret = "";
  while (secret.length < API_KEY_SECRET_LENGTH) {
    const kurang = API_KEY_SECRET_LENGTH - secret.length;
    const bytes = random(kurang + 8);
    if (bytes.length === 0) {
      // Sumber acak yang mengembalikan nol byte akan membuat loop ini berputar
      // selamanya. Lebih baik gagal keras daripada menggantung request.
      throw new Error("Sumber acak tidak mengembalikan byte apa pun.");
    }
    for (const byte of bytes) {
      if (byte >= REJECT_AT) continue;
      secret += ALPHABET[byte % ALPHABET.length];
      if (secret.length === API_KEY_SECRET_LENGTH) break;
    }
  }
  return secret;
}

/**
 * Key penuh yang baru: `hck_` + 40 karakter acak.
 *
 * Kembali sekaligus dengan prefix dan hash-nya, supaya tidak ada pemanggil
 * yang menghitung salah satunya dengan caranya sendiri.
 */
export function createApiKeyMaterial(
  random: RandomBytes = randomBytes,
): ApiKeyMaterial {
  const key = `${API_KEY_PREFIX}${generateApiKeySecret(random)}`;
  return { key, keyPrefix: apiKeyPrefix(key), keyHash: hashApiKey(key) };
}

/**
 * SHA-256 heksadesimal huruf kecil dari key penuh — isi `api_keys.key_hash`.
 *
 * Dihitung atas string apa adanya. Key kosong ditolak daripada menghasilkan
 * hash string kosong, yang akan cocok dengan baris mana pun yang key-nya
 * gagal tersimpan.
 */
export function hashApiKey(key: string): string {
  if (key.length === 0) {
    throw new Error("API Key kosong tidak bisa di-hash.");
  }
  return createHash(API_KEY_HASH_ALGORITHM).update(key, "utf8").digest("hex");
}

/** 8 karakter pertama key — `api_keys.key_prefix`, aman ditampilkan. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

/** Apakah string ini berbentuk API Key HC Core sama sekali. */
export function isApiKeyFormat(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}
