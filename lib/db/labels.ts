/**
 * uuid → nama yang dikenali manusia, untuk setiap rujukan di dalam Revisi.
 *
 * Inilah yang berdiri antara staf HC dan sebuah diff yang berbunyi
 * `org_unit_id: 3f2a… → 9b1c…`. Lima relasi, satu query masing-masing, hanya
 * untuk id yang memang ada di layar.
 *
 * Mengikuti kontrak `lib/db/**`: baca saja, client dipasok pemanggil, error
 * menjadi `DbError`. RLS yang menentukan apa yang kembali — `profiles` hanya
 * terbaca admin atau pemiliknya, jadi seorang viewer tidak bisa mengubah
 * `actor_id` rekan kerjanya menjadi email. Key yang hilang bukan kegagalan;
 * `actorLabel()` di `revisionDiff.ts` jatuh ke id pendek.
 *
 * Sebelumnya lima pembaca ini hidup di `lib/actions/revisions.ts`, sehingga
 * halaman `/log` harus memanggil sebuah Server Action (dan mengulang guard)
 * hanya untuk menamai pelaku. Sekarang page dan action sama-sama memanggil
 * modul ini.
 */
import type { ReferenceIds, ReferenceLabels } from "@/lib/revisions/references";

import { DbError, type DbClient } from "./shared";

/**
 * Batas satu daftar `in (…)` yang di-resolve.
 *
 * Dipangkas, bukan ditolak: permintaan yang entah bagaimana membawa lebih
 * dari ini tetap mendapat nama untuk yang muat, dan itu lebih baik daripada
 * halaman yang setiap rujukannya berbunyi "(tidak dikenal)". Praktis tidak
 * terjangkau — satu halaman Revisi tidak menamai sebanyak ini.
 */
export const MAX_IDS_PER_ENTITY = 2000;

function capped(ids: readonly string[]): string[] {
  return ids.slice(0, MAX_IDS_PER_ENTITY);
}

export async function readOrgUnitLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("org_units")
    .select("id, nama, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Unit Organisasi", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.nama} (${row.kode})`]),
  );
}

export async function readJabatanLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("jabatan")
    .select("id, nama, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Jabatan", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.nama} (${row.kode})`]),
  );
}

export async function readLookupLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("lookups")
    .select("id, label, kode")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Lookup", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.label} (${row.kode})`]),
  );
}

export async function readEmployeeLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  // `employees`, bukan `v_employees_private`: view itu INNER JOIN
  // `employee_private`, jadi seorang viewer akan mendapat nol baris (ADR-005 §10).
  const { data, error } = await client
    .from("employees")
    .select("id, full_name, personnel_number")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Karyawan", error);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id, `${row.full_name} · ${row.personnel_number}`]),
  );
}

export async function readProfileLabels(
  client: DbClient,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  // RLS: admin melihat semua, viewer hanya dirinya. Lebih sedikit baris
  // daripada id adalah keadaan normal, bukan kegagalan.
  const { data, error } = await client
    .from("profiles")
    .select("id, email")
    .in("id", capped(ids));
  if (error) throw new DbError("Gagal memuat nama Pengguna", error);
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.email]));
}

/** Semua relasi sekaligus, satu query per relasi yang memang berisi id. */
export async function resolveReferenceLabels(
  client: DbClient,
  ids: Partial<ReferenceIds>,
): Promise<ReferenceLabels> {
  const groups = await Promise.all([
    readOrgUnitLabels(client, ids.org_units ?? []),
    readJabatanLabels(client, ids.jabatan ?? []),
    readLookupLabels(client, ids.lookups ?? []),
    readEmployeeLabels(client, ids.employees ?? []),
    readProfileLabels(client, ids.profiles ?? []),
  ]);
  return Object.assign({}, ...groups);
}
