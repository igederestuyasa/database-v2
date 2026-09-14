/**
 * The one zod schema for Unit Organisasi, shared by form and Server Action.
 *
 * FROZEN CONTRACT (Wave 1). Mirrors `public.org_units`:
 *
 *   * `kode` NOT NULL UNIQUE — stable, never changed after creation.
 *   * `nama` NOT NULL — may be renamed; the rename reaches every Karyawan
 *     below it through the view, with no Karyawan row touched (PRD #7).
 *   * `tipe` CHECK IN (six values) — `ORG_UNIT_TYPES` below is that list, and
 *     `lib/validation/constraints.test.ts` fails if the two ever drift.
 *   * `parent_id` nullable FK — NULL is *meant* only for `direktorat`, but is
 *     deliberately not constrained in the database so dirty seed data can land
 *     and be reported on "Perlu Dibereskan" instead (ARCHITECTURE.md §3). The
 *     schema follows the database and does not require it either.
 *   * cycles are refused by the `org_units_no_cycle` trigger; the only case
 *     visible to a schema (a unit as its own induk) is rejected here too.
 */
import { z } from "zod";

import { kodeField, optionalUuidField, requiredText, statusSchema, uuidField } from "./common";

/** `org_units.tipe` — byte-identical to the CHECK constraint in 0001_init.sql. */
export const ORG_UNIT_TYPES = [
  "direktorat",
  "divisi",
  "departemen",
  "bagian",
  "sub_bagian",
  "proyek",
] as const;

export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

export function isOrgUnitType(value: unknown): value is OrgUnitType {
  return (
    typeof value === "string" && (ORG_UNIT_TYPES as readonly string[]).includes(value)
  );
}

export const orgUnitTypeSchema = z.enum(ORG_UNIT_TYPES, {
  error: "Tipe Unit Organisasi tidak dikenal.",
});

export const orgUnitFieldsSchema = z.object({
  kode: kodeField("Kode Unit Organisasi"),
  nama: requiredText("Nama Unit Organisasi", 255),
  tipe: orgUnitTypeSchema,
  parent_id: optionalUuidField("Induk"),
  status: statusSchema.default("aktif"),
});

/** Tambah Unit Organisasi (PRD #7). */
export const orgUnitCreateSchema = orgUnitFieldsSchema;

/**
 * Ubah Unit Organisasi (PRD #7).
 *
 * `id` travels with the payload so the "tidak boleh jadi induk dirinya
 * sendiri" rule can be checked before the round trip; the database enforces
 * the full cycle check regardless.
 */
export const orgUnitUpdateSchema = orgUnitFieldsSchema
  .partial()
  // `status` without its default: `.partial()` keeps a `.default()` underneath
  // it, so an omitted status would reactivate a unit that had been merged away.
  .extend({ id: uuidField("Unit Organisasi"), status: statusSchema.optional() })
  .refine((value) => !value.parent_id || value.parent_id !== value.id, {
    error: "Unit Organisasi tidak boleh menjadi induk dirinya sendiri.",
    path: ["parent_id"],
  });

/** Ganti nama saja — the common case, and its own Batch jenis (`rename`). */
export const orgUnitRenameSchema = z.object({
  id: uuidField("Unit Organisasi"),
  nama: requiredText("Nama Unit Organisasi", 255),
});

/** Pindahkan ke induk lain. `parent_id: null` makes it a root. */
export const orgUnitMoveSchema = z
  .object({
    id: uuidField("Unit Organisasi"),
    parent_id: optionalUuidField("Induk"),
  })
  .refine((value) => !value.parent_id || value.parent_id !== value.id, {
    error: "Unit Organisasi tidak boleh menjadi induk dirinya sendiri.",
    path: ["parent_id"],
  });

export type OrgUnitFields = z.infer<typeof orgUnitFieldsSchema>;
export type OrgUnitCreateInput = z.infer<typeof orgUnitCreateSchema>;
export type OrgUnitUpdateInput = z.infer<typeof orgUnitUpdateSchema>;
export type OrgUnitRenameInput = z.infer<typeof orgUnitRenameSchema>;
export type OrgUnitMoveInput = z.infer<typeof orgUnitMoveSchema>;
