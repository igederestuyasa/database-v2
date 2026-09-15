/**
 * Everything the Lookup detail page says, as pure text.
 *
 * A PLAIN module — no `"use client"`, no JSX, no hooks, no database. It is
 * imported by `page.tsx`, a Server Component, and a mapper a Server Component
 * imports must never live in a `"use client"` file: the page would keep
 * building and only fail in a production build.
 *
 * Three things it owes the page:
 *
 *   * **Names, never uuids.** `merged_into_id` arrives as a row the page
 *     already read and leaves as a label with an `href` behind it.
 *   * **Back to the right tab.** `/master-data` is tabbed by `tipe` and the
 *     open tab lives in the URL, so a back link to a bare `/master-data` would
 *     drop the reader on Work Contract no matter which list they came from.
 *   * **`tipe` is narrowed, never trusted.** `lookups.tipe` is `text` with a
 *     CHECK constraint; anything that reaches a URL or a label map goes
 *     through `isLookupType()` first.
 */
import { columnLabel } from "@/components/revisions/revisionDiff";
import type { DetailField } from "@/components/shared/DetailCard";
import { KOSONG } from "@/lib/derived";
import { STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import type { Lookup } from "@/lib/types/db";
import {
  isLookupType,
  LOOKUP_TYPE_LABELS,
  LOOKUP_TYPE_TO_EMPLOYEE_COLUMN,
} from "@/lib/validation/lookupTypes";

/** Shown where a value could not be read — never where it is simply empty. */
export const GAGAL_DIMUAT = "(tidak bisa dimuat)";

/** Karyawan pointing at one Lookup, or `null` when counting failed. */
export type JumlahPemakai = { semua: number; aktif: number } | null;

/** `lookups.tipe` → "Job Grade". An unknown value is shown as it is. */
export function labelTipeLookup(tipe: string): string {
  return isLookupType(tipe) ? LOOKUP_TYPE_LABELS[tipe] : tipe;
}

/** `lookups.status` → "Nonaktif". */
export function labelStatusLookup(status: string | null | undefined): string {
  if (status === "aktif" || status === "nonaktif") return STATUS_LABELS[status];
  return status ? status : KOSONG;
}

/**
 * Back to the Master Data tab this Lookup lives in.
 *
 * A tipe outside the eleven cannot exist (CHECK constraint), but if one ever
 * did, sending the reader to `?tipe=<garbage>` would land them on a tab the
 * page silently replaces with the first one — so an unknown tipe goes to the
 * bare page instead of to a lie.
 */
export function hrefTabMasterData(tipe: string): string {
  return isLookupType(tipe)
    ? `/master-data?tipe=${encodeURIComponent(tipe)}`
    : "/master-data";
}

/** The detail page of one Lookup. */
export function hrefLookup(id: string): string {
  return `/master-data/${id}`;
}

/**
 * Daftar Karyawan filtered to the users of one Lookup.
 *
 * The filter key is the Lookup's own `tipe` (`/karyawan?job_grade=<id>`), so a
 * tipe outside the eleven has no link at all rather than a query parameter
 * `/karyawan` would quietly drop. `status=semua` because the number beside the
 * link counts every status.
 */
export function hrefKaryawanDenganLookup(
  lookup: Pick<Lookup, "id" | "tipe">,
): string | undefined {
  if (!isLookupType(lookup.tipe)) return undefined;
  return `/karyawan?status=semua&${lookup.tipe}=${encodeURIComponent(lookup.id)}`;
}

/** How many Karyawan point at this Lookup, as a field that links to them. */
export function fieldJumlahPemakai(
  lookup: Pick<Lookup, "id" | "tipe">,
  jumlah: JumlahPemakai,
): DetailField {
  const label = `${TERMS.karyawan} yang memakai nilai ini`;

  // Checked before `jumlah`, because for a tipe outside the eleven the count
  // can never arrive: `countEmployeesByLookup()` refuses to guess which
  // `employees` column to count and throws every time. Falling through to the
  // generic failure below would tell the reader to reload a page that will
  // fail again for the same reason.
  if (!isLookupType(lookup.tipe)) {
    return {
      label,
      value: GAGAL_DIMUAT,
      catatan: `Tipe "${lookup.tipe}" bukan salah satu tipe ${TERMS.lookup} yang dikenal, jadi kolom ${TERMS.karyawan} yang memakainya tidak bisa ditentukan. Perbaiki tipenya lebih dulu.`,
    };
  }

  if (jumlah === null) {
    return {
      label,
      value: GAGAL_DIMUAT,
      catatan: `Jumlah pemakai tidak bisa dihitung sekarang. Muat ulang halaman ini untuk mencoba lagi.`,
    };
  }
  if (jumlah.semua === 0) {
    return {
      label,
      value: `0 ${TERMS.karyawan}`,
      catatan: `Belum ada ${TERMS.karyawan} yang memakai nilai ini.`,
    };
  }
  return {
    label,
    value: `${jumlah.semua} ${TERMS.karyawan}`,
    href: hrefKaryawanDenganLookup(lookup),
    catatan: `${jumlah.aktif} di antaranya aktif, lewat kolom ${LOOKUP_TYPE_TO_EMPLOYEE_COLUMN[lookup.tipe]}.`,
  };
}

export type LookupDetailInput = {
  lookup: Lookup;
  /** The Merge target, when `merged_into_id` is set and it could be read. */
  digabungkanKe: Lookup | null;
  jumlahPemakai: JumlahPemakai;
};

/** Every field of one Lookup, in the order the page shows them. */
export function buildLookupFields({
  lookup,
  digabungkanKe,
  jumlahPemakai,
}: LookupDetailInput): DetailField[] {
  const fields: DetailField[] = [
    { label: columnLabel("lookups", "label"), value: lookup.label },
    {
      label: columnLabel("lookups", "kode"),
      value: lookup.kode,
      catatan: "Kode tetap; label boleh berubah kapan saja.",
    },
    {
      label: columnLabel("lookups", "tipe"),
      value: labelTipeLookup(lookup.tipe),
      href: hrefTabMasterData(lookup.tipe),
    },
    {
      label: columnLabel("lookups", "urutan"),
      value: lookup.urutan === null ? KOSONG : String(lookup.urutan),
      catatan:
        lookup.urutan === null
          ? "Tanpa urutan — tampil paling bawah di dropdown, diurutkan menurut Label."
          : "Angka kecil tampil lebih dulu di dropdown.",
    },
    {
      label: columnLabel("lookups", "status"),
      value: labelStatusLookup(lookup.status),
    },
    fieldJumlahPemakai(lookup, jumlahPemakai),
  ];

  // Only when it happened: a "Digabungkan ke: —" row on every healthy Lookup
  // is noise, and Merge is the exception, not a property every Lookup has.
  if (lookup.merged_into_id) {
    fields.push({
      label: columnLabel("lookups", "merged_into_id"),
      value: digabungkanKe ? digabungkanKe.label : `${TERMS.lookup} lain`,
      href: hrefLookup(lookup.merged_into_id),
      catatan: digabungkanKe
        ? `Kode ${digabungkanKe.kode}`
        : `Label ${TERMS.lookup} tujuan tidak bisa dibaca sekarang.`,
      lebar: true,
    });
  }

  return fields;
}
