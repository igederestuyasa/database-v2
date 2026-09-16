/**
 * Everything the Seed page *says* and *decides*, as plain functions.
 *
 * `SeedWizard.tsx` is a Client Component and cannot be rendered in `npm test`
 * (no jsdom, ADR-005 §1), so the parts that must be right — which sheet is
 * read, what the preview says, what the result screen reports — live here and
 * are unit-tested (`seedWizard.test.ts`). Same split as `MergeDialog.tsx`.
 */
import type { SeedResult } from "@/lib/actions/seed";
import { SHEET_NAME } from "@/lib/seed/excelMapping";
import type { RingkasanSeed } from "@/lib/seed/ringkasan";

/** Which screen of the wizard is showing. */
export type SeedStep = "pilih" | "pratinjau" | "selesai";

/** Well above the ±1.500-row workbook; a bigger file is the wrong file. */
export const MAKS_UKURAN_FILE = 20 * 1024 * 1024;

const EKSTENSI_EXCEL = [".xlsx", ".xlsm"] as const;

/** `null` when the file may be read; otherwise the sentence to show instead. */
export function periksaFile(nama: string, ukuran: number): string | null {
  const lower = nama.toLowerCase();
  if (!EKSTENSI_EXCEL.some((ext) => lower.endsWith(ext))) {
    return `File harus berformat Excel (.xlsx). Yang dipilih: "${nama}".`;
  }
  if (ukuran > MAKS_UKURAN_FILE) {
    return `File terlalu besar (${(ukuran / 1024 / 1024).toFixed(1)} MB). Workbook Demografi Karyawan seharusnya jauh di bawah ${MAKS_UKURAN_FILE / 1024 / 1024} MB.`;
  }
  return null;
}

/**
 * Which sheet to read. The documented one when present; the only sheet when
 * there is exactly one (with a note, so a renamed sheet is visible); otherwise
 * nothing, and the admin picks from the list.
 */
export function pilihSheet(
  sheetNames: readonly string[],
  utama: string = SHEET_NAME,
): { nama: string | null; catatan: string | null } {
  if (sheetNames.includes(utama)) return { nama: utama, catatan: null };
  if (sheetNames.length === 1) {
    return {
      nama: sheetNames[0],
      catatan: `Sheet "${utama}" tidak ada; satu-satunya sheet "${sheetNames[0]}" yang dibaca.`,
    };
  }
  return {
    nama: null,
    catatan:
      sheetNames.length === 0
        ? "File ini tidak punya sheet sama sekali."
        : `Sheet "${utama}" tidak ada di file ini. Pilih sheet yang berisi data Karyawan.`,
  };
}

/** `batches.keterangan` when the admin leaves the field alone — the CLI's default. */
export function keteranganDefault(namaFile: string): string {
  return `Seed awal dari ${namaFile}`;
}

export type BarisAngka = { label: string; nilai: string };

function perTipe(items: readonly { tipe: string; jumlah: number }[]): string {
  return items.map((item) => `${item.tipe} ${item.jumlah}`).join(", ");
}

/** The preview table, in the CLI report's order and wording. */
export function barisRingkasan(r: RingkasanSeed): BarisAngka[] {
  const unit = r.akanDibuat.unitOrganisasi;
  const lookup = r.akanDibuat.lookup;
  return [
    { label: "Baris data", nilai: `${r.baris.dibaca} dibaca, ${r.baris.kosong} kosong dilewati` },
    { label: "Kolom dipetakan", nilai: String(r.kolom.dipetakan) },
    {
      label: "Kolom diabaikan (rumus)",
      nilai: r.kolom.diabaikan.length > 0
        ? `${r.kolom.diabaikan.length}: ${r.kolom.diabaikan.join(", ")}`
        : "0",
    },
    {
      label: "Kolom tidak dikenal",
      nilai: r.kolom.tidakDikenal.length > 0
        ? `${r.kolom.tidakDikenal.length}: ${r.kolom.tidakDikenal.join(", ")}`
        : "0",
    },
    {
      label: "Unit Organisasi",
      nilai: unit.total > 0 ? `${unit.total} (${perTipe(unit.perTipe)})` : "0",
    },
    { label: "Jabatan", nilai: String(r.akanDibuat.jabatan) },
    {
      label: "Lookup",
      nilai: lookup.total > 0 ? `${lookup.total} (${perTipe(lookup.perTipe)})` : "0",
    },
    {
      label: "Karyawan",
      nilai: `${r.akanDibuat.karyawan.total} (${r.akanDibuat.karyawan.nonaktif} nonaktif)`,
    },
    { label: "Data Pribadi Sensitif terisi", nilai: String(r.akanDibuat.dataPribadi) },
  ];
}

/** The result screen — the CLI's closing summary, one line per count. */
export function barisHasil(result: SeedResult): BarisAngka[] {
  return [
    { label: "Batch id", nilai: result.batchId },
    { label: "Lookup", nilai: String(result.lookups) },
    { label: "Jabatan", nilai: String(result.jabatan) },
    { label: "Unit Organisasi", nilai: String(result.orgUnits) },
    { label: "Karyawan", nilai: String(result.employees) },
    { label: "Data Pribadi Sensitif", nilai: `${result.dataPribadi} baris diisi` },
    { label: "Revisi tercatat", nilai: String(result.revisions) },
  ];
}

/** Whether "Jalankan" may be pressed. */
export function bolehJalankan(input: {
  bisaDijalankan: boolean;
  paham: boolean;
  sedangJalan: boolean;
}): boolean {
  return input.bisaDijalankan && input.paham && !input.sedangJalan;
}
