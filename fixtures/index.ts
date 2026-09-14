/**
 * Fixtures — dummy data for tests and for any unit that needs a plausible row.
 *
 * DUMMY DATA ONLY. Never a real Karyawan, a real NIP, a real Personnel Number
 * or a real Unit Organisasi name — not here, not in a test, not in a snapshot
 * (CLAUDE.md; PRD §8 Privasi: employee data is personal data under UU PDP).
 *
 *     import { EMPLOYEES, ORG_UNITS, ASOF } from "@/fixtures";
 */
export {
  API_KEY_ID,
  BATCH_ID,
  EMPLOYEE_ID,
  JABATAN_ID,
  LOOKUP_ID,
  ORG_UNIT_ID,
  PROFILE_ID,
} from "./ids";

export { JABATAN, LOOKUPS, ORG_UNITS } from "./referensi";

export { ASOF, EMPLOYEES, EMPLOYEE_PRIVATE } from "./employees";

export {
  BATCHES,
  REVISIONS,
  REVISI_EDIT_KARYAWAN,
  REVISI_EDIT_KARYAWAN_LANJUTAN,
  REVISI_INSERT_PROFIL,
  REVISI_INSERT_UNIT,
  REVISI_KOLOM_ASING,
  REVISI_TABEL_ASING,
  REVISI_UPDATE_PRIVATE,
  REVISI_UPDATE_PROFIL,
} from "./revisions";

export {
  DERIVED_EXPECTATIONS,
  PG_AGE_CASES,
  type DerivedExpectation,
} from "./derived";
