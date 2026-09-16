"use client";

import * as React from "react";
import { CircleAlert } from "lucide-react";

import {
  FormDescription,
  FormLabel,
  FormMessage,
  useFormField,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Bidang isian HC Panel — docs/DESIGN.md §Komponen ("Input form").
 *
 * KENAPA MENUMPANG, BUKAN MENGGANTI. Setiap form di HC Core sudah berdiri di
 * atas `components/ui/form.tsx` (beku), yang menyambungkan label, teks bantuan,
 * dan pesan error ke `aria-describedby` dan `aria-invalid` react-hook-form.
 * Menggantinya berarti menulis ulang sambungan itu — dan sambungan aksesibilitas
 * yang ditulis ulang adalah sambungan yang diam-diam putus. Jadi berkas ini
 * hanya memberi tampilan HC Panel pada bagian-bagian itu.
 *
 * Radius 12 dan border garis-kuat sudah datang sendiri dari token: `rounded-md`
 * di `ui/input.tsx` menunjuk `--radius-bidang`, dan `border-input` menunjuk
 * `--garis-kuat`. Yang tersisa hanya tinggi 44 dan ukuran hurufnya — itulah
 * `KELAS_ISIAN`.
 */

/**
 * Ditempelkan ke `<Input>`, `<Textarea>`, dan `<SelectTrigger>`.
 *
 * `h-11` = 44, tinggi bidang isian. Tidak berlaku untuk `<Textarea>` yang
 * memang tumbuh; di sana pakai `KELAS_ISIAN_TUMBUH`.
 */
export const KELAS_ISIAN = "h-11 text-isi";

/** Untuk kolom yang tingginya mengikuti isi — textarea. */
export const KELAS_ISIAN_TUMBUH = "min-h-[5.5rem] py-3 text-isi";

/** Label di atas kolom: 14px 600. */
export function BidangLabel({
  className,
  ...props
}: React.ComponentProps<typeof FormLabel>) {
  return <FormLabel className={cn("text-label", className)} {...props} />;
}

/** Teks bantuan di bawah kolom: 14px redup. */
export function BidangBantuan({
  className,
  ...props
}: React.ComponentProps<typeof FormDescription>) {
  return (
    <FormDescription
      className={cn("text-pendukung text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Pesan error: 14px merah dengan ikon warning-circle.
 *
 * Ikonnya hanya muncul kalau memang ada error — `FormMessage` sendiri
 * merender `null` saat bersih, jadi tanpa penjaga ini yang tersisa di layar
 * adalah ikon peringatan yang menunjuk ke tempat kosong. `useFormField()`
 * itulah penjaganya, dan itu sebabnya komponen ini hanya sah di dalam
 * `<FormField>` — persis seperti `FormMessage` yang dibungkusnya.
 */
export function BidangPesan({ className }: { className?: string }) {
  const { error } = useFormField();
  if (!error) return null;

  return (
    <div className={cn("flex items-start gap-1.5 text-destructive", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <FormMessage className="text-pendukung font-medium text-destructive" />
    </div>
  );
}

/**
 * Bidang berdiri sendiri, untuk kolom di luar react-hook-form — bar filter,
 * kolom di dalam dialog, dan sejenisnya. Menyambungkan label, bantuan, dan
 * pesan error ke kontrolnya sendiri lewat `aria-describedby`.
 */
export function Bidang({
  label,
  bantuan,
  pesan,
  children,
  className,
}: {
  label: string;
  bantuan?: React.ReactNode;
  /** Pesan error. Kosongkan kalau tidak ada masalah. */
  pesan?: string | null;
  /** Menerima `id` dan `aria-describedby` yang sudah dirangkai. */
  children: (props: { id: string; "aria-describedby": string | undefined }) => React.ReactNode;
  className?: string;
}) {
  const dasar = React.useId();
  const idKontrol = `${dasar}-kontrol`;
  const idBantuan = `${dasar}-bantuan`;
  const idPesan = `${dasar}-pesan`;

  const dijelaskan =
    [bantuan ? idBantuan : null, pesan ? idPesan : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={idKontrol} className="block text-label text-foreground">
        {label}
      </label>

      {children({ id: idKontrol, "aria-describedby": dijelaskan })}

      {bantuan ? (
        <p id={idBantuan} className="text-pendukung text-muted-foreground">
          {bantuan}
        </p>
      ) : null}

      {pesan ? (
        <p id={idPesan} className="flex items-start gap-1.5 text-pendukung font-medium text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {pesan}
        </p>
      ) : null}
    </div>
  );
}

export default Bidang;
