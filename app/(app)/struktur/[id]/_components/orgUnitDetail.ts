/**
 * Everything the Unit Organisasi detail page says, as pure text.
 *
 * A PLAIN module — no `"use client"`, no JSX, no hooks, no database. It is
 * imported by `page.tsx`, a Server Component, and a mapper a Server Component
 * imports must never live in a `"use client"` file: the page would keep
 * building and only fail in a production build.
 *
 * What it owes the page:
 *
 *   * **Names, never uuids.** `parent_id` and `merged_into_id` arrive here as
 *     rows the page already read, and leave as a nama with an `href` behind it.
 *     A detail page that prints `merged_into_id: 9b1c…` has failed.
 *   * **The same Indonesian wording as the log.** Labels come from
 *     `columnLabel("org_units", …)` in `components/revisions/revisionDiff.ts`,
 *     the map the Riwayat Revisi panel on the same page uses for its diff, so a
 *     column does not change its name between the panel and the field above it.
 *   * **"Tidak bisa dimuat" is not "kosong".** The induk comes from the
 *     ancestor read, which can fail without the unit itself failing; saying
 *     "—" there would claim this unit sits at the top of the company.
 */
import { columnLabel } from "@/components/revisions/revisionDiff";
import type { DetailField } from "@/components/shared/DetailCard";
import { KOSONG } from "@/lib/derived";
import { ORG_UNIT_TYPE_LABELS, STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import type { OrgUnit } from "@/lib/types/db";

/** Shown where a value could not be read — never where it is simply empty. */
export const GAGAL_DIMUAT = "(tidak bisa dimuat)";

/** `org_units.tipe` → "Sub Bagian". An unknown value is shown as it is. */
export function labelTipeUnit(tipe: string | null | undefined): string {
  if (!tipe) return KOSONG;
  return ORG_UNIT_TYPE_LABELS[tipe as keyof typeof ORG_UNIT_TYPE_LABELS] ?? tipe;
}

/** `org_units.status` → "Nonaktif". */
export function labelStatusUnit(status: string | null | undefined): string {
  if (status === "aktif" || status === "nonaktif") return STATUS_LABELS[status];
  return status ? status : KOSONG;
}

/** The detail page of one Unit Organisasi. */
export function hrefUnit(id: string): string {
  return `/struktur/${id}`;
}

/**
 * Daftar Karyawan filtered to this unit alone.
 *
 * `sub=0` on purpose: the count next to this link is the number of Karyawan
 * whose `org_unit_id` is this unit, and `/karyawan` includes the subtree unless
 * told not to — a link whose result does not match the number beside it is
 * worse than no link. `status=semua` for the same reason: the number counts
 * every status.
 */
export function hrefKaryawanDiUnit(id: string): string {
  return `/karyawan?status=semua&unit=${encodeURIComponent(id)}&sub=0`;
}

/** Karyawan pointing straight at one unit, or `null` when counting failed. */
export type JumlahKaryawan = { semua: number; aktif: number } | null;

export type OrgUnitDetailInput = {
  unit: OrgUnit;
  /** The induk row, when `parent_id` is set and the ancestor read succeeded. */
  induk: OrgUnit | null;
  /** The ancestor read failed, so "no induk" cannot be told from "unknown". */
  indukGagal: boolean;
  /** The Merge target, when `merged_into_id` is set and it could be read. */
  digabungkanKe: OrgUnit | null;
  /** How many Karyawan point straight at this unit. */
  jumlahKaryawan: JumlahKaryawan;
};

/**
 * The induk field.
 *
 * Three different states that must not be collapsed into one dash: a real
 * induk (a link), a unit that genuinely has none (a Direktorat, or a Temuan on
 * "Perlu Dibereskan"), and an induk that exists but could not be read.
 */
function fieldInduk({ unit, induk, indukGagal }: OrgUnitDetailInput): DetailField {
  const label = columnLabel("org_units", "parent_id");

  if (induk) {
    return {
      label,
      value: induk.nama,
      href: hrefUnit(induk.id),
      catatan: `${induk.kode} · ${labelTipeUnit(induk.tipe)}`,
    };
  }
  if (unit.parent_id === null) {
    return {
      label,
      value: KOSONG,
      catatan:
        unit.tipe === "direktorat"
          ? "Direktorat memang berada di puncak hierarki."
          : `Tanpa induk — muncul sebagai ${TERMS.temuan} di halaman ${TERMS.perluDibereskan}.`,
    };
  }
  return {
    label,
    value: indukGagal ? GAGAL_DIMUAT : KOSONG,
    catatan: indukGagal
      ? "Hierarki di atas unit ini belum berhasil dibaca. Muat ulang halaman ini untuk mencoba lagi."
      : `Induknya tidak ada di daftar ${TERMS.unitOrganisasi} — muncul sebagai ${TERMS.temuan} di halaman ${TERMS.perluDibereskan}.`,
  };
}

/**
 * How many Karyawan point at this unit, as a field that links to them.
 *
 * Only Karyawan whose `org_unit_id` IS this unit — the ones a Merge would
 * move. Karyawan in the units below keep their own `org_unit_id`, so counting
 * them here would inflate the number staf HC read right before deciding
 * something (CLAUDE.md: Karyawan menunjuk unit terendah).
 */
export function fieldJumlahKaryawan(
  unitId: string,
  jumlah: JumlahKaryawan,
): DetailField {
  const label = `${TERMS.karyawan} di unit ini`;

  if (jumlah === null) {
    return {
      label,
      value: GAGAL_DIMUAT,
      catatan: `Jumlah ${TERMS.karyawan} tidak bisa dihitung sekarang. Muat ulang halaman ini untuk mencoba lagi.`,
    };
  }
  if (jumlah.semua === 0) {
    return {
      label,
      value: `0 ${TERMS.karyawan}`,
      catatan: `Belum ada ${TERMS.karyawan} yang ditempatkan langsung di unit ini.`,
    };
  }
  return {
    label,
    value: `${jumlah.semua} ${TERMS.karyawan}`,
    href: hrefKaryawanDiUnit(unitId),
    catatan: `${jumlah.aktif} di antaranya aktif. ${TERMS.karyawan} di unit turunannya tidak ikut dihitung.`,
  };
}

/** Every field of one Unit Organisasi, in the order the page shows them. */
export function buildOrgUnitFields(input: OrgUnitDetailInput): DetailField[] {
  const { unit, digabungkanKe, jumlahKaryawan } = input;

  const fields: DetailField[] = [
    { label: columnLabel("org_units", "nama"), value: unit.nama },
    {
      label: columnLabel("org_units", "kode"),
      value: unit.kode,
      catatan: "Kode tetap; nama boleh berubah kapan saja.",
    },
    { label: columnLabel("org_units", "tipe"), value: labelTipeUnit(unit.tipe) },
    fieldInduk(input),
    { label: columnLabel("org_units", "status"), value: labelStatusUnit(unit.status) },
    fieldJumlahKaryawan(unit.id, jumlahKaryawan),
  ];

  // Only when it happened: a "Digabungkan ke: —" row on every healthy unit is
  // noise, and Merge is the exception, not a property every unit has.
  if (unit.merged_into_id) {
    fields.push({
      label: columnLabel("org_units", "merged_into_id"),
      value: digabungkanKe ? digabungkanKe.nama : `${TERMS.unitOrganisasi} lain`,
      href: hrefUnit(unit.merged_into_id),
      catatan: digabungkanKe
        ? `${digabungkanKe.kode} · ${labelTipeUnit(digabungkanKe.tipe)}`
        : "Nama unit tujuan tidak bisa dibaca sekarang.",
      lebar: true,
    });
  }

  return fields;
}
