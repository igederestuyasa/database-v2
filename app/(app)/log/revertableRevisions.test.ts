import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_ID,
  REVISIONS,
  REVISI_EDIT_KARYAWAN,
  REVISI_INSERT_PROFIL,
  REVISI_INSERT_UNIT,
  REVISI_KOLOM_ASING,
  REVISI_TABEL_ASING,
} from "@/fixtures";
import type { Revision } from "@/lib/types/db";

import { kalimatTidakBisa, ringkasRevertability } from "./revertableRevisions";

/**
 * The Log Perubahan offers "Kembalikan" per Revisi (PRD #15), and the thing
 * that can go wrong is not the revert — that is `planRevert()` plus
 * `apply_revert`, both already covered — but the NOISE around it: a Seed Batch
 * draws up to 100 Revisi, most of them `employee_private` inserts that cannot
 * be reverted one at a time, and each card would otherwise repeat the same
 * paragraph.
 *
 * Fixtures only — never a real Karyawan (CLAUDE.md).
 */

/** A Seed-shaped Batch: one `employee_private` insert per Karyawan. */
function seedPrivateInserts(jumlah: number): Revision[] {
  return Array.from({ length: jumlah }, (_, index) => ({
    id: 1000 + index,
    batch_id: "55555555-5555-4555-8555-000000000003",
    table_name: "employee_private",
    row_id: EMPLOYEE_ID.lengkap,
    action: "insert",
    before: null,
    after: { employee_id: EMPLOYEE_ID.lengkap, religion: "Islam" },
    actor_id: null,
    created_at: "2026-02-03T04:05:06.000Z",
  }));
}

describe("ringkasRevertability", () => {
  it("offers Kembalikan for every Revisi the planner would act on", () => {
    const { bisa } = ringkasRevertability(REVISIONS);

    // update on a logged table, and an insert on a table WITH `status`.
    expect(bisa.has(REVISI_EDIT_KARYAWAN.id)).toBe(true);
    expect(bisa.has(REVISI_INSERT_UNIT.id)).toBe(true);
  });

  it("withholds it from the three the planner skips", () => {
    const { bisa, jumlahTidakBisa } = ringkasRevertability(REVISIONS);

    // insert on `profiles`: no `status` column, and a revert never deletes.
    expect(bisa.has(REVISI_INSERT_PROFIL.id)).toBe(false);
    // `before` holds only columns this schema no longer knows (ADR-003).
    expect(bisa.has(REVISI_KOLOM_ASING.id)).toBe(false);
    // not one of the seven logged tables.
    expect(bisa.has(REVISI_TABEL_ASING.id)).toBe(false);

    expect(jumlahTidakBisa).toBe(3);
  });

  it("accounts for every Revisi exactly once", () => {
    const { bisa, jumlahTidakBisa } = ringkasRevertability(REVISIONS);
    expect(bisa.size + jumlahTidakBisa).toBe(REVISIONS.length);
  });

  it("groups the reasons, most common first", () => {
    const { alasan } = ringkasRevertability([
      ...seedPrivateInserts(100),
      REVISI_TABEL_ASING,
    ]);

    expect(alasan).toHaveLength(2);
    expect(alasan[0].jumlah).toBe(100);
    expect(alasan[1].jumlah).toBe(1);
  });

  it("reports nothing to explain when every Revisi can be reverted", () => {
    const ringkasan = ringkasRevertability([
      REVISI_EDIT_KARYAWAN,
      REVISI_INSERT_UNIT,
    ]);

    expect(ringkasan.jumlahTidakBisa).toBe(0);
    expect(ringkasan.alasan).toEqual([]);
  });

  it("is empty, not undefined, for a Batch with no readable Revisi", () => {
    const ringkasan = ringkasRevertability([]);
    expect(ringkasan.bisa.size).toBe(0);
    expect(ringkasan.alasan).toEqual([]);
  });
});

describe("kalimatTidakBisa", () => {
  it("says nothing when there is nothing to say", () => {
    expect(kalimatTidakBisa(ringkasRevertability([REVISI_EDIT_KARYAWAN]))).toBeNull();
  });

  it("replaces 100 repeated notes with one line", () => {
    const kalimat = kalimatTidakBisa(
      ringkasRevertability(seedPrivateInserts(100)),
    );

    expect(kalimat).not.toBeNull();
    expect(kalimat).toContain("100 Revisi di bawah tidak bisa dikembalikan");
    // The planner's own wording, not a second copy of it in this module.
    expect(kalimat).toContain("tidak punya kolom status");
    // One reason, so no redundant "(100 Revisi)" tacked onto it.
    expect(kalimat).not.toContain("(100 Revisi)");
  });

  it("counts each reason when there is more than one", () => {
    const kalimat = kalimatTidakBisa(
      ringkasRevertability([
        ...seedPrivateInserts(2),
        REVISI_TABEL_ASING,
        REVISI_KOLOM_ASING,
      ]),
    );

    expect(kalimat).toContain("4 Revisi di bawah tidak bisa dikembalikan");
    expect(kalimat).toContain("(2 Revisi)");
    expect(kalimat).toContain("(1 Revisi)");
  });
});
