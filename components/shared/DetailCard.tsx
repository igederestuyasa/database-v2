/**
 * One group of fields as a Card with a definition list.
 *
 * A Server Component: it renders text that was already resolved on the server
 * and has no state, so it ships no JavaScript to the browser. Anything
 * interactive on a detail page (the Riwayat Revisi panel) is its own client
 * component.
 *
 * Shared by all four detail pages — Karyawan, Unit Organisasi, Jabatan and
 * Lookup — rather than copied per segment, because a field list that reads
 * differently on the Jabatan page than on the Karyawan page is exactly the
 * drift that makes a handover harder.
 *
 * DUA JENIS KETERANGAN, DAN BEDANYA PENTING. `catatan` adalah DATA yang
 * menempel pada sebuah nilai — kode di balik sebuah nama, nomor surat, berapa
 * yang aktif — dan selalu terlihat. `info` adalah PENJELASAN tentang kolomnya,
 * dan pindah ke balik penanda "i" supaya halaman tidak penuh kalimat yang cuma
 * dibaca sekali seumur hidup. Jangan pernah menaruh data di `info`.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import Info from "@/components/hc/Info";
import StatusLabel from "@/components/hc/StatusLabel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** One row of a definition list: a label, a value, and why it looks like that. */
export type DetailField = {
  /** Indonesian, Title Case — unique inside its section (it is the React key). */
  label: string;
  /** Already formatted. Never empty: an empty column reads as a dash. */
  value: string;
  /**
   * When set, `value` is drawn as a link to that page.
   *
   * Only ever a **name** with a link behind it, never a uuid: a detail page
   * that prints `parent_id: 3f2a…` has failed at the one job it has.
   */
  href?: string;
  /** DATA kecil di bawah nilai — kode di balik nama, nomor surat. Selalu tampil. */
  catatan?: ReactNode;
  /** PENJELASAN kolomnya. Pindah ke balik penanda "i" di samping label. */
  info?: ReactNode;
  /**
   * PRD #6: computed, never stored, never editable.
   *
   * `true` memakai kalimat bawaan (kolom yang dihitung dari tanggal). Sebuah
   * string menggantinya — dipakai kolom yang turunannya bukan dari tanggal,
   * misalnya jenjang Unit Organisasi yang diturunkan dari hierarki.
   */
  turunan?: boolean | string;
  /** Free text that deserves the full width of the card. */
  lebar?: boolean;
};

/**
 * A derived column is marked wherever it appears, because the first question
 * staf HC ask about "Masa Kerja" is why they cannot edit it (PRD #6).
 */
const TURUNAN_BAWAAN =
  "Dihitung otomatis dari tanggal; tidak disimpan dan tidak bisa diubah.";

function TandaTurunan({ penjelasan }: { penjelasan?: string }) {
  return (
    <StatusLabel title={penjelasan ?? TURUNAN_BAWAAN}>
      dihitung otomatis
    </StatusLabel>
  );
}

export function FieldList({ fields }: { fields: readonly DetailField[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.label}
          className={field.lebar ? "min-w-0 sm:col-span-2" : "min-w-0"}
        >
          <dt className="flex flex-wrap items-center gap-1.5 text-pendukung text-muted-foreground">
            {field.label}
            {field.info ? (
              <Info label={`Keterangan ${field.label}`}>{field.info}</Info>
            ) : null}
            {field.turunan ? (
              <TandaTurunan
                penjelasan={
                  typeof field.turunan === "string" ? field.turunan : undefined
                }
              />
            ) : null}
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-isi">
            {field.href ? (
              <Link
                href={field.href}
                className="font-medium underline-offset-2 hover:underline"
              >
                {field.value}
              </Link>
            ) : (
              field.value
            )}
          </dd>
          {field.catatan ? (
            <dd className="mt-0.5 break-words text-mikro font-normal text-muted-foreground">
              {field.catatan}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export type DetailCardProps = {
  judul: string;
  /** Penjelasan bagiannya; pindah ke balik penanda "i" di samping judul. */
  keterangan?: string;
  fields: readonly DetailField[];
  /** Rendered under the fields — an access note, an "belum diisi" line. */
  catatan?: ReactNode;
};

export default function DetailCard({
  judul,
  keterangan,
  fields,
  catatan,
}: DetailCardProps) {
  return (
    <Card className="hc-permukaan rounded-kartu border-border shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-judul-bagian">
          {judul}
          {keterangan ? (
            <Info label={`Keterangan ${judul}`}>{keterangan}</Info>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList fields={fields} />
        {catatan ? (
          <p className="text-pendukung text-muted-foreground">{catatan}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
