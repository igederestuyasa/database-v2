/**
 * Shared zod building blocks for every entity schema.
 *
 * FROZEN CONTRACT (Wave 1). One schema validates both the client form and the
 * Server Action (ARCHITECTURE.md §1), so these pieces have to survive both
 * shapes of input:
 *
 *   * an HTML form sends `""` for an untouched field, never `null`;
 *   * a Server Action may be called with a already-typed object.
 *
 * Hence the `""` → `null` preprocessing on every optional field. Messages are
 * Indonesian because they are shown to staf HC (CLAUDE.md).
 */
import { z } from "zod";

/** `""`, `"   "` and `undefined` all mean "kosong". */
function emptyToNull(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

/** Trim strings before any other check, leave everything else alone. */
function trimIfString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

/** A required uuid: "pilih dari daftar", never typed by hand (ADR-002). */
export function uuidField(label: string) {
  return z.preprocess(
    trimIfString,
    z.uuid({ error: `${label} harus dipilih dari daftar.` }),
  );
}

/** An optional uuid FK. `""` from a cleared picker becomes `null`. */
export function optionalUuidField(label: string) {
  return z.preprocess(
    (value) => emptyToNull(trimIfString(value)),
    z
      .uuid({ error: `${label} harus dipilih dari daftar.` })
      .nullable()
      .default(null),
  );
}

/** A required free-text field. Trimmed; empty is rejected. */
export function requiredText(label: string, max = 255) {
  return z.preprocess(
    trimIfString,
    z
      .string({ error: `${label} wajib diisi.` })
      .min(1, { error: `${label} wajib diisi.` })
      .max(max, { error: `${label} maksimal ${max} karakter.` }),
  );
}

/** An optional free-text field. Trimmed; empty becomes `null`. */
export function optionalText(label: string, max = 255) {
  return z.preprocess(
    (value) => emptyToNull(trimIfString(value)),
    z
      .string()
      .max(max, { error: `${label} maksimal ${max} karakter.` })
      .nullable()
      .default(null),
  );
}

/**
 * An optional email column. Trimmed, **lowercased**, `""` becomes `null`.
 *
 * The lowercasing is not cosmetic. `employees.email_kantor` is guarded by a
 * unique index on `lower(email_kantor)`, so "Budi.S@…" and "budi.s@…" are
 * already one address as far as the database is concerned. Normalising here
 * means the column never holds two spellings the database considers equal —
 * and it matches what `import_from_payload()` writes, so the form and the
 * Impor cannot disagree about the same person.
 */
export function optionalEmailField(label: string, max = 255) {
  return z.preprocess(
    (value) => {
      const cleaned = emptyToNull(trimIfString(value));
      return typeof cleaned === "string" ? cleaned.toLowerCase() : cleaned;
    },
    z
      .email({ error: `${label} harus berupa alamat email yang benar.` })
      .max(max, { error: `${label} maksimal ${max} karakter.` })
      .nullable()
      .default(null),
  );
}

/**
 * A `date` column: `YYYY-MM-DD` (API-CONTRACT.md §Konvensi).
 *
 * `z.iso.date()` also rejects impossible calendar dates such as `2025-02-30`,
 * which an `<input type="date">` cannot produce but a pasted value can.
 */
export function dateField(label: string) {
  return z.preprocess(
    trimIfString,
    z.iso.date({ error: `${label} harus berformat YYYY-MM-DD.` }),
  );
}

/** An optional `date` column; `""` becomes `null`. */
export function optionalDateField(label: string) {
  return z.preprocess(
    (value) => emptyToNull(trimIfString(value)),
    z.iso
      .date({ error: `${label} harus berformat YYYY-MM-DD.` })
      .nullable()
      .default(null),
  );
}

/**
 * `status` on employees / org_units / jabatan / lookups / api_keys.
 *
 * Exactly the two values the CHECK constraints allow; there is no soft delete
 * and no third state (ADR-003).
 */
export const STATUS_VALUES = ["aktif", "nonaktif"] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

export const statusSchema = z.enum(STATUS_VALUES, {
  error: "Status hanya boleh 'aktif' atau 'nonaktif'.",
});

/** `profiles.role` — the two UI roles (ARCHITECTURE.md §5). */
export const ROLE_VALUES = ["admin", "viewer"] as const;
export type RoleValue = (typeof ROLE_VALUES)[number];

export const roleSchema = z.enum(ROLE_VALUES, {
  error: "Role hanya boleh 'admin' atau 'viewer'.",
});

/**
 * A `kode`: the stable half of a Data Referensi row.
 *
 * Kept deliberately permissive — seed data comes in dirty, and a kode is
 * never re-typed by a Konsumen. Whitespace at the edges is stripped so
 * "DIV-HC " and "DIV-HC" cannot become two different Unit Organisasi.
 */
export function kodeField(label = "Kode") {
  return z.preprocess(
    trimIfString,
    z
      .string({ error: `${label} wajib diisi.` })
      .min(1, { error: `${label} wajib diisi.` })
      .max(64, { error: `${label} maksimal 64 karakter.` }),
  );
}

/** `lookups.urutan` — optional sort order; `""` becomes `null`. */
export const urutanSchema = z.preprocess(
  (value) => {
    const cleaned = emptyToNull(trimIfString(value));
    if (cleaned === null) return null;
    if (typeof cleaned === "string" && /^-?\d+$/.test(cleaned)) {
      return Number.parseInt(cleaned, 10);
    }
    return cleaned;
  },
  z
    .number({ error: "Urutan harus berupa angka bulat." })
    .int({ error: "Urutan harus berupa angka bulat." })
    .nullable()
    .default(null),
);

/**
 * Flatten a `ZodError` into `{ field: "pesan" }` for a form, plus a list of
 * the messages for a toast. Shared so every Server Action reports failures the
 * same way.
 */
export function formatZodErrors(error: z.ZodError): {
  fieldErrors: Record<string, string>;
  messages: string[];
} {
  const fieldErrors: Record<string, string> = {};
  const messages: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    if (path && !(path in fieldErrors)) fieldErrors[path] = issue.message;
    messages.push(path ? `${path}: ${issue.message}` : issue.message);
  }
  return { fieldErrors, messages };
}
