import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { JABATAN, ORG_UNITS, ORG_UNIT_ID } from "@/fixtures";
import { toJabatanOptions, toOrgUnitOptions } from "@/components/shared/EntityPicker";
import {
  formatJumlah,
  jumlahKaryawanText,
  mergeFailureAdvice,
  mergeImpactLines,
  mergeKindCopy,
  mergeResultLines,
  normalizeAffectedCount,
  type MergeEntityKind,
} from "@/components/shared/MergeDialog";
import type { ActionErrorCode } from "@/lib/actions/_guard";
import type { MergeResult } from "@/lib/actions/merge";

/**
 * MergeDialog is the last thing standing between a non-technical HC user and a
 * bulk move of real personnel records (PRD #10), and it is the one component
 * with no page of its own — no route smoke test covers it. So everything it
 * *says* and every branch it takes on a refusal is a pure function, tested
 * here; the rendering is covered by a Playwright drive of a throwaway harness
 * page (see the PR body).
 *
 * The other half of this file guards the frozen Wave 1 contract. Three units
 * (Struktur Organisasi, Jabatan, Master Data) type against `MergeDialogProps`,
 * so a later edit that "improves" a prop has to fail here rather than in three
 * other people's builds.
 *
 * Fixtures only — never a real Unit Organisasi or Jabatan name (CLAUDE.md).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_PATH = path.join(ROOT, "components", "shared", "MergeDialog.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

const KINDS: readonly MergeEntityKind[] = ["org_unit", "jabatan", "lookup"];

const CODES: readonly ActionErrorCode[] = [
  "TIDAK_LOGIN",
  "BUKAN_ADMIN",
  "VALIDASI",
  "TIDAK_DITEMUKAN",
  "KONFLIK",
  "GAGAL",
];

const UNIT_OPTIONS = toOrgUnitOptions(ORG_UNITS);
const JABATAN_OPTIONS = toJabatanOptions(JABATAN);

/**
 * The dirty pair the fixtures ship on purpose: "DIVISI CONTOH" is the
 * shouted duplicate that was merged into "Divisi Contoh" (PRD #10, #11).
 */
function optionById(id: string) {
  const found = UNIT_OPTIONS.find((option) => option.id === id);
  if (!found) throw new Error(`fixture Unit Organisasi ${id} hilang`);
  return found;
}

const ASAL = optionById(ORG_UNIT_ID.divisiLama);
const TUJUAN = optionById(ORG_UNIT_ID.divisi);

describe("normalizeAffectedCount", () => {
  it("treats an absent count as 'belum dihitung', not as zero", () => {
    // The difference matters: 0 means nothing moves, undefined means the
    // caller has not counted and the dialog must not promise anything.
    expect(normalizeAffectedCount(undefined)).toBeNull();
  });

  it("refuses a count it would have to print as NaN or a negative", () => {
    expect(normalizeAffectedCount(Number.NaN)).toBeNull();
    expect(normalizeAffectedCount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeAffectedCount(-1)).toBeNull();
  });

  it("keeps a real count, truncating anything fractional", () => {
    expect(normalizeAffectedCount(0)).toBe(0);
    expect(normalizeAffectedCount(1)).toBe(1);
    expect(normalizeAffectedCount(1475)).toBe(1475);
    expect(normalizeAffectedCount(3.9)).toBe(3);
  });
});

describe("formatJumlah", () => {
  it("groups thousands the Indonesian way, deterministically", () => {
    expect(formatJumlah(0)).toBe("0");
    expect(formatJumlah(7)).toBe("7");
    expect(formatJumlah(999)).toBe("999");
    expect(formatJumlah(1000)).toBe("1.000");
    expect(formatJumlah(1475)).toBe("1.475");
    expect(formatJumlah(1234567)).toBe("1.234.567");
  });
});

describe("jumlahKaryawanText", () => {
  it("says plainly when nothing moves", () => {
    expect(jumlahKaryawanText(0)).toBe("Tidak ada Karyawan yang pindah");
  });

  it("says plainly when the number is unknown", () => {
    expect(jumlahKaryawanText(null)).toBe("Jumlah Karyawan belum dihitung");
  });

  it("leads with the number when there is one", () => {
    expect(jumlahKaryawanText(1475)).toBe("1.475 Karyawan pindah");
  });
});

describe("mergeKindCopy", () => {
  it("names every kind in CONTEXT.md vocabulary", () => {
    expect(mergeKindCopy("org_unit").entitas).toBe("Unit Organisasi");
    expect(mergeKindCopy("jabatan").entitas).toBe("Jabatan");
    expect(mergeKindCopy("lookup").entitas).toBe("Lookup");
  });

  it("warns about the precondition each kind actually has", () => {
    // These mirror the guards in merge_org_unit / merge_lookup, so the user
    // is told before the RPC refuses rather than after.
    expect(mergeKindCopy("org_unit").petunjukTujuan).toMatch(/di bawah asal/i);
    expect(mergeKindCopy("lookup").petunjukTujuan).toMatch(/satu tipe/i);
    expect(mergeKindCopy("jabatan").petunjukTujuan).toBeNull();
  });
});

describe("mergeImpactLines", () => {
  it("leads with the number of Karyawan and names both sides in full", () => {
    const lines = mergeImpactLines("org_unit", ASAL.label, TUJUAN.label, 1475);
    expect(lines[0]).toContain("1.475");
    expect(lines[0]).toContain("Karyawan");
    expect(lines[0]).toContain(ASAL.label);
    expect(lines[0]).toContain(TUJUAN.label);
  });

  it("promises nothing about a count it does not have", () => {
    const lines = mergeImpactLines("jabatan", ASAL.label, TUJUAN.label, null);
    expect(lines[0]).toMatch(/belum dihitung/i);
    expect(lines[0]).not.toMatch(/\d/);
  });

  it("says outright when nothing moves", () => {
    const lines = mergeImpactLines("lookup", ASAL.label, TUJUAN.label, 0);
    expect(lines[0]).toMatch(/tidak ada Karyawan/i);
  });

  it("mentions re-parenting only for Unit Organisasi", () => {
    // merge_jabatan / merge_lookup touch no hierarchy; promising one would be
    // a lie the database never fulfils.
    const unit = mergeImpactLines("org_unit", ASAL.label, TUJUAN.label, 3).join("\n");
    expect(unit).toMatch(/di bawah/i);

    for (const kind of ["jabatan", "lookup"] as const) {
      const other = mergeImpactLines(kind, ASAL.label, TUJUAN.label, 3).join("\n");
      expect(other).not.toMatch(/di bawah/i);
    }
  });

  it("always states that the source is deactivated, never deleted", () => {
    for (const kind of KINDS) {
      const lines = mergeImpactLines(kind, ASAL.label, TUJUAN.label, 12);
      const joined = lines.join("\n");
      expect(joined).toContain("Nonaktif");
      expect(joined).toMatch(/tidak dihapus/i);
      // "dihapus" may only ever appear as part of "tidak dihapus".
      for (const line of lines) {
        if (/dihapus/i.test(line)) expect(line).toMatch(/tidak dihapus/i);
      }
    }
  });

  it("always states that the whole thing is one revertable Batch", () => {
    for (const kind of KINDS) {
      const joined = mergeImpactLines(kind, ASAL.label, TUJUAN.label, 12).join("\n");
      expect(joined).toContain("Batch");
      expect(joined).toContain("Log Perubahan");
      expect(joined).toMatch(/dikembalikan/i);
    }
  });

  it("stays inside the glossary — no 'undo', 'rollback', 'employee'", () => {
    // CONTEXT.md lists these as words to avoid; UI language is Indonesian.
    const forbidden = /\b(undo|rollback|restore|employee|pegawai|dedup)\b/i;
    for (const kind of KINDS) {
      for (const jumlah of [null, 0, 1475]) {
        const joined = mergeImpactLines(kind, ASAL.label, TUJUAN.label, jumlah).join("\n");
        expect(joined).not.toMatch(forbidden);
      }
    }
  });
});

describe("mergeFailureAdvice", () => {
  it("has an answer for every ActionErrorCode", () => {
    for (const code of CODES) {
      const advice = mergeFailureAdvice(code);
      expect(advice.saran.length).toBeGreaterThan(0);
      expect(["pilih", "konfirmasi"]).toContain(advice.langkah);
    }
  });

  it("sends 'sudah pernah digabungkan' and its friends back to the picker", () => {
    // 55000 / 23514 / P0002 all arrive as KONFLIK or TIDAK_DITEMUKAN. Pressing
    // the same button again can only fail the same way, so the only useful
    // move is a different target — or a reload.
    for (const code of ["KONFLIK", "TIDAK_DITEMUKAN", "VALIDASI"] as const) {
      const advice = mergeFailureAdvice(code);
      expect(advice.langkah).toBe("pilih");
      expect(advice.bolehUlangi).toBe(false);
    }
  });

  it("reassures that a refused Merge changed nothing", () => {
    // Every merge RPC is one transaction: a refusal rolled the whole thing
    // back. Saying so is the difference between "try again" and "check the
    // log in a panic".
    for (const code of ["KONFLIK", "BUKAN_ADMIN", "TIDAK_LOGIN"] as const) {
      expect(mergeFailureAdvice(code).saran).toMatch(/tidak ada data yang berubah/i);
    }
  });

  it("does not offer a retry to someone who is not an admin", () => {
    for (const code of ["BUKAN_ADMIN", "TIDAK_LOGIN"] as const) {
      const advice = mergeFailureAdvice(code);
      expect(advice.bolehUlangi).toBe(false);
      expect(advice.langkah).toBe("konfirmasi");
    }
    expect(mergeFailureAdvice("BUKAN_ADMIN").saran).toContain("Admin");
  });

  it("offers a retry only for the genuinely unknown failure", () => {
    const advice = mergeFailureAdvice("GAGAL");
    expect(advice.bolehUlangi).toBe(true);
    expect(advice.langkah).toBe("konfirmasi");
    // An unknown failure may have happened after the writes, so it must NOT
    // claim nothing changed — it points at the log instead.
    expect(advice.saran).not.toMatch(/tidak ada data yang berubah/i);
    expect(advice.saran).toContain("Log Perubahan");
  });
});

describe("mergeResultLines", () => {
  const result: MergeResult = {
    batchId: "00000000-0000-4000-8000-000000000001",
    sourceId: ASAL.id,
    targetId: TUJUAN.id,
    movedEmployees: 1475,
    movedChildren: 4,
  };

  it("reports the counts the RPC actually returned, not the estimate", () => {
    const lines = mergeResultLines("org_unit", ASAL.label, TUJUAN.label, result).join("\n");
    expect(lines).toContain("1.475");
    expect(lines).toContain("4 Unit Organisasi");
  });

  it("reports re-parented children only for Unit Organisasi", () => {
    for (const kind of ["jabatan", "lookup"] as const) {
      const lines = mergeResultLines(kind, ASAL.label, TUJUAN.label, result).join("\n");
      expect(lines).not.toContain("Unit Organisasi");
    }
  });

  it("closes by saying where the source went", () => {
    for (const kind of KINDS) {
      const lines = mergeResultLines(kind, ASAL.label, TUJUAN.label, result);
      const last = lines[lines.length - 1];
      expect(last).toContain(ASAL.label);
      expect(last).toContain(TUJUAN.label);
      expect(last).toContain("Nonaktif");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The frozen Wave 1 contract, and the rules the source must keep.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Byte-for-byte the block Wave 1 froze. Three other PRs type against it. */
const FROZEN_PROPS = `/** Which kind of Data Referensi is being merged. */
export type MergeEntityKind = "org_unit" | "jabatan" | "lookup";

export type MergeDialogProps = {
  kind: MergeEntityKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entity that will become nonaktif. */
  source: EntityOption;
  /** Possible targets — already filtered to the same tipe, minus the source. */
  candidates: readonly EntityOption[];
  /** Pre-selected target, e.g. the other half of a Temuan pair. */
  defaultTargetId?: string | null;
  /** How many Karyawan point at \`source\` and will be moved. */
  affectedCount?: number;
  /** Called after a successful merge, so the page can refresh. */
  onMerged?: (result: { sourceId: string; targetId: string; batchId: string }) => void;
};`;

describe("MergeDialog source", () => {
  it("still declares the exact props Wave 1 froze", () => {
    expect(source).toContain(FROZEN_PROPS);
  });

  it("is a Client Component", () => {
    expect(source.trimStart().startsWith('"use client";')).toBe(true);
  });

  it("routes every kind through lib/actions/merge.ts and nothing else", () => {
    expect(source).toMatch(
      /import \{ mergeJabatan, mergeLookup, mergeOrgUnit \} from "@\/lib\/actions\/merge"/,
    );
    expect(source).toMatch(/org_unit:\s*mergeOrgUnit/);
    expect(source).toMatch(/jabatan:\s*mergeJabatan/);
    expect(source).toMatch(/lookup:\s*mergeLookup/);
  });

  it("never re-implements a merge in TypeScript", () => {
    // The whole Merge is one Postgres function per entity (ADR-006). A client
    // component that reached the database directly would be three Batch
    // entries at best and a half-merged company at worst.
    expect(source).not.toMatch(/\.rpc\s*\(/);
    expect(source).not.toMatch(/from\s*\(\s*["'`](employees|org_units|jabatan|lookups)["'`]/);
    expect(source).not.toMatch(/@\/lib\/supabase\//);
    expect(source).not.toMatch(/createClient\s*\(/);
  });

  it("never opens a Batch of its own", () => {
    // Also covered globally by tests/batchDiscipline.test.ts; kept here so the
    // failure names this file.
    expect(source).not.toMatch(/\bwithBatch\s*\(/);
    expect(source).not.toMatch(/\b(beginBatch|endBatch)\s*\(/);
    expect(source).not.toMatch(/["'`](begin_batch|end_batch)["'`]/);
  });

  it("picks the target with EntityPicker, never a free-text box (ADR-002)", () => {
    expect(source).toContain("<EntityPicker");
    expect(source).not.toMatch(/<\s*(input|textarea)\b/i);
  });

  it("guards against merging a row into itself before the SQL has to", () => {
    expect(source).toMatch(/candidates\.filter\(\(option\) => option\.id !== source\.id\)/);
  });

  it("clears a refusal on every route back to the confirm screen", () => {
    // Every code whose advice is `langkah: "pilih"` also has
    // `bolehUlangi: false`, which disables "Gabungkan sekarang". Walking
    // forward again without clearing the refusal would put the user on a
    // confirm screen with no enabled action on it.
    for (const handler of ["lanjutKeKonfirmasi", "kembaliKePilih", "pilihTujuan"]) {
      const body = source.slice(source.indexOf(`const ${handler} =`));
      expect(body.slice(0, 400)).toContain("setFailure(null)");
    }
    expect(source).toContain("onClick={lanjutKeKonfirmasi}");
  });

  it("reports the target it actually sent, not one looked up afterwards", () => {
    // `onMerged` makes the page re-fetch, and the merged pair is what drops
    // out of the refreshed `candidates` — so the success screen must not read
    // the label back out of the props.
    const selesai = source.slice(source.indexOf('step === "selesai"'));
    expect(selesai.slice(0, 2000)).not.toContain("target?.label");
    expect(selesai).toContain("labelTujuan ?? result.targetId");
  });
});

describe("EntityPicker interop", () => {
  it("accepts the option shape the reference pages will hand it", () => {
    // The three calling pages map their rows with these helpers, so the props
    // this dialog forwards have to line up with what they produce.
    expect(UNIT_OPTIONS.length).toBeGreaterThan(1);
    expect(JABATAN_OPTIONS.every((o) => typeof o.id === "string" && o.label.length > 0)).toBe(
      true,
    );
    expect(UNIT_OPTIONS.some((o) => o.status === "nonaktif")).toBe(true);
  });
});
