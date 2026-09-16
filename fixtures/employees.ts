/**
 * Dummy Karyawan.
 *
 * DUMMY DATA ONLY. Invented names ("Budi Contoh"), invented Personnel Numbers
 * in an obviously fake range, invented dates. No real employee data ever enters
 * this repository (CLAUDE.md, PRD §8 Privasi).
 *
 * `ASOF` is the fixed "today" every derived-column test computes against, so
 * the expected values in `fixtures/derived.ts` never go stale.
 */
import type { Employee, EmployeePrivate } from "@/lib/types/db";

import { EMPLOYEE_ID, JABATAN_ID, LOOKUP_ID, ORG_UNIT_ID } from "./ids";

/** The fixed reference date for every derived-column expectation. */
export const ASOF = "2026-09-14";

const WAKTU = "2026-01-02T03:04:05.000Z";

function employee(
  overrides: Partial<Employee> & Pick<Employee, "id" | "personnel_number" | "full_name">,
): Employee {
  return {
    nip: null,
    email_kantor: null,
    org_unit_id: null,
    jabatan_id: null,
    gender_id: null,
    work_contract_id: null,
    person_grade_id: null,
    job_grade_id: null,
    legal_entity_id: null,
    klasifikasi_rekrutmen_id: null,
    teknik_non_teknik_id: null,
    bod_range_id: null,
    band_jabatan_id: null,
    kategori_penempatan_id: null,
    kategori_fungsi_id: null,
    keterangan_pj_plt: null,
    keterangan_rangkap_1: null,
    keterangan_rangkap_2: null,
    keterangan: null,
    jurusan: null,
    original_start_date: null,
    tanggal_diangkat: null,
    tanggal_promosi_pg: null,
    tanggal_promosi_jg: null,
    tanggal_keluar: null,
    nomor_surat_pg: null,
    nomor_surat_jg: null,
    status: "aktif",
    created_at: WAKTU,
    updated_at: WAKTU,
    ...overrides,
  };
}

export const EMPLOYEES: Employee[] = [
  employee({
    id: EMPLOYEE_ID.lengkap,
    personnel_number: "TEST-0001",
    nip: "TESTNIP0001",
    full_name: "Budi Contoh",
    email_kantor: "budi.contoh@contoh.test",
    org_unit_id: ORG_UNIT_ID.subBagian,
    jabatan_id: JABATAN_ID.manager,
    gender_id: LOOKUP_ID.genderPria,
    job_grade_id: LOOKUP_ID.jobGradeA,
    person_grade_id: LOOKUP_ID.personGradeA,
    work_contract_id: LOOKUP_ID.workContractTetap,
    jurusan: "Teknik Sipil",
    // 3 tahun 4 bulan sebelum ASOF.
    original_start_date: "2023-05-14",
    tanggal_diangkat: "2024-01-01",
    tanggal_promosi_pg: "2022-09-14",
    tanggal_promosi_jg: "2025-12-31",
    nomor_surat_pg: "SK/CONTOH/PG/001",
    nomor_surat_jg: "SK/CONTOH/JG/001",
  }),
  employee({
    // Temuan: Karyawan tanpa Unit Organisasi dan tanpa Jabatan (PRD #11).
    id: EMPLOYEE_ID.tanpaUnit,
    personnel_number: "TEST-0002",
    full_name: "Siti Contoh",
    gender_id: LOOKUP_ID.genderWanita,
    original_start_date: "2020-02-29",
  }),
  employee({
    id: EMPLOYEE_ID.nonaktif,
    personnel_number: "TEST-0003",
    nip: "TESTNIP0003",
    full_name: "Agus Contoh",
    org_unit_id: ORG_UNIT_ID.proyek,
    jabatan_id: JABATAN_ID.staf,
    status: "nonaktif",
    original_start_date: "2015-08-17",
    tanggal_keluar: "2026-03-31",
  }),
  employee({
    // Tanggal mulai di masa depan — data kotor yang memang ada di seed.
    id: EMPLOYEE_ID.baru,
    personnel_number: "TEST-0004",
    full_name: "Dewi Contoh",
    org_unit_id: ORG_UNIT_ID.divisi,
    jabatan_id: JABATAN_ID.staf,
    original_start_date: "2027-01-01",
  }),
];

/**
 * Data Pribadi Sensitif for the dummy Karyawan (PRD #22).
 *
 * One row per Karyawan exists in the database from the moment they are created
 * (the `zz_autocreate_private` trigger), all columns NULL — which is why only
 * some of these are filled in.
 */
export const EMPLOYEE_PRIVATE: EmployeePrivate[] = [
  {
    employee_id: EMPLOYEE_ID.lengkap,
    date_of_birth: "1980-02-29",
    place_of_birth: "Kota Contoh",
    religion: "Islam",
    marital_status: "Menikah",
    created_at: WAKTU,
    updated_at: WAKTU,
  },
  {
    employee_id: EMPLOYEE_ID.tanpaUnit,
    date_of_birth: null,
    place_of_birth: null,
    religion: null,
    marital_status: null,
    created_at: WAKTU,
    updated_at: WAKTU,
  },
];
