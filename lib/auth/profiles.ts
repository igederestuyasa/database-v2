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

/** Every Pengguna the caller may see, admins first, then by email. */
export async function listProfiles(client: DbClient): Promise<ProfileRow[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, email, role, created_at, updated_at")
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  if (error) throw new DbError("Gagal memuat daftar Pengguna", error);

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: toRole(row.role),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
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
