/**
 * Fixed uuids for fixtures, readable at a glance.
 *
 * DUMMY DATA ONLY. No real Karyawan, no real NIP, no real Personnel Number
 * ever enters this repository — not in fixtures, not in tests (CLAUDE.md).
 *
 * The shape is a valid v4 uuid whose tail spells out what it is, so a failing
 * assertion prints something a human can place:
 *     11111111-1111-4111-8111-000000000001  → org unit #1
 */
function id(group: string, n: number): string {
  const block = group.repeat(8).slice(0, 8);
  return `${block}-${block.slice(0, 4)}-4${block.slice(0, 3)}-8${block.slice(0, 3)}-${String(n).padStart(12, "0")}`;
}

export const ORG_UNIT_ID = {
  direktorat: id("1", 1),
  divisi: id("1", 2),
  departemen: id("1", 3),
  bagian: id("1", 4),
  subBagian: id("1", 5),
  proyek: id("1", 6),
  /** Its `parent_id` points at a unit that is not in the fixture set. */
  yatim: id("1", 7),
  /** Nonaktif, already merged into `divisi`. */
  divisiLama: id("1", 8),
} as const;

export const JABATAN_ID = {
  manager: id("2", 1),
  staf: id("2", 2),
  stafLama: id("2", 3),
} as const;

export const LOOKUP_ID = {
  genderPria: id("3", 1),
  genderWanita: id("3", 2),
  jobGradeA: id("3", 3),
  jobGradeB: id("3", 4),
  personGradeA: id("3", 5),
  workContractTetap: id("3", 6),
} as const;

export const EMPLOYEE_ID = {
  lengkap: id("4", 1),
  tanpaUnit: id("4", 2),
  nonaktif: id("4", 3),
  baru: id("4", 4),
} as const;

export const BATCH_ID = {
  edit: id("5", 1),
  merge: id("5", 2),
  seed: id("5", 3),
  revert: id("5", 4),
} as const;

export const PROFILE_ID = {
  admin: id("6", 1),
  viewer: id("6", 2),
} as const;

export const API_KEY_ID = {
  perfApp: id("7", 1),
} as const;
