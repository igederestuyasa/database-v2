/**
 * The one zod schema for Jabatan, shared by form and Server Action.
 *
 * FROZEN CONTRACT (Wave 1). Mirrors `public.jabatan`: `kode` NOT NULL UNIQUE,
 * `nama` NOT NULL, `status` CHECK IN ('aktif','nonaktif'). Nothing else — a
 * Jabatan is a *nama pekerjaan*, not a seat: no unit, no quota, no holder
 * count (ADR-002). Anything that looks like Formasi belongs to a future ADR,
 * not to this schema.
 */
import { z } from "zod";

import { kodeField, requiredText, statusSchema, uuidField } from "./common";

export const jabatanFieldsSchema = z.object({
  kode: kodeField("Kode Jabatan"),
  nama: requiredText("Nama Jabatan", 255),
  status: statusSchema.default("aktif"),
});

/** Tambah Jabatan (PRD #8). */
export const jabatanCreateSchema = jabatanFieldsSchema;

/** Ubah Jabatan (PRD #8). */
export const jabatanUpdateSchema = jabatanFieldsSchema
  .partial()
  // `status` without its default — see the note in `lib/validation/employee.ts`.
  .extend({ id: uuidField("Jabatan"), status: statusSchema.optional() });

/**
 * Ganti nama Jabatan (PRD #8) — the canonical small write.
 *
 * Renaming reaches every holder through `v_employees.jabatan_nama`; no
 * `employees` row is touched, so the Batch contains exactly one Revisi.
 * `lib/actions/_reference.ts` implements this end to end as the template every
 * other Server Action copies.
 */
export const jabatanRenameSchema = z.object({
  id: uuidField("Jabatan"),
  nama: requiredText("Nama Jabatan", 255),
});

export type JabatanFields = z.infer<typeof jabatanFieldsSchema>;
export type JabatanCreateInput = z.infer<typeof jabatanCreateSchema>;
export type JabatanUpdateInput = z.infer<typeof jabatanUpdateSchema>;
export type JabatanRenameInput = z.infer<typeof jabatanRenameSchema>;
