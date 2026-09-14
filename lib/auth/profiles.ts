/**
 * Reads of `profiles` — the Pengguna half of the read layer.
 *
 * It follows the `lib/db/**` contract exactly (reads only; the caller supplies
 * the client as the first argument; errors become `DbError`), but lives here
 * rather than in `lib/db/` because `lib/db/**` is frozen and Pengguna is the
 * only page that reads this table.
 *
 * RLS does the narrowing: `profiles_select` lets a viewer see their own row and
 * an admin see everyone. So `listProfiles()` silently returns one row for a
 * viewer — the page checks the role itself before it renders a list.
 */
import { DbError, type DbClient } from "@/lib/db/shared";

import type { AppRole } from "./session";

export type ProfileRow = {
  id: string;
  email: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
};

/** `profiles.role` is `text` in the generated types; narrow it once, here. */
function toRole(value: string): AppRole {
  return value === "admin" ? "admin" : "viewer";
}

/**
 * Every Pengguna the caller may see, admins first, then by email.
 *
 * `total` comes from PostgREST's exact count, NOT from `rows.length`. PostgREST
 * applies its own `db-max-rows` ceiling (1000 by default) before any `.limit()`
 * and reports success, so a list longer than that would come back quietly
 * truncated — and a "X pengguna" line counted from the array would be wrong
 * with nothing to show for it. Unlikely for app users rather than ~1.500
 * Karyawan, but the honest number costs one header.
 */
export async function listProfiles(client: DbClient): Promise<{
  rows: ProfileRow[];
  total: number;
}> {
  const { data, error, count } = await client
    .from("profiles")
    .select("id, email, role, created_at, updated_at", { count: "exact" })
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  if (error) throw new DbError("Gagal memuat daftar Pengguna", error);

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: toRole(row.role),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { rows, total: count ?? rows.length };
}

/**
 * How many admins exist — counted by the database, not by the rows on screen.
 *
 * Same reason as above, and it matters more here: "berapa admin yang tersisa"
 * is the number someone checks before demoting one.
 */
export async function countAdmins(client: DbClient): Promise<number> {
  const { error, count } = await client
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if (error) throw new DbError("Gagal menghitung Admin", error);
  return count ?? 0;
}

/** One Pengguna, or `null` when the row does not exist or RLS hides it. */
export async function getProfileById(
  client: DbClient,
  id: string,
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, email, role, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new DbError("Gagal memuat Pengguna", error);
  if (!data) return null;

  return {
    id: data.id,
    email: data.email,
    role: toRole(data.role),
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}
