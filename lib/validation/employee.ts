/**
 * The one zod schema for Karyawan, shared by the form and the Server Action
 * (ARCHITECTURE.md §1: "validasi satu skema untuk client & server").
 *
 * FROZEN CONTRACT (Wave 1). It mirrors `public.employees` in
 * `supabase/migrations/0001_init.sql` — not an idea of what a Karyawan is:
 *
 *   * `personnel_number` NOT NULL UNIQUE — the business key (CONTEXT.md).
 *   * `nip` UNIQUE but **nullable** — a second, different code; optional here.
 *   * `full_name` NOT NULL.
 *   * every `*_id` is a nullable uuid FK; the matching `lookups.tipe` is
 *     enforced by the `employees_validate_lookups` trigger, so a wrong-tipe id
 *     fails in the database even if it is a valid uuid.
 *   * `status` CHECK IN ('aktif','nonaktif'), default 'aktif'.
 *   * every date column is nullable `date`.
 *
 * Uniqueness is not checked here — only the database can promise that. Use
 * `isPersonnelNumberTaken()` / `isNipTaken()` from `lib/db/employees.ts` for
 * the friendly message, and let the UNIQUE constraint be the real guard.
 */
import { z } from "zod";

import {
  dateField,
  optionalDateField,
  optionalText,
  optionalUuidField,
  requiredText,
  statusSchema,
  uuidField,
} from "./common";

/** Every editable column of `employees`, in migration order. */
export const employeeFieldsSchema = z.object({
  personnel_number: requiredText("Personnel Number", 64),
  nip: optionalText("NIP", 64),
  full_name: requiredText("Nama", 255),

  org_unit_id: optionalUuidField("Unit Organisasi"),
  jabatan_id: optionalUuidField("Jabatan"),

  gender_id: optionalUuidField("Jenis Kelamin"),
  work_contract_id: optionalUuidField("Work Contract"),
  person_grade_id: optionalUuidField("Person Grade"),
  job_grade_id: optionalUuidField("Job Grade"),
  legal_entity_id: optionalUuidField("Legal Entity"),
  klasifikasi_rekrutmen_id: optionalUuidField("Klasifikasi Rekrutmen"),
  teknik_non_teknik_id: optionalUuidField("Teknik / Non Teknik"),
  bod_range_id: optionalUuidField("BoD Range"),
  band_jabatan_id: optionalUuidField("Band Jabatan"),
  kategori_penempatan_id: optionalUuidField("Kategori Penempatan"),
  kategori_fungsi_id: optionalUuidField("Kategori Fungsi"),

  keterangan_pj_plt: optionalText("Keterangan PJ/PLT", 255),
  // Two separate columns on purpose: the source Excel has two identically
  // named headers and merging them loses data (CLAUDE.md).
  keterangan_rangkap_1: optionalText("Keterangan Rangkap 1", 255),
  keterangan_rangkap_2: optionalText("Keterangan Rangkap 2", 255),
  keterangan: optionalText("Keterangan", 1000),
  jurusan: optionalText("Jurusan", 255),

  original_start_date: optionalDateField("Original Start Date"),
  tanggal_diangkat: optionalDateField("Tanggal Diangkat"),
  tanggal_promosi_pg: optionalDateField("Tanggal Promosi PG"),
  tanggal_promosi_jg: optionalDateField("Tanggal Promosi JG"),
  tanggal_keluar: optionalDateField("Tanggal Keluar"),

  nomor_surat_pg: optionalText("Nomor Surat PG", 255),
  nomor_surat_jg: optionalText("Nomor Surat JG", 255),

  status: statusSchema.default("aktif"),
});

/** Tambah Karyawan (PRD #3). */
export const employeeCreateSchema = employeeFieldsSchema;

/**
 * Ubah Karyawan (PRD #4).
 *
 * Every other field is optional so a form can submit only what it touched; an
 * absent key means "leave this column alone", while an explicit `null` clears
 * it. `id` is required, as it is in every update schema here — zod strips
 * unknown keys, so an action that destructured `id` out of a schema that did
 * not declare it would get `undefined` and update nothing.
 *
 * `status` is re-declared without its default ON PURPOSE. `.partial()` makes a
 * key optional but does NOT remove a `.default()` underneath it, so
 * `employeeFieldsSchema.partial().parse({ full_name })` would hand back
 * `status: "aktif"` — and editing a nonaktif Karyawan's name would quietly
 * bring them back to life. Every update schema in this folder does the same.
 */
export const employeeUpdateSchema = employeeFieldsSchema
  .partial()
  .extend({ id: uuidField("Karyawan"), status: statusSchema.optional() });

/**
 * Nonaktifkan Karyawan (PRD #5).
 *
 * The date is required here even though the column is nullable: PRD #5 is
 * "menandai karyawan sebagai nonaktif **beserta tanggal keluar**", and a
 * nonaktif Karyawan without one cannot be told apart from dirty seed data.
 */
export const employeeDeactivateSchema = z.object({
  id: uuidField("Karyawan"),
  tanggal_keluar: dateField("Tanggal Keluar"),
  keterangan: optionalText("Keterangan", 1000),
});

/** Aktifkan kembali (undo of the above); the exit date is cleared. */
export const employeeReactivateSchema = z.object({
  id: uuidField("Karyawan"),
  keterangan: optionalText("Keterangan", 1000),
});

/**
 * Data Pribadi Sensitif (PRD #22) — a separate table, admin only.
 *
 * All four columns are nullable `text`/`date` with no CHECK constraint, so
 * they are validated as free text: agama and status pernikahan are written as
 * they appear on the document, not picked from a list.
 */
export const employeePrivateSchema = z.object({
  date_of_birth: optionalDateField("Tanggal Lahir"),
  place_of_birth: optionalText("Tempat Lahir", 255),
  religion: optionalText("Agama", 64),
  marital_status: optionalText("Status Pernikahan", 64),
});

export type EmployeeFields = z.infer<typeof employeeFieldsSchema>;
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmployeeDeactivateInput = z.infer<typeof employeeDeactivateSchema>;
export type EmployeeReactivateInput = z.infer<typeof employeeReactivateSchema>;
export type EmployeePrivateInput = z.infer<typeof employeePrivateSchema>;
