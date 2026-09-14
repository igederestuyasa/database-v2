/**
 * The one zod schema for Lookup, shared by form and Server Action.
 *
 * FROZEN CONTRACT (Wave 1). Mirrors `public.lookups`:
 *
 *   * `tipe` CHECK IN (the 11 values of `LOOKUP_TYPES`) — that list is frozen
 *     in `lib/validation/lookupTypes.ts` and is compared against the migration
 *     by `lib/validation/lookupTypes.test.ts` and `verify-schema.sql` §17.
 *   * `kode` NOT NULL, `label` NOT NULL, UNIQUE `(tipe, kode)`.
 *   * `urutan` nullable `integer`.
 *   * `status` CHECK IN ('aktif','nonaktif').
 *
 * `tipe` is intentionally **not** editable after creation: the FK column on
 * `employees` is chosen by tipe (`job_grade` → `job_grade_id`), so changing it
 * would orphan every Karyawan pointing at the row. Move the value with a Merge
 * instead (PRD #10).
 */
import { z } from "zod";

import { LOOKUP_TYPES } from "./lookupTypes";
import { kodeField, requiredText, statusSchema, urutanSchema, uuidField } from "./common";

export const lookupTypeSchema = z.enum(LOOKUP_TYPES, {
  error: "Tipe Lookup tidak dikenal.",
});

export const lookupFieldsSchema = z.object({
  tipe: lookupTypeSchema,
  kode: kodeField("Kode Lookup"),
  label: requiredText("Label", 255),
  urutan: urutanSchema,
  status: statusSchema.default("aktif"),
});

/** Tambah Lookup (PRD #9). */
export const lookupCreateSchema = lookupFieldsSchema;

/** Ubah Lookup (PRD #9). `tipe` is fixed at creation — see the header. */
export const lookupUpdateSchema = lookupFieldsSchema
  .omit({ tipe: true })
  .partial()
  // `status` without its default — see the note in `lib/validation/employee.ts`.
  .extend({ id: uuidField("Lookup"), status: statusSchema.optional() });

/** Ganti label saja — Batch jenis `rename`. */
export const lookupRenameSchema = z.object({
  id: uuidField("Lookup"),
  label: requiredText("Label", 255),
});

export type LookupFields = z.infer<typeof lookupFieldsSchema>;
export type LookupCreateInput = z.infer<typeof lookupCreateSchema>;
export type LookupUpdateInput = z.infer<typeof lookupUpdateSchema>;
export type LookupRenameInput = z.infer<typeof lookupRenameSchema>;
