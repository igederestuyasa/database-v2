/**
 * Everything the Jabatan detail page says, as pure text.
 *
 * A PLAIN module — no `"use client"`, no JSX, no hooks, no database. It is
 * imported by `page.tsx`, a Server Component, and a mapper a Server Component
 * imports must never live in a `"use client"` file: the page would keep
 * building and only fail in a production build.
 *
 * Two things it owes the page:
 *
 *   * **Names, never uuids.** `merged_into_id` arrives as a row the page
 *     already read and leaves as a nama with an `href` behind it.
 *   * **Jabatan is not Formasi.** There is no kuota, no unit and no seat here
 *     (ADR-002, CONTEXT.md). The number of holders is shown because a Merge
 *     and a Nonaktifkan both turn on it, not because a Jabatan has a size.
 */
import { columnLabel } from "@/components/revisions/revisionDiff";
import type { DetailField } from "@/components/shared/DetailCard";
import { KOSONG } from "@/lib/derived";
import { STATUS_LABELS, TERMS } from "@/lib/i18n/terms";
import type { Jabatan } from "@/lib/types/db";

/** Shown where a value could not be read — never where it is simply empty. */
export const GAGAL_DIMUAT = "(tidak bisa dimuat)";

/** Karyawan holding one Jabatan, or `null` when counting failed. */
export type JumlahPemegang = { semua: number; aktif: number } | null;

/** `jabatan.status` → "Nonaktif". */
export function labelStatusJabatan(status: string | null | undefined): string {
  if (status === "aktif" || status === "nonaktif") return STATUS_LABELS[status];
  return status ? status : KOSONG;
}

/** The detail page of one Jabatan. */
export function hrefJabatan(id: string): string {
  return `/jabatan/${id}`;
}

/**
 * Daftar Karyawan filtered to the holders of one Jabatan.
 *
 * `status=semua` because the number beside the link counts every status; a
 * link whose result does not match the number next to it is worse than none.
 */
export function hrefKaryawanDenganJabatan(id: string): string {
  return `/karyawan?status=semua&jabatan=${encodeURIComponent(id)}`;
}

/** How many Karyawan hold this Jabatan, as a field that links to them. */
export function fieldJumlahPemegang(
  jabatanId: string,
  jumlah: JumlahPemegang,
): DetailField {
  const label = `Pemegang ${TERMS.jabatan} ini`;

  if (jumlah === null) {
    return {
      label,
      value: GAGAL_DIMUAT,
      catatan: `Jumlah pemegang tidak bisa dihitung sekarang. Muat ulang halaman ini untuk mencoba lagi.`,
    };
  }
  if (jumlah.semua === 0) {
    return {
      label,
      value: `0 ${TERMS.karyawan}`,
    };
  }
  return {
    label,
    value: `${jumlah.semua} ${TERMS.karyawan}`,
    href: hrefKaryawanDenganJabatan(jabatanId),
    catatan: `${jumlah.aktif} di antaranya aktif`,
    info: `Satu ${TERMS.jabatan} boleh dipegang banyak ${TERMS.karyawan} sekaligus — ini bukan ${TERMS.formasi}.`,
  };
}

export type JabatanDetailInput = {
  jabatan: Jabatan;
  /** The Merge target, when `merged_into_id` is set and it could be read. */
  digabungkanKe: Jabatan | null;
  jumlahPemegang: JumlahPemegang;
};

/** Every field of one Jabatan, in the order the page shows them. */
export function buildJabatanFields({
  jabatan,
  digabungkanKe,
  jumlahPemegang,
}: JabatanDetailInput): DetailField[] {
  const fields: DetailField[] = [
    { label: columnLabel("jabatan", "nama"), value: jabatan.nama },
    {
      label: columnLabel("jabatan", "kode"),
      value: jabatan.kode,
      info: "Kode tetap; nama boleh berubah kapan saja.",
    },
    {
      label: columnLabel("jabatan", "status"),
      value: labelStatusJabatan(jabatan.status),
    },
    fieldJumlahPemegang(jabatan.id, jumlahPemegang),
  ];

  // Only when it happened: a "Digabungkan ke: —" row on every healthy Jabatan
  // is noise, and Merge is the exception, not a property every Jabatan has.
  if (jabatan.merged_into_id) {
    fields.push({
      label: columnLabel("jabatan", "merged_into_id"),
      value: digabungkanKe ? digabungkanKe.nama : `${TERMS.jabatan} lain`,
      href: hrefJabatan(jabatan.merged_into_id),
      catatan: digabungkanKe
        ? `Kode ${digabungkanKe.kode}`
        : `Nama ${TERMS.jabatan} tujuan tidak bisa dibaca sekarang.`,
      lebar: true,
    });
  }

  return fields;
}
