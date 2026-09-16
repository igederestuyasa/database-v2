/**
 * lib/seed/ringkasan.ts — the numbers the Seed page shows before anything is
 * written (PRD #23).
 *
 * Same figures as the CLI's `--dry-run` report (`formatReport()` in
 * `scripts/seed-from-excel.ts`), computed from the same `SeedPlan`, but as
 * data rather than text so the page can lay them out — and without the CLI's
 * "…dan N lain" cut-off: on a page every Peringatan is worth a line, and the
 * admin can scroll.
 *
 * Pure. Tested against the CLI's own output for the dummy workbook so the two
 * never disagree about how many Karyawan a file contains.
 */
import { errorsOf, warningsOf, type SeedIssue, type SeedPlan } from "./excelMapping";

export type JumlahPerTipe = { tipe: string; jumlah: number };

export type RingkasanSeed = {
  baris: { dibaca: number; kosong: number };
  kolom: {
    dipetakan: number;
    diabaikan: readonly string[];
    tidakDikenal: readonly string[];
  };
  akanDibuat: {
    unitOrganisasi: { total: number; perTipe: readonly JumlahPerTipe[] };
    jabatan: number;
    lookup: { total: number; perTipe: readonly JumlahPerTipe[] };
    karyawan: { total: number; nonaktif: number };
    dataPribadi: number;
  };
  peringatan: readonly SeedIssue[];
  error: readonly SeedIssue[];
  /** No `error` issues — the only condition under which the RPC is offered. */
  bisaDijalankan: boolean;
};

/** Counts per `tipe`, in first-seen order (the CLI prints them the same way). */
export function hitungPerTipe<T>(
  items: readonly T[],
  tipeOf: (item: T) => string,
): JumlahPerTipe[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const tipe = tipeOf(item);
    counts.set(tipe, (counts.get(tipe) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tipe, jumlah]) => ({ tipe, jumlah }));
}

export function ringkasSeedPlan(plan: SeedPlan): RingkasanSeed {
  const error = errorsOf(plan);
  return {
    baris: { dibaca: plan.stats.barisDibaca, kosong: plan.stats.barisKosong },
    kolom: {
      dipetakan: plan.headerPlan.columns.length,
      diabaikan: plan.headerPlan.ignored,
      tidakDikenal: plan.headerPlan.unknown,
    },
    akanDibuat: {
      unitOrganisasi: {
        total: plan.orgUnits.length,
        perTipe: hitungPerTipe(plan.orgUnits, (unit) => unit.tipe),
      },
      jabatan: plan.jabatan.length,
      lookup: {
        total: plan.lookups.length,
        perTipe: hitungPerTipe(plan.lookups, (row) => row.tipe),
      },
      karyawan: {
        total: plan.employees.length,
        nonaktif: plan.employees.filter((e) => e.status === "nonaktif").length,
      },
      dataPribadi: plan.stats.karyawanDenganDataPribadi,
    },
    peringatan: warningsOf(plan),
    error,
    bisaDijalankan: error.length === 0,
  };
}

/** `[kode] baris 731: pesan` — the CLI's line, for the same issue. */
export function baristIssue(issue: SeedIssue): string {
  const where = issue.baris !== undefined ? `baris ${issue.baris}` : "berkas";
  return `[${issue.kode}] ${where}: ${issue.pesan}`;
}
