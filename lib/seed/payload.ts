/**
 * lib/seed/payload.ts — the contract between the Seed page and
 * `seed_from_payload()` (PRD #23, ADR-008).
 *
 * A `SeedPlan` is what `planSeed()` produces in the admin's browser. It is not
 * what the database receives, for two reasons:
 *
 *   * the plan's identity keys join their parts with NUL (U+0000), which `jsonb`
 *     refuses ("unsupported Unicode escape sequence"); and
 *   * the keys are long paths repeated on every Karyawan — for 1.500 rows the
 *     raw plan is ~1,8 MB of JSON, the index form below ~1,0 MB.
 *
 * So the page sends a `SeedPayload`: the same four lists, with every reference
 * replaced by the **0-based index** of the row it points at. The Postgres
 * function resolves indexes to ids in the order the arrays are given; for
 * `org_units` that order already puts parents before children (`planSeed()`
 * guarantees it, and the schema below checks it again).
 *
 * PURE ON PURPOSE, like `excelMapping.ts`: no I/O, no clock, importable from
 * the Client Component, the Server Action and the tests alike.
 *
 * `seedPayloadSchema` is the server's guard. The browser is an admin's
 * browser, but it is still a browser: whatever arrives is re-checked here for
 * shape, size and internal consistency before it is handed to the RPC, and
 * the RPC checks the parts only the database can know (uniqueness against
 * existing rows, CHECK constraints, RLS).
 */
import { z } from "zod";

import { LOOKUP_TYPES, type LookupType } from "../validation/lookupTypes";

import type { PlannedEmployee, SeedPlan } from "./excelMapping";

// ---------------------------------------------------------------------------
// 1. Shape
// ---------------------------------------------------------------------------

/** `employees` text columns the Seed fills besides the three identity ones. */
export const SEED_TEXT_FIELDS = [
  "email_kantor",
  "keterangan_pj_plt",
  "keterangan_rangkap_1",
  "keterangan_rangkap_2",
  "keterangan",
  "jurusan",
  "nomor_surat_pg",
  "nomor_surat_jg",
] as const;

/** `employees` date columns the Seed fills. */
export const SEED_DATE_FIELDS = [
  "original_start_date",
  "tanggal_diangkat",
  "tanggal_promosi_pg",
  "tanggal_promosi_jg",
  "tanggal_keluar",
] as const;

export type SeedTextField = (typeof SEED_TEXT_FIELDS)[number];
export type SeedDateField = (typeof SEED_DATE_FIELDS)[number];

export const ORG_UNIT_TIPE = [
  "direktorat",
  "divisi",
  "departemen",
  "bagian",
  "sub_bagian",
  "proyek",
] as const;

export type SeedPayloadOrgUnit = {
  kode: string;
  nama: string;
  tipe: (typeof ORG_UNIT_TIPE)[number];
  /** Index into `org_units`, always smaller than this row's own index. */
  parent: number | null;
};

export type SeedPayloadJabatan = { kode: string; nama: string };

export type SeedPayloadLookup = {
  tipe: LookupType;
  kode: string;
  label: string;
  urutan: number;
};

export type SeedPayloadPrivate = {
  date_of_birth: string | null;
  place_of_birth: string | null;
  religion: string | null;
  marital_status: string | null;
};

export type SeedPayloadEmployee = {
  personnel_number: string;
  nip: string | null;
  full_name: string;
  status: "aktif" | "nonaktif";
  /** Index into `org_units`, or null (Temuan "karyawan tanpa unit"). */
  org: number | null;
  /** Index into `jabatan`, or null. */
  jab: number | null;
  /** Per Lookup tipe, the index into `lookups`; the row there has that tipe. */
  lk: Partial<Record<LookupType, number>>;
  text: Partial<Record<SeedTextField, string>>;
  dates: Partial<Record<SeedDateField, string>>;
  /** null when the row has no Data Pribadi Sensitif at all. */
  private: SeedPayloadPrivate | null;
};

export type SeedPayload = {
  org_units: readonly SeedPayloadOrgUnit[];
  jabatan: readonly SeedPayloadJabatan[];
  lookups: readonly SeedPayloadLookup[];
  employees: readonly SeedPayloadEmployee[];
};

/**
 * Hard ceilings. The company is ±1.500 people; a payload past these is not a
 * bigger company, it is a wrong file or a tampered request.
 */
export const SEED_LIMITS = {
  employees: 5000,
  orgUnits: 2000,
  jabatan: 2000,
  lookups: 2000,
  teks: 500,
} as const;

// ---------------------------------------------------------------------------
// 2. Plan → payload
// ---------------------------------------------------------------------------

function pickText(
  text: PlannedEmployee["text"],
): Partial<Record<SeedTextField, string>> {
  const out: Partial<Record<SeedTextField, string>> = {};
  for (const field of SEED_TEXT_FIELDS) {
    const value = text[field];
    if (typeof value === "string" && value.length > 0) out[field] = value;
  }
  return out;
}

function pickDates(
  dates: PlannedEmployee["dates"],
): Partial<Record<SeedDateField, string>> {
  const out: Partial<Record<SeedDateField, string>> = {};
  for (const field of SEED_DATE_FIELDS) {
    const value = dates[field];
    if (typeof value === "string" && value.length > 0) out[field] = value;
  }
  return out;
}

function pickPrivate(
  priv: PlannedEmployee["private"],
): SeedPayloadPrivate | null {
  const anyValue =
    priv.date_of_birth !== null ||
    priv.place_of_birth !== null ||
    priv.religion !== null ||
    priv.marital_status !== null;
  return anyValue
    ? {
        date_of_birth: priv.date_of_birth,
        place_of_birth: priv.place_of_birth,
        religion: priv.religion,
        marital_status: priv.marital_status,
      }
    : null;
}

/**
 * Turn a plan into the wire form. Throws only on a plan that violates its own
 * invariants (a reference to a key that is not in the plan) — that is a bug in
 * `planSeed()`, not something the admin can fix in Excel.
 */
export function buildSeedPayload(plan: SeedPlan): SeedPayload {
  const orgIndex = new Map(plan.orgUnits.map((unit, i) => [unit.key, i] as const));
  const jabIndex = new Map(plan.jabatan.map((row, i) => [row.key, i] as const));
  const lookupIndex = new Map(plan.lookups.map((row, i) => [row.key, i] as const));

  const resolve = (map: Map<string, number>, key: string | null, what: string) => {
    if (key === null) return null;
    const index = map.get(key);
    if (index === undefined) {
      throw new Error(`Rencana Seed rusak: ${what} "${key}" tidak ada di daftarnya.`);
    }
    return index;
  };

  return {
    org_units: plan.orgUnits.map((unit) => ({
      kode: unit.kode,
      nama: unit.nama,
      tipe: unit.tipe,
      parent: resolve(orgIndex, unit.parentKey, "induk Unit Organisasi"),
    })),
    jabatan: plan.jabatan.map((row) => ({ kode: row.kode, nama: row.nama })),
    lookups: plan.lookups.map((row) => ({
      tipe: row.tipe,
      kode: row.kode,
      label: row.label,
      urutan: row.urutan,
    })),
    employees: plan.employees.map((employee) => {
      const lk: Partial<Record<LookupType, number>> = {};
      for (const tipe of LOOKUP_TYPES) {
        const key = employee.lookupKeys[tipe];
        if (key !== undefined) lk[tipe] = resolve(lookupIndex, key, `Lookup ${tipe}`) as number;
      }
      return {
        personnel_number: employee.personnel_number,
        nip: employee.nip,
        full_name: employee.full_name,
        status: employee.status,
        org: resolve(orgIndex, employee.orgUnitKey, "Unit Organisasi"),
        jab: resolve(jabIndex, employee.jabatanKey, "Jabatan"),
        lk,
        text: pickText(employee.text),
        dates: pickDates(employee.dates),
        private: pickPrivate(employee.private),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. The server's guard
// ---------------------------------------------------------------------------

const teks = (label: string) =>
  z
    .string({ error: `${label} harus berupa teks.` })
    .min(1, { error: `${label} tidak boleh kosong.` })
    .max(SEED_LIMITS.teks, { error: `${label} maksimal ${SEED_LIMITS.teks} karakter.` });

const teksOpsional = (label: string) =>
  z
    .string({ error: `${label} harus berupa teks.` })
    .max(SEED_LIMITS.teks, { error: `${label} maksimal ${SEED_LIMITS.teks} karakter.` })
    .nullable();

const tanggal = (label: string) =>
  z.iso.date({ error: `${label} harus berformat YYYY-MM-DD.` });

const indeks = (label: string) =>
  z
    .number({ error: `${label} harus berupa angka.` })
    .int({ error: `${label} harus bilangan bulat.` })
    .nonnegative({ error: `${label} tidak boleh negatif.` });

const lookupTipe = z.enum(LOOKUP_TYPES, { error: "Tipe Lookup tidak dikenal." });

const orgUnitSchema = z.object({
  kode: teks("Kode Unit Organisasi"),
  nama: teks("Nama Unit Organisasi"),
  tipe: z.enum(ORG_UNIT_TIPE, { error: "Tipe Unit Organisasi tidak dikenal." }),
  parent: indeks("Induk Unit Organisasi").nullable(),
});

const jabatanSchema = z.object({
  kode: teks("Kode Jabatan"),
  nama: teks("Nama Jabatan"),
});

const lookupSchema = z.object({
  tipe: lookupTipe,
  kode: teks("Kode Lookup"),
  label: teks("Label Lookup"),
  urutan: indeks("Urutan Lookup"),
});

const privateSchema = z
  .object({
    date_of_birth: tanggal("Tanggal lahir").nullable(),
    place_of_birth: teksOpsional("Tempat lahir"),
    religion: teksOpsional("Agama"),
    marital_status: teksOpsional("Status pernikahan"),
  })
  .nullable();

const textSchema = z.object(
  Object.fromEntries(
    SEED_TEXT_FIELDS.map((field) => [field, teks(field).optional()]),
  ) as Record<SeedTextField, z.ZodOptional<z.ZodString>>,
);

const datesSchema = z.object(
  Object.fromEntries(
    SEED_DATE_FIELDS.map((field) => [field, tanggal(field).optional()]),
  ) as Record<SeedDateField, z.ZodOptional<ReturnType<typeof tanggal>>>,
);

const lkSchema = z.object(
  Object.fromEntries(
    LOOKUP_TYPES.map((tipe) => [tipe, indeks(`Lookup ${tipe}`).optional()]),
  ) as Record<LookupType, z.ZodOptional<ReturnType<typeof indeks>>>,
);

const employeeSchema = z.object({
  personnel_number: teks("Personnel Number"),
  nip: teksOpsional("NIP"),
  full_name: teks("Nama"),
  status: z.enum(["aktif", "nonaktif"], { error: "Status harus aktif atau nonaktif." }),
  org: indeks("Unit Organisasi").nullable(),
  jab: indeks("Jabatan").nullable(),
  lk: lkSchema,
  text: textSchema,
  dates: datesSchema,
  private: privateSchema,
});

/**
 * Everything a payload must satisfy before the RPC sees it. The per-field
 * rules above; the cross-references below.
 */
export const seedPayloadSchema = z
  .object({
    org_units: z
      .array(orgUnitSchema)
      .max(SEED_LIMITS.orgUnits, { error: `Maksimal ${SEED_LIMITS.orgUnits} Unit Organisasi.` }),
    jabatan: z
      .array(jabatanSchema)
      .max(SEED_LIMITS.jabatan, { error: `Maksimal ${SEED_LIMITS.jabatan} Jabatan.` }),
    lookups: z
      .array(lookupSchema)
      .max(SEED_LIMITS.lookups, { error: `Maksimal ${SEED_LIMITS.lookups} Lookup.` }),
    employees: z
      .array(employeeSchema)
      .min(1, { error: "Tidak ada Karyawan untuk di-seed." })
      .max(SEED_LIMITS.employees, { error: `Maksimal ${SEED_LIMITS.employees} Karyawan.` }),
  })
  .superRefine((payload, ctx) => {
    const orgCount = payload.org_units.length;
    const jabCount = payload.jabatan.length;
    const lookupCount = payload.lookups.length;

    payload.org_units.forEach((unit, i) => {
      if (unit.parent !== null && unit.parent >= i) {
        ctx.addIssue({
          code: "custom",
          path: ["org_units", i, "parent"],
          message: `Unit Organisasi «${unit.nama}» menunjuk induk yang belum didefinisikan sebelumnya.`,
        });
      }
    });

    const seenOrgKode = new Set<string>();
    payload.org_units.forEach((unit, i) => {
      if (seenOrgKode.has(unit.kode)) {
        ctx.addIssue({
          code: "custom",
          path: ["org_units", i, "kode"],
          message: `Kode Unit Organisasi «${unit.kode}» muncul dua kali.`,
        });
      }
      seenOrgKode.add(unit.kode);
    });

    const seenJabKode = new Set<string>();
    payload.jabatan.forEach((row, i) => {
      if (seenJabKode.has(row.kode)) {
        ctx.addIssue({
          code: "custom",
          path: ["jabatan", i, "kode"],
          message: `Kode Jabatan «${row.kode}» muncul dua kali.`,
        });
      }
      seenJabKode.add(row.kode);
    });

    const seenLookup = new Set<string>();
    payload.lookups.forEach((row, i) => {
      const key = `${row.tipe}/${row.kode}`;
      if (seenLookup.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["lookups", i, "kode"],
          message: `Kode Lookup «${row.kode}» untuk tipe ${row.tipe} muncul dua kali.`,
        });
      }
      seenLookup.add(key);
    });

    const seenPersonnel = new Set<string>();
    const seenNip = new Set<string>();
    payload.employees.forEach((employee, i) => {
      if (seenPersonnel.has(employee.personnel_number)) {
        ctx.addIssue({
          code: "custom",
          path: ["employees", i, "personnel_number"],
          message: `Personnel Number ${employee.personnel_number} muncul dua kali.`,
        });
      }
      seenPersonnel.add(employee.personnel_number);

      if (employee.nip !== null) {
        if (seenNip.has(employee.nip)) {
          ctx.addIssue({
            code: "custom",
            path: ["employees", i, "nip"],
            message: `NIP ${employee.nip} muncul dua kali.`,
          });
        }
        seenNip.add(employee.nip);
      }

      if (employee.org !== null && employee.org >= orgCount) {
        ctx.addIssue({
          code: "custom",
          path: ["employees", i, "org"],
          message: `Karyawan ${employee.personnel_number} menunjuk Unit Organisasi yang tidak ada di daftar.`,
        });
      }
      if (employee.jab !== null && employee.jab >= jabCount) {
        ctx.addIssue({
          code: "custom",
          path: ["employees", i, "jab"],
          message: `Karyawan ${employee.personnel_number} menunjuk Jabatan yang tidak ada di daftar.`,
        });
      }
      for (const tipe of LOOKUP_TYPES) {
        const index = employee.lk[tipe];
        if (index === undefined) continue;
        const target = index < lookupCount ? payload.lookups[index] : undefined;
        if (!target || target.tipe !== tipe) {
          ctx.addIssue({
            code: "custom",
            path: ["employees", i, "lk", tipe],
            message: `Karyawan ${employee.personnel_number} menunjuk Lookup ${tipe} yang tidak ada di daftar atau bertipe lain.`,
          });
        }
      }
    });
  });

export type SeedPayloadParsed = z.infer<typeof seedPayloadSchema>;
