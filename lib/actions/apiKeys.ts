"use server";

/**
 * Server Actions untuk API Key (PRD #19) — buat, ubah whitelist, nonaktifkan.
 *
 * Bentuknya mengikuti enam langkah `lib/actions/_reference.ts`: validasi zod →
 * `requireAdmin()` → baca baris sekarang → tulis SATU statement langsung →
 * `revalidatePath()` → kembalikan `ActionResult`, tidak pernah melempar.
 * Ketiganya satu baris satu tabel, jadi tidak ada Batch yang dibuka dari sini:
 * trigger `log_revision` yang membuatnya (ADR-006).
 *
 * Tiga hal yang membentuk file ini, dan ketiganya soal kerahasiaan:
 *
 *   * **Key penuh hanya ada sekejap, di memori server.** Ia dibuat di
 *     `createApiKey`, dikembalikan sekali ke layar admin, dan tidak pernah
 *     disimpan di mana pun. Yang masuk database hanya SHA-256-nya
 *     (`key_hash`) dan 8 karakter pertamanya (`key_prefix`). Tidak ada action
 *     di sini yang bisa membacanya kembali, dan memang tidak boleh ada —
 *     kalau key-nya hilang, jalannya membuat key baru.
 *   * **`key_hash` tidak pernah keluar.** Setiap `.select()` di file ini
 *     menyebut kolomnya satu per satu dan meninggalkan `key_hash`, sama
 *     seperti `lib/db/apiKeys.ts`. Barisnya lewat dari sini ke Client
 *     Component, jadi satu kolom yang kelebihan akan terkirim ke browser.
 *   * **`allowed_fields` adalah seluruh kendali aksesnya.** Route `/api/v1`
 *     memakai service-role client yang melewati RLS (ADR-004), jadi tidak ada
 *     lapis kedua di belakang whitelist ini: kolom yang tercentang di sini
 *     adalah kolom yang keluar. Yang bisa dicentang hanya kolom
 *     `v_employees_api` (`API_EMPLOYEE_FIELDS`, ditegakkan lagi oleh zod), dan
 *     Data Pribadi Sensitif tidak ada di daftar itu sama sekali (PRD #22).
 *
 * Yang sengaja TIDAK ada di sini:
 *
 *   * **DELETE.** Sebuah Konsumen memegang key-nya di konfigurasinya sendiri;
 *     menghapus barisnya membuat rujukan itu menunjuk ke ruang kosong dan
 *     tidak bisa dikembalikan. Nonaktifkan dengan `status = 'nonaktif'`
 *     (CLAUDE.md, ARCHITECTURE.md §6).
 *   * **Menulis `last_used_at`.** Kolom itu milik `lib/api/auth.ts`, disentuh
 *     setiap permintaan Konsumen, dan sengaja diabaikan `log_revision` supaya
 *     lalu lintas API tidak mengubur Log Perubahan.
 *   * **Rotate key.** Mengganti key sebuah Konsumen tanpa mengganti barisnya
 *     bukan bagian PRD #19; caranya buat key baru, pasang di Konsumen, lalu
 *     nonaktifkan yang lama — dua langkah yang keduanya terlihat di log.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createApiKeyMaterial } from "@/lib/apiKeys/keygen";
import { getApiKeyById, type ApiKeySummary } from "@/lib/db/apiKeys";
import { DbError } from "@/lib/db/shared";
import {
  apiKeyCreateSchema,
  apiKeySetStatusSchema,
  apiKeyUpdateSchema,
  type ApiKeyCreateInput,
  type ApiKeySetStatusInput,
} from "@/lib/validation/apiKey";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "./_guard";

/**
 * Kolom yang boleh dibaca balik setelah menulis — semuanya KECUALI `key_hash`.
 *
 * Sengaja dieja ulang di sini dan tidak diimpor dari `lib/db/apiKeys.ts`
 * (yang menyimpannya sebagai konstanta privat): `npm run check:columns`
 * memeriksa string literal, jadi daftar yang dieja di tempat yang memakainya
 * ikut terperiksa. Yang penting bukan kembarannya, melainkan bahwa
 * `key_hash` tidak ada di keduanya.
 */
const SELECT_PUBLIC =
  "id, nama_konsumen, key_prefix, allowed_fields, status, last_used_at, created_at, updated_at";

/**
 * Ubah API Key dari halaman: nama Konsumen dan whitelist kolomnya.
 *
 * `status` dibuang dari schema beku `apiKeyUpdateSchema` supaya tidak ada
 * jalan dari form ini yang bisa menonaktifkan (atau diam-diam mengaktifkan
 * kembali) sebuah key. Menonaktifkan adalah keputusan tersendiri dengan
 * konfirmasinya sendiri — `setApiKeyStatus` di bawah.
 */
const apiKeyEditSchema = apiKeyUpdateSchema.omit({ status: true });

export type ApiKeyEditInput = z.infer<typeof apiKeyEditSchema>;

/** Baris API Key seadanya, tanpa `key_hash`, seperti yang dilihat halaman. */
export type ApiKeyRingkas = ApiKeySummary;

/** Hasil `createApiKey`: barisnya, plus key penuh yang hanya ada sekali ini. */
export type ApiKeyBaru = {
  apiKey: ApiKeyRingkas;
  /**
   * Key penuh `hck_…`. **Satu-satunya kali nilai ini ada.** Tampilkan,
   * jangan simpan, jangan catat ke log, jangan kirim ke mana pun selain layar
   * admin yang baru saja membuatnya.
   */
  key: string;
};

/** Setiap halaman yang ikut basi ketika sebuah API Key berubah. */
function revalidateApiKeyPages(): void {
  revalidatePath("/api-keys");
  // Setiap tulisan di sini melahirkan satu Batch + Revisi lewat trigger.
  revalidatePath("/log");
}

/**
 * Buat API Key baru untuk satu Konsumen (PRD #19).
 *
 * Key-nya dibuat di server (`createApiKeyMaterial`), bukan diketik admin:
 * kredensial yang dipilih manusia bisa ditebak, dan kredensial yang dikirim
 * dari browser sudah melewati satu jaringan sebelum sempat di-hash.
 */
export async function createApiKey(
  input: ApiKeyCreateInput,
): Promise<ActionResult<ApiKeyBaru>> {
  const parsed = apiKeyCreateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { nama_konsumen, allowed_fields, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const { key, keyPrefix, keyHash } = createApiKeyMaterial();

    // SATU statement. `revisions.after` yang ditulis trigger memang memuat
    // `key_hash` — karena itu Revisi `api_keys` hanya bisa dibaca admin
    // (RLS, CLAUDE.md), bukan karena kolomnya disembunyikan dari trigger.
    const { data, error } = await client
      .from("api_keys")
      .insert({
        nama_konsumen,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        allowed_fields,
        status,
      })
      .select(SELECT_PUBLIC)
      .single();

    if (error) throw new DbError("Gagal membuat API Key", error);

    revalidateApiKeyPages();

    return actionOk({ apiKey: data, key });
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Ubah nama Konsumen dan/atau whitelist kolom sebuah key (PRD #19).
 *
 * Bisa diubah setelah key dibuat, dan itu disengaja: whitelist yang hanya bisa
 * ditentukan sekali berarti satu centang yang salah harus dibereskan dengan
 * membuat key baru dan meminta Konsumen memasang ulang kredensialnya — yang
 * dalam praktiknya membuat orang membiarkan saja kolom kelebihan itu terbuka.
 * Perubahannya berlaku pada permintaan Konsumen berikutnya, dan tercatat
 * sebagai Revisi seperti perubahan lain.
 */
export async function updateApiKey(
  input: ApiKeyEditInput,
): Promise<ActionResult<ApiKeyRingkas>> {
  const parsed = apiKeyEditSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama_konsumen, allowed_fields } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getApiKeyById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "API Key tidak ditemukan.");
    }

    // Kolom yang benar-benar dikirim saja. `undefined` berarti "biarkan
    // seperti sekarang" — sebuah whitelist yang tidak disebut tidak boleh
    // berubah jadi kosong.
    const perubahan: { nama_konsumen?: string; allowed_fields?: string[] } = {};
    if (nama_konsumen !== undefined && nama_konsumen !== current.nama_konsumen) {
      perubahan.nama_konsumen = nama_konsumen;
    }
    if (allowed_fields !== undefined && !sameFields(allowed_fields, current.allowed_fields)) {
      perubahan.allowed_fields = allowed_fields;
    }

    // Tidak ada yang berubah. `log_revision` toh mengabaikan update yang hanya
    // menggeser `updated_at`; berhenti di sini menjaga Log Perubahan bersih.
    if (Object.keys(perubahan).length === 0) return actionOk(current);

    const { data, error } = await client
      .from("api_keys")
      .update(perubahan)
      .eq("id", id)
      .select(SELECT_PUBLIC)
      .single();

    if (error) throw new DbError("Gagal mengubah API Key", error);

    revalidateApiKeyPages();

    return actionOk(data);
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Nonaktifkan atau aktifkan kembali sebuah API Key (PRD #19, #20).
 *
 * Tidak ada DELETE: barisnya tetap ada, jadi Konsumen yang sudah memegang
 * key-nya tetap punya rujukan yang bisa dijelaskan, Revisi lama tetap utuh,
 * dan sebuah penonaktifan yang keliru bisa dibatalkan. Sejak statusnya
 * `nonaktif`, `findActiveApiKeyByHash()` tidak menemukannya lagi dan setiap
 * permintaan Konsumen dijawab 401 (API-CONTRACT.md).
 *
 * Mengaktifkan kembali memakai `key_hash` yang sama, artinya key lama yang
 * masih dipegang Konsumen berlaku lagi. Itu memang gunanya — tapi kalau
 * key-nya dinonaktifkan karena bocor, yang benar bukan mengaktifkannya lagi,
 * melainkan membuat key baru.
 */
export async function setApiKeyStatus(
  input: ApiKeySetStatusInput,
): Promise<ActionResult<ApiKeyRingkas>> {
  const parsed = apiKeySetStatusSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getApiKeyById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "API Key tidak ditemukan.");
    }
    if (current.status === status) return actionOk(current);

    const { data, error } = await client
      .from("api_keys")
      .update({ status })
      .eq("id", id)
      .select(SELECT_PUBLIC)
      .single();

    if (error) throw new DbError("Gagal mengubah status API Key", error);

    revalidateApiKeyPages();

    return actionOk(data);
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/** Dua whitelist yang isinya sama, apa pun urutannya. */
function sameFields(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const kiri = [...a].sort();
  const kanan = [...b].sort();
  return kiri.every((field, index) => field === kanan[index]);
}

/**
 * Terjemahkan penolakan database menjadi kalimat yang bisa dibaca staf HC.
 *
 * Tiga yang bisa sampai ke sini:
 *
 *   * `23505` — UNIQUE `api_keys.key_hash`. Secara praktis mustahil (40
 *     karakter acak dari 62), jadi kalau muncul, yang salah adalah sumber
 *     acaknya, bukan pemakainya; katakan begitu daripada "coba kode lain".
 *   * `PGRST116` — **penolakan RLS pada UPDATE**, dan bentuknya menipu.
 *     Policy `api_keys_update` ditulis `using (is_admin())`, jadi tulisan dari
 *     yang bukan admin tidak melempar `insufficient_privilege`; ia hanya cocok
 *     dengan NOL baris, lalu `.single()` mengeluh "tidak ada baris". Di sini
 *     barisnya jelas ada — baru saja dibaca — jadi nol baris berarti
 *     tulisannya yang ditolak, bukan barisnya yang hilang.
 *   * `42501` — penolakan yang memang melempar: `with check` pada INSERT.
 *
 * `requireAdmin()` di setiap action seharusnya sudah menyaring semuanya; ini
 * lapis keduanya (CLAUDE.md: "Cek role di Server Action **dan** RLS"), untuk
 * saat role berubah di tengah request atau sesi habis setelah guard lewat.
 */
function asActionError(error: unknown): unknown {
  if (!(error instanceof DbError)) return error;

  if (error.code === "23505") {
    return new ActionError(
      "KONFLIK",
      "Key yang dibuat kebetulan sama dengan key yang sudah ada. Coba buat sekali lagi; kalau terus terjadi, laporkan ke pengembang HC Core.",
    );
  }

  if (error.code === "PGRST116" || error.code === "42501") {
    return new ActionError(
      "BUKAN_ADMIN",
      "Perubahan ditolak database: akun Anda tidak berhak mengelola API Key. Muat ulang halaman, lalu hubungi admin HC Core kalau masih ditolak.",
    );
  }

  return error;
}
