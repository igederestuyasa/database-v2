import { describe, expect, it } from "vitest";

import { planSeed, type SeedPlan } from "./excelMapping";
import {
  SEED_LIMITS,
  buildSeedPayload,
  seedPayloadSchema,
  type SeedPayload,
} from "./payload";

/** Three title rows, headers on row 4, then data — the documented layout. */
function sheet(headers: readonly unknown[], ...rows: readonly unknown[][]): unknown[][] {
  return [["Judul"], [], [], [...headers], ...rows.map((row) => [...row])];
}

const HEADERS = [
  "Personnel Number",
  "NIP",
  "Nama",
  "Status",
  "Business Unit",
  "Divisi",
  "Bagian",
  "Sub Bagian",
  "Jabatan",
  "Gender",
  "Job Grade",
  "Tanggal Lahir",
  "Agama",
  "No Surat",
  "No Surat",
  "Tanggal Masuk",
] as const;

const ROWS: unknown[][] = [
  ["90000001", "D1", "Rahmat", "aktif", "Direktorat A", "Divisi B", "Bagian C", null, "Staf", "Laki-laki", "JG 1", "1990-01-01", "Islam", "SK-1", "SK-2", "2015-03-04"],
  ["90000002", null, "Sari", "nonaktif", "Direktorat A", "Divisi B", null, null, "Manajer", "Perempuan", null, null, null, null, null, null],
  ["90000003", null, "Tanpa Apa-apa", "aktif", null, null, null, null, null, null, null, null, null, null, null, null],
];

function plan(): SeedPlan {
  return planSeed(sheet(HEADERS, ...ROWS));
}

function payload(): SeedPayload {
  return buildSeedPayload(plan());
}

/** A deep, mutable copy so a test can break one field on purpose. */
function rusak(mutate: (p: {
  org_units: { kode: string; nama: string; tipe: string; parent: number | null }[];
  jabatan: { kode: string; nama: string }[];
  lookups: { tipe: string; kode: string; label: string; urutan: number }[];
  employees: Record<string, unknown>[];
}) => void): unknown {
  const copy = JSON.parse(JSON.stringify(payload()));
  mutate(copy);
  return copy;
}

describe("buildSeedPayload", () => {
  it("mengganti kunci path dengan index, induk selalu lebih dulu", () => {
    const p = payload();
    expect(p.org_units.map((u) => [u.nama, u.tipe, u.parent])).toEqual([
      ["Direktorat A", "direktorat", null],
      ["Divisi B", "divisi", 0],
      ["Bagian C", "bagian", 1],
    ]);
    expect(p.employees.map((e) => e.org)).toEqual([2, 1, null]);
    expect(p.employees.map((e) => e.jab)).toEqual([0, 1, null]);
  });

  it("menunjuk Lookup lewat index yang tipenya cocok", () => {
    const p = payload();
    const gender = p.employees[0].lk.gender;
    const jobGrade = p.employees[0].lk.job_grade;
    expect(gender).toBeDefined();
    expect(jobGrade).toBeDefined();
    expect(p.lookups[gender as number]).toMatchObject({ tipe: "gender", label: "Laki-laki" });
    expect(p.lookups[jobGrade as number]).toMatchObject({ tipe: "job_grade", label: "JG 1" });
    expect(p.employees[2].lk).toEqual({});
  });

  it("membawa teks, tanggal, dan Data Pribadi Sensitif; kosong jadi null", () => {
    const p = payload();
    expect(p.employees[0].text).toEqual({ nomor_surat_pg: "SK-1", nomor_surat_jg: "SK-2" });
    expect(p.employees[0].dates).toEqual({ original_start_date: "2015-03-04" });
    expect(p.employees[0].private).toEqual({
      date_of_birth: "1990-01-01",
      place_of_birth: null,
      religion: "Islam",
      marital_status: null,
    });
    expect(p.employees[1].private).toBeNull();
    expect(p.employees[1].status).toBe("nonaktif");
    expect(p.employees[1].nip).toBeNull();
  });

  it("tidak memuat karakter NUL — jsonb menolaknya", () => {
    expect(JSON.stringify(payload())).not.toContain("\\u0000");
  });

  it("melempar kalau rencana menunjuk kunci yang tidak ada (bug planSeed, bukan Excel)", () => {
    const p = plan();
    const patah: SeedPlan = {
      ...p,
      employees: [{ ...p.employees[0], orgUnitKey: "bukan-kunci" }, ...p.employees.slice(1)],
    };
    expect(() => buildSeedPayload(patah)).toThrow(/Rencana Seed rusak/);
  });
});

describe("seedPayloadSchema", () => {
  it("menerima payload dari planSeed apa adanya", () => {
    const result = seedPayloadSchema.safeParse(payload());
    expect(result.success).toBe(true);
  });

  it("menolak induk yang menunjuk ke depan atau ke diri sendiri", () => {
    const result = seedPayloadSchema.safeParse(rusak((p) => { p.org_units[1].parent = 2; }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/belum didefinisikan sebelumnya/);
  });

  it("menolak Karyawan yang menunjuk index di luar daftar", () => {
    const org = seedPayloadSchema.safeParse(rusak((p) => { p.employees[0].org = 99; }));
    expect(org.success).toBe(false);
    const jab = seedPayloadSchema.safeParse(rusak((p) => { p.employees[0].jab = 99; }));
    expect(jab.success).toBe(false);
  });

  it("menolak Lookup yang bertipe lain dari kolomnya", () => {
    const result = seedPayloadSchema.safeParse(
      rusak((p) => {
        const jobGradeIndex = p.lookups.findIndex((l) => l.tipe === "job_grade");
        (p.employees[0].lk as Record<string, number>).gender = jobGradeIndex;
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/bertipe lain/);
  });

  it("menolak Personnel Number dan NIP ganda", () => {
    const pn = seedPayloadSchema.safeParse(
      rusak((p) => { p.employees[1].personnel_number = "90000001"; }),
    );
    expect(pn.success).toBe(false);
    expect(JSON.stringify(pn.error?.issues)).toMatch(/Personnel Number 90000001 muncul dua kali/);

    const nip = seedPayloadSchema.safeParse(rusak((p) => { p.employees[1].nip = "D1"; }));
    expect(nip.success).toBe(false);
  });

  it("menolak kode ganda di Data Referensi", () => {
    const result = seedPayloadSchema.safeParse(
      rusak((p) => { p.lookups[1].tipe = p.lookups[0].tipe; p.lookups[1].kode = p.lookups[0].kode; }),
    );
    expect(result.success).toBe(false);
  });

  it("menolak tipe yang tidak dikenal, status asing, dan tanggal salah bentuk", () => {
    expect(seedPayloadSchema.safeParse(rusak((p) => { p.lookups[0].tipe = "warna_favorit"; })).success).toBe(false);
    expect(seedPayloadSchema.safeParse(rusak((p) => { p.org_units[0].tipe = "kantor"; })).success).toBe(false);
    expect(seedPayloadSchema.safeParse(rusak((p) => { p.employees[0].status = "cuti"; })).success).toBe(false);
    expect(seedPayloadSchema.safeParse(rusak((p) => { p.employees[0].dates = { original_start_date: "04/03/2015" }; })).success).toBe(false);
  });

  it("menolak payload tanpa Karyawan dan yang melampaui batas", () => {
    expect(seedPayloadSchema.safeParse(rusak((p) => { p.employees = []; })).success).toBe(false);
    const besar = rusak((p) => {
      const satu = p.employees[0];
      p.employees = Array.from({ length: SEED_LIMITS.employees + 1 }, (_, i) => ({
        ...satu,
        personnel_number: `X${i}`,
        nip: null,
      }));
    });
    expect(seedPayloadSchema.safeParse(besar).success).toBe(false);
  });
});
