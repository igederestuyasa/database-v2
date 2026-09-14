/**
 * Dummy Data Referensi: Unit Organisasi, Jabatan, Lookup.
 *
 * DUMMY DATA ONLY — invented units and job names, never HK's real ones
 * (CLAUDE.md). Shaped exactly like the table rows so a test or a picker can
 * use them without casting.
 *
 * The set is deliberately a little dirty, because the real one is:
 *   * `unitYatim` has an induk that is not in the set (a Temuan, PRD #11);
 *   * `divisiLama` is nonaktif and merged into `divisi` (PRD #10);
 *   * `stafLama` is a Jabatan nobody holds any more.
 */
import type { Jabatan, Lookup, OrgUnit } from "@/lib/types/db";

import { JABATAN_ID, LOOKUP_ID, ORG_UNIT_ID } from "./ids";

const WAKTU = "2026-01-02T03:04:05.000Z";

function orgUnit(row: Omit<OrgUnit, "created_at" | "updated_at">): OrgUnit {
  return { ...row, created_at: WAKTU, updated_at: WAKTU };
}

export const ORG_UNITS: OrgUnit[] = [
  orgUnit({
    id: ORG_UNIT_ID.direktorat,
    kode: "DIR-CONTOH",
    nama: "Direktorat Contoh",
    tipe: "direktorat",
    parent_id: null,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.divisi,
    kode: "DIV-CONTOH",
    nama: "Divisi Contoh",
    tipe: "divisi",
    parent_id: ORG_UNIT_ID.direktorat,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.departemen,
    kode: "DEP-CONTOH",
    nama: "Departemen Contoh",
    tipe: "departemen",
    parent_id: ORG_UNIT_ID.divisi,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.bagian,
    kode: "BAG-CONTOH",
    nama: "Bagian Contoh",
    tipe: "bagian",
    parent_id: ORG_UNIT_ID.departemen,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.subBagian,
    kode: "SUB-CONTOH",
    nama: "Sub Bagian Contoh",
    tipe: "sub_bagian",
    parent_id: ORG_UNIT_ID.bagian,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.proyek,
    kode: "PRY-CONTOH",
    nama: "Proyek Contoh",
    tipe: "proyek",
    parent_id: ORG_UNIT_ID.divisi,
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    // Induk tidak ada di kumpulan ini — Temuan "unit tanpa induk" (PRD #11).
    id: ORG_UNIT_ID.yatim,
    kode: "BAG-YATIM",
    nama: "Bagian Tanpa Induk",
    tipe: "bagian",
    parent_id: "99999999-9999-4999-8999-999999999999",
    status: "aktif",
    merged_into_id: null,
  }),
  orgUnit({
    id: ORG_UNIT_ID.divisiLama,
    kode: "DIV-LAMA",
    nama: "DIVISI CONTOH",
    tipe: "divisi",
    parent_id: ORG_UNIT_ID.direktorat,
    status: "nonaktif",
    merged_into_id: ORG_UNIT_ID.divisi,
  }),
];

function jabatan(row: Omit<Jabatan, "created_at" | "updated_at">): Jabatan {
  return { ...row, created_at: WAKTU, updated_at: WAKTU };
}

export const JABATAN: Jabatan[] = [
  jabatan({
    id: JABATAN_ID.manager,
    kode: "JBT-001",
    nama: "Manager Contoh",
    status: "aktif",
    merged_into_id: null,
  }),
  jabatan({
    id: JABATAN_ID.staf,
    kode: "JBT-002",
    nama: "Staf Contoh",
    status: "aktif",
    merged_into_id: null,
  }),
  jabatan({
    id: JABATAN_ID.stafLama,
    kode: "JBT-003",
    nama: "STAF CONTOH",
    status: "nonaktif",
    merged_into_id: JABATAN_ID.staf,
  }),
];

function lookup(row: Omit<Lookup, "created_at" | "updated_at">): Lookup {
  return { ...row, created_at: WAKTU, updated_at: WAKTU };
}

export const LOOKUPS: Lookup[] = [
  lookup({
    id: LOOKUP_ID.genderPria,
    tipe: "gender",
    kode: "L",
    label: "Laki-laki",
    urutan: 1,
    status: "aktif",
    merged_into_id: null,
  }),
  lookup({
    id: LOOKUP_ID.genderWanita,
    tipe: "gender",
    kode: "P",
    label: "Perempuan",
    urutan: 2,
    status: "aktif",
    merged_into_id: null,
  }),
  lookup({
    id: LOOKUP_ID.jobGradeA,
    tipe: "job_grade",
    kode: "JG-A",
    label: "Pratama I - 11",
    urutan: 1,
    status: "aktif",
    merged_into_id: null,
  }),
  lookup({
    id: LOOKUP_ID.jobGradeB,
    tipe: "job_grade",
    kode: "JG-B",
    label: "Pratama II - 12",
    urutan: 2,
    status: "aktif",
    merged_into_id: null,
  }),
  lookup({
    id: LOOKUP_ID.personGradeA,
    tipe: "person_grade",
    kode: "PG-A",
    label: "Pratama I",
    urutan: 1,
    status: "aktif",
    merged_into_id: null,
  }),
  lookup({
    id: LOOKUP_ID.workContractTetap,
    tipe: "work_contract",
    kode: "TETAP",
    label: "Karyawan Tetap",
    urutan: 1,
    status: "aktif",
    merged_into_id: null,
  }),
];
