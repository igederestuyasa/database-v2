import { describe, expect, it } from "vitest";

import {
  REVISI_EDIT_KARYAWAN,
  REVISI_EDIT_KARYAWAN_LANJUTAN,
  REVISI_INSERT_PROFIL,
  REVISI_INSERT_UNIT,
  REVISI_KOLOM_ASING,
  REVISI_TABEL_ASING,
  REVISI_UPDATE_PRIVATE,
  REVISI_UPDATE_PROFIL,
} from "@/fixtures/revisions";
import { EMPLOYEE_ID, JABATAN_ID, ORG_UNIT_ID, PROFILE_ID } from "@/fixtures/ids";

import { applyRevert, planRevert } from "./revert";

describe("planRevert — revert satu update", () => {
  const plan = planRevert([REVISI_EDIT_KARYAWAN]);

  it("menulis kembali kolom dari `before`", () => {
    expect(plan.operations).toHaveLength(1);
    const [op] = plan.operations;
    expect(op.kind).toBe("restore");
    expect(op.table).toBe("employees");
    expect(op.rowId).toBe(EMPLOYEE_ID.lengkap);
    expect(op.values.org_unit_id).toBe(ORG_UNIT_ID.bagian);
    expect(op.values.full_name).toBe("Budi Contoh");
  });

  it("memakai kolom kunci `id`", () => {
    expect(plan.operations[0].pkColumn).toBe("id");
  });

  it("tidak pernah menulis ulang kunci, created_at, atau updated_at", () => {
    const { values } = plan.operations[0];
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("created_at");
    expect(values).not.toHaveProperty("updated_at");
  });

  it("selalu menghasilkan Batch berjenis revert dengan keterangan terbaca", () => {
    expect(plan.jenis).toBe("revert");
    expect(plan.keterangan).toContain("Kembalikan Revisi #101");
    expect(plan.keterangan).toContain("Karyawan");
  });

  it("menerima keterangan dari pemanggil", () => {
    const custom = planRevert([REVISI_EDIT_KARYAWAN], { keterangan: "Batal merge" });
    expect(custom.keterangan).toBe("Batal merge");
  });
});

describe("planRevert — revert satu insert", () => {
  const plan = planRevert([REVISI_INSERT_UNIT]);

  it("menonaktifkan baris, bukan menghapusnya (ADR-003)", () => {
    expect(plan.operations).toHaveLength(1);
    const [op] = plan.operations;
    expect(op.kind).toBe("deactivate");
    expect(op.values).toEqual({ status: "nonaktif" });
    expect(op.rowId).toBe(ORG_UNIT_ID.proyek);
  });

  it("tidak pernah memakai kata hapus di rencananya", () => {
    expect(JSON.stringify(plan)).not.toMatch(/delete/i);
  });
});

describe("planRevert — revert satu Batch", () => {
  const revisions = [
    REVISI_EDIT_KARYAWAN,
    REVISI_EDIT_KARYAWAN_LANJUTAN,
    REVISI_INSERT_UNIT,
    REVISI_UPDATE_PRIVATE,
  ];

  it("mengurutkan operasi menurun berdasarkan id Revisi", () => {
    const plan = planRevert(revisions);
    expect(plan.operations.map((op) => op.revisionId)).toEqual([104, 103, 102, 101]);
  });

  it("urutannya tidak bergantung pada urutan input", () => {
    const shuffled = planRevert([...revisions].reverse());
    expect(shuffled.operations.map((op) => op.revisionId)).toEqual([104, 103, 102, 101]);
  });

  it("baris yang dua kali berubah berakhir di keadaan paling awal", () => {
    const plan = planRevert([REVISI_EDIT_KARYAWAN, REVISI_EDIT_KARYAWAN_LANJUTAN]);
    // Diterapkan berurutan: #102 dulu, lalu #101 — yang terakhir menang.
    expect(plan.operations.map((op) => op.revisionId)).toEqual([102, 101]);
    const terakhir = plan.operations[plan.operations.length - 1];
    expect(terakhir.revisionId).toBe(101);
    expect(terakhir.values.full_name).toBe("Budi Contoh");
    expect(terakhir.values.jabatan_id).toBe(JABATAN_ID.staf);
    expect(terakhir.values.org_unit_id).toBe(ORG_UNIT_ID.bagian);
  });

  it("memakai employee_id sebagai kunci untuk employee_private", () => {
    const plan = planRevert([REVISI_UPDATE_PRIVATE]);
    expect(plan.operations[0].pkColumn).toBe("employee_id");
    expect(plan.operations[0].values).not.toHaveProperty("employee_id");
    expect(plan.operations[0].values.marital_status).toBe("Belum Menikah");
  });

  it("menyebut jumlah dan tabel di keterangan Batch", () => {
    const plan = planRevert(revisions);
    expect(plan.keterangan).toContain("4 Revisi");
    expect(plan.keterangan).toContain("Karyawan");
  });
});

describe("planRevert — profiles adalah tabel ter-log ketujuh (ADR-005 §12)", () => {
  it("bisa mengembalikan perubahan role", () => {
    const plan = planRevert([REVISI_UPDATE_PROFIL]);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].table).toBe("profiles");
    expect(plan.operations[0].values.role).toBe("viewer");
    expect(plan.operations[0].rowId).toBe(PROFILE_ID.viewer);
  });

  it("menolak mengembalikan pembuatan profil — tidak ada kolom status", () => {
    const plan = planRevert([REVISI_INSERT_PROFIL]);
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe("tanpa_kolom_status");
    expect(plan.skipped[0].keterangan).toMatch(/tidak bisa dinonaktifkan/i);
  });
});

describe("planRevert — Revisi yang tidak bisa dikembalikan", () => {
  it("melewati tabel di luar tujuh tabel ter-log", () => {
    const plan = planRevert([REVISI_TABEL_ASING]);
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("tabel_tidak_dikenal");
  });

  it("mengabaikan kolom yang sudah tidak ada di skema (ADR-003)", () => {
    const plan = planRevert([REVISI_KOLOM_ASING]);
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("tidak_ada_kolom_dipulihkan");
  });

  it("melewati update tanpa `before`", () => {
    const plan = planRevert([{ ...REVISI_EDIT_KARYAWAN, before: null }]);
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("before_kosong");
  });

  it("melewati aksi yang tidak dikenal", () => {
    const plan = planRevert([{ ...REVISI_EDIT_KARYAWAN, action: "delete" }]);
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("aksi_tidak_dikenal");
  });

  it("tetap merencanakan Revisi lain di Batch yang sama", () => {
    const plan = planRevert([REVISI_INSERT_PROFIL, REVISI_EDIT_KARYAWAN]);
    expect(plan.operations).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("daftar kosong menghasilkan rencana kosong, bukan error", () => {
    const plan = planRevert([]);
    expect(plan.operations).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.jenis).toBe("revert");
  });
});

describe("planRevert — kemurnian", () => {
  it("tidak mengubah Revisi yang diberikan", () => {
    const input = [REVISI_EDIT_KARYAWAN_LANJUTAN, REVISI_EDIT_KARYAWAN];
    const salinan = JSON.parse(JSON.stringify(input));
    planRevert(input);
    expect(input).toEqual(salinan);
  });

  it("dua panggilan dengan input sama menghasilkan rencana sama", () => {
    expect(planRevert([REVISI_EDIT_KARYAWAN])).toEqual(planRevert([REVISI_EDIT_KARYAWAN]));
  });
});

describe("applyRevert", () => {
  it("masih berupa stub yang menolak dijalankan", async () => {
    const plan = planRevert([REVISI_EDIT_KARYAWAN]);
    await expect(
      // Stub: tidak pernah menyentuh client-nya.
      applyRevert(plan, null as never),
    ).rejects.toThrow(/not implemented/i);
  });
});
