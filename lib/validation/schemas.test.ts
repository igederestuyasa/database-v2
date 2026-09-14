/**
 * Behaviour of the shared entity schemas.
 *
 * These exist so that thirteen units do not each decide for themselves whether
 * `nip` is required, whether an untouched date is `""` or `null`, and whether
 * a partial update clears the fields it omits. Those three disagreements would
 * not show up until data was already wrong, so they are pinned here.
 */
import { describe, expect, it } from "vitest";

import { API_EMPLOYEE_FIELDS } from "@/lib/schema/columns.generated";

import { apiKeyCreateSchema, apiKeyUpdateSchema } from "./apiKey";
import {
  employeeCreateSchema,
  employeeDeactivateSchema,
  employeePrivateSchema,
  employeeUpdateSchema,
} from "./employee";
import {
  jabatanCreateSchema,
  jabatanRenameSchema,
  jabatanUpdateSchema,
} from "./jabatan";
import { lookupCreateSchema, lookupUpdateSchema } from "./lookup";
import { orgUnitCreateSchema, orgUnitUpdateSchema } from "./orgUnit";

const UUID = "11111111-1111-4111-8111-000000000001";
const UUID_LAIN = "22222222-2222-4222-8222-000000000002";

describe("employeeCreateSchema", () => {
  const minimal = { personnel_number: "TEST-0001", full_name: "Budi Contoh" };

  it("hanya mewajibkan personnel_number dan full_name", () => {
    const parsed = employeeCreateSchema.parse(minimal);
    expect(parsed.personnel_number).toBe("TEST-0001");
    expect(parsed.full_name).toBe("Budi Contoh");
  });

  it("nip OPSIONAL — kolomnya UNIQUE tapi nullable", () => {
    expect(employeeCreateSchema.parse(minimal).nip).toBeNull();
    expect(employeeCreateSchema.parse({ ...minimal, nip: "TESTNIP1" }).nip).toBe(
      "TESTNIP1",
    );
  });

  it("menolak personnel_number kosong atau hanya spasi", () => {
    expect(employeeCreateSchema.safeParse({ ...minimal, personnel_number: "" }).success)
      .toBe(false);
    expect(
      employeeCreateSchema.safeParse({ ...minimal, personnel_number: "   " }).success,
    ).toBe(false);
  });

  it("memangkas spasi di ujung teks", () => {
    expect(employeeCreateSchema.parse({ ...minimal, full_name: "  Budi Contoh  " })
      .full_name).toBe("Budi Contoh");
  });

  it('mengubah "" dari form menjadi null, bukan string kosong', () => {
    const parsed = employeeCreateSchema.parse({
      ...minimal,
      nip: "",
      org_unit_id: "",
      jabatan_id: "",
      original_start_date: "",
      keterangan: "",
    });
    expect(parsed.nip).toBeNull();
    expect(parsed.org_unit_id).toBeNull();
    expect(parsed.jabatan_id).toBeNull();
    expect(parsed.original_start_date).toBeNull();
    expect(parsed.keterangan).toBeNull();
  });

  it("menolak id yang bukan uuid — kolom referensi selalu FK (ADR-002)", () => {
    const result = employeeCreateSchema.safeParse({ ...minimal, org_unit_id: "Divisi HC" });
    expect(result.success).toBe(false);
  });

  it("menolak tanggal di luar format YYYY-MM-DD dan tanggal mustahil", () => {
    expect(
      employeeCreateSchema.safeParse({ ...minimal, original_start_date: "14/05/2023" })
        .success,
    ).toBe(false);
    expect(
      employeeCreateSchema.safeParse({ ...minimal, original_start_date: "2025-02-30" })
        .success,
    ).toBe(false);
    expect(
      employeeCreateSchema.parse({ ...minimal, original_start_date: "2023-05-14" })
        .original_start_date,
    ).toBe("2023-05-14");
  });

  it("status default aktif dan hanya menerima dua nilai", () => {
    expect(employeeCreateSchema.parse(minimal).status).toBe("aktif");
    expect(employeeCreateSchema.parse({ ...minimal, status: "nonaktif" }).status).toBe(
      "nonaktif",
    );
    expect(employeeCreateSchema.safeParse({ ...minimal, status: "resign" }).success).toBe(
      false,
    );
  });

  it("menjaga keterangan_rangkap_1 dan _2 tetap terpisah", () => {
    const parsed = employeeCreateSchema.parse({
      ...minimal,
      keterangan_rangkap_1: "Rangkap A",
      keterangan_rangkap_2: "Rangkap B",
    });
    expect(parsed.keterangan_rangkap_1).toBe("Rangkap A");
    expect(parsed.keterangan_rangkap_2).toBe("Rangkap B");
  });
});

describe("employeeUpdateSchema", () => {
  it("mewajibkan id, seperti semua skema update lain di folder ini", () => {
    expect(employeeUpdateSchema.safeParse({ full_name: "Budi Contoh" }).success).toBe(false);
    expect(employeeUpdateSchema.parse({ id: UUID, full_name: "Budi Contoh" }).id).toBe(UUID);
  });

  it("kolom yang tidak dikirim tetap tidak ada — bukan di-null-kan", () => {
    const parsed = employeeUpdateSchema.parse({ id: UUID, full_name: "Budi Contoh" });
    expect(parsed).toEqual({ id: UUID, full_name: "Budi Contoh" });
    expect("nip" in parsed).toBe(false);
    expect("org_unit_id" in parsed).toBe(false);
    expect("status" in parsed).toBe(false);
  });

  it("null yang dikirim eksplisit tetap null — itu cara mengosongkan kolom", () => {
    expect(employeeUpdateSchema.parse({ id: UUID, org_unit_id: null }).org_unit_id)
      .toBeNull();
  });

  it("tetap memvalidasi kolom yang memang dikirim", () => {
    expect(employeeUpdateSchema.safeParse({ id: UUID, full_name: "" }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ id: UUID, jabatan_id: "bukan-uuid" }).success)
      .toBe(false);
  });
});

describe("employeeDeactivateSchema", () => {
  it("mewajibkan tanggal keluar (PRD #5)", () => {
    expect(employeeDeactivateSchema.safeParse({ id: UUID }).success).toBe(false);
    const parsed = employeeDeactivateSchema.parse({ id: UUID, tanggal_keluar: "2026-03-31" });
    expect(parsed.tanggal_keluar).toBe("2026-03-31");
  });
});

describe("employeePrivateSchema", () => {
  it("semua kolom boleh kosong (PRD #22)", () => {
    expect(employeePrivateSchema.parse({})).toEqual({
      date_of_birth: null,
      place_of_birth: null,
      religion: null,
      marital_status: null,
    });
  });
});

describe("orgUnit", () => {
  const minimal = { kode: "DIV-CONTOH", nama: "Divisi Contoh", tipe: "divisi" as const };

  it("menerima keenam tipe dan menolak yang lain", () => {
    expect(orgUnitCreateSchema.parse(minimal).tipe).toBe("divisi");
    expect(orgUnitCreateSchema.safeParse({ ...minimal, tipe: "business_unit" }).success)
      .toBe(false);
  });

  it("parent_id boleh kosong — unit tanpa induk masuk sebagai Temuan, bukan error", () => {
    expect(orgUnitCreateSchema.parse(minimal).parent_id).toBeNull();
  });

  it("menolak unit yang menjadi induk dirinya sendiri", () => {
    const result = orgUnitUpdateSchema.safeParse({ id: UUID, parent_id: UUID });
    expect(result.success).toBe(false);
    expect(orgUnitUpdateSchema.safeParse({ id: UUID, parent_id: UUID_LAIN }).success)
      .toBe(true);
  });
});

describe("jabatan", () => {
  it("hanya kode, nama dan status — tidak ada unit atau kuota (ADR-002)", () => {
    const parsed = jabatanCreateSchema.parse({ kode: "JBT-001", nama: "Manager Contoh" });
    expect(Object.keys(parsed).sort()).toEqual(["kode", "nama", "status"]);
  });

  it("rename mewajibkan id dan nama baru", () => {
    expect(jabatanRenameSchema.safeParse({ id: UUID, nama: "" }).success).toBe(false);
    expect(jabatanRenameSchema.parse({ id: UUID, nama: " Manager Baru " }).nama).toBe(
      "Manager Baru",
    );
  });
});

describe("lookup", () => {
  const minimal = { tipe: "job_grade" as const, kode: "JG-A", label: "Pratama I - 11" };

  it("menerima 11 tipe yang sah saja", () => {
    expect(lookupCreateSchema.parse(minimal).tipe).toBe("job_grade");
    expect(lookupCreateSchema.safeParse({ ...minimal, tipe: "jabatan" }).success).toBe(
      false,
    );
  });

  it("urutan boleh kosong dan menerima angka dalam bentuk string dari form", () => {
    expect(lookupCreateSchema.parse(minimal).urutan).toBeNull();
    expect(lookupCreateSchema.parse({ ...minimal, urutan: "3" }).urutan).toBe(3);
    expect(lookupCreateSchema.safeParse({ ...minimal, urutan: "tiga" }).success).toBe(false);
  });

  it("tipe tidak bisa diubah setelah dibuat", () => {
    const parsed = lookupUpdateSchema.parse({ id: UUID, tipe: "gender", label: "Baru" });
    expect("tipe" in parsed).toBe(false);
  });
});

describe("apiKey", () => {
  const kolom = [API_EMPLOYEE_FIELDS[0], API_EMPLOYEE_FIELDS[1]];

  it("hanya menerima kolom yang ada di v_employees_api", () => {
    const parsed = apiKeyCreateSchema.parse({
      nama_konsumen: "Perf App",
      allowed_fields: kolom,
    });
    expect(parsed.allowed_fields).toEqual(kolom);
  });

  it("menolak kolom Data Pribadi Sensitif, yang memang tidak ada di view itu", () => {
    for (const sensitif of ["date_of_birth", "religion", "usia"]) {
      expect(
        apiKeyCreateSchema.safeParse({
          nama_konsumen: "Perf App",
          allowed_fields: [sensitif],
        }).success,
      ).toBe(false);
    }
  });

  it("menolak whitelist kosong — key tanpa kolom tidak ada gunanya", () => {
    expect(
      apiKeyCreateSchema.safeParse({ nama_konsumen: "Perf App", allowed_fields: [] })
        .success,
    ).toBe(false);
  });

  it("membuang kolom kembar", () => {
    const parsed = apiKeyCreateSchema.parse({
      nama_konsumen: "Perf App",
      allowed_fields: [kolom[0], kolom[0], kolom[1]],
    });
    expect(parsed.allowed_fields).toEqual([kolom[0], kolom[1]]);
  });

  it("membutuhkan allowed_fields saat membuat key baru", () => {
    expect(apiKeyCreateSchema.safeParse({ nama_konsumen: "Perf App" }).success).toBe(false);
  });

  it("tidak pernah menerima key_hash atau key_prefix dari form", () => {
    const parsed = apiKeyUpdateSchema.parse({
      id: UUID,
      nama_konsumen: "Perf App",
      // Kolom ini tidak ada di skema; zod membuangnya, bukan meneruskannya.
      key_hash: "palsu",
    });
    expect("key_hash" in parsed).toBe(false);
  });
});

/**
 * The trap that `.partial()` sets, pinned for all four entities at once.
 *
 * `.partial()` makes a key optional but leaves any `.default()` underneath it
 * in place, so an update schema built naively hands back `status: "aktif"` for
 * a payload that never mentioned status — silently reactivating a Karyawan who
 * left, or a Unit Organisasi that was merged away. Every update schema here
 * re-declares `status` without its default; these tests fail if one stops.
 */
describe("skema update tidak pernah mengembalikan status secara diam-diam", () => {
  it("employeeUpdateSchema", () => {
    expect(
      employeeUpdateSchema.parse({ id: UUID, full_name: "Budi Contoh" }),
    ).not.toHaveProperty("status");
  });

  it("orgUnitUpdateSchema", () => {
    expect(orgUnitUpdateSchema.parse({ id: UUID, nama: "Divisi Baru" })).not.toHaveProperty(
      "status",
    );
  });

  it("jabatanUpdateSchema", () => {
    expect(jabatanUpdateSchema.parse({ id: UUID, nama: "Manager Baru" })).not.toHaveProperty(
      "status",
    );
  });

  it("lookupUpdateSchema", () => {
    expect(lookupUpdateSchema.parse({ id: UUID, label: "Label Baru" })).not.toHaveProperty(
      "status",
    );
  });

  it("apiKeyUpdateSchema juga tidak mengosongkan whitelist kolom", () => {
    const parsed = apiKeyUpdateSchema.parse({ id: UUID, nama_konsumen: "Perf App" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("allowed_fields");
  });

  it("status tetap tersimpan kalau memang dikirim", () => {
    expect(employeeUpdateSchema.parse({ id: UUID, status: "nonaktif" }).status).toBe(
      "nonaktif",
    );
    expect(orgUnitUpdateSchema.parse({ id: UUID, status: "nonaktif" }).status).toBe(
      "nonaktif",
    );
  });
});
