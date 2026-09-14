"use client";

/**
 * Form Tambah / Ubah Jabatan (PRD #8).
 *
 * Hanya dua kolom, dan itu memang seluruh isi sebuah Jabatan: `kode` dan
 * `nama`. Jabatan adalah **nama pekerjaan yang bisa dipegang banyak Karyawan
 * sekaligus**, bukan kursi — tidak ada Unit Organisasi, tidak ada kuota,
 * tidak ada jumlah pemegang. Yang seperti itu namanya Formasi dan sengaja
 * ditunda (ADR-002, CONTEXT.md).
 *
 * Dua sifat yang membedakan kedua kolom itu:
 *
 *   * **`kode` stabil.** Dibuat sekali, lalu tidak bisa diubah: Konsumen dan
 *     Revisi lama merujuknya. Dua kode yang ternyata satu Jabatan dibereskan
 *     lewat Merge (PRD #10), bukan dengan mengetik ulang kodenya.
 *   * **`nama` boleh berubah,** dan perubahannya langsung berlaku untuk semua
 *     pemegangnya — karena nama itu tidak pernah disalin ke baris Karyawan,
 *     hanya dirujuk lewat `employees.jabatan_id`.
 *
 * Status tidak diatur dari sini. Menonaktifkan sebuah Jabatan adalah keputusan
 * tersendiri yang perlu tahu berapa Karyawan memegangnya, jadi tempatnya di
 * dialog konfirmasi di halaman Jabatan, bukan di sebuah kotak centang.
 */
import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { createJabatan, renameJabatan } from "@/lib/actions/jabatan";
import type { JabatanRingkas } from "@/lib/actions/jabatan";
import { TERMS, UI } from "@/lib/i18n/terms";
import { jabatanFieldsSchema } from "@/lib/validation/jabatan";

/** Kolom yang benar-benar diisi manusia. `status` diurus di luar form ini. */
const jabatanFormSchema = jabatanFieldsSchema.pick({ kode: true, nama: true });

type JabatanFormValues = { kode: string; nama: string };

/**
 * Schema yang sama dipakai form dan Server Action (ARCHITECTURE.md §1).
 *
 * Cast-nya perlu karena setiap field di `lib/validation/common.ts` dibungkus
 * `z.preprocess` (yang memangkas spasi), sehingga tipe *input* schema-nya
 * `unknown` — benar untuk data yang datang dari HTML, tapi tidak bisa dipakai
 * react-hook-form sebagai tipe field. Keluaran schema untuk dua kolom ini
 * memang `{ kode: string; nama: string }`, jadi cast ini menyatakan hal yang
 * sudah benar, bukan melonggarkan validasinya: zod tetap yang memvalidasi, dan
 * Server Action memvalidasi ulang dengan schema yang sama.
 */
const jabatanFormResolver = zodResolver(
  jabatanFormSchema,
) as Resolver<JabatanFormValues>;

export type JabatanFormProps = {
  /** Baris yang sedang diubah. Kosong berarti tambah Jabatan baru. */
  jabatan?: { id: string; kode: string; nama: string } | null;
  /** Dipanggil setelah simpan berhasil — misalnya untuk menutup dialog. */
  onSelesai?: (jabatan: JabatanRingkas) => void;
  /** Dipanggil saat tombol Batal ditekan. */
  onBatal?: () => void;
};

export function JabatanForm({ jabatan, onSelesai, onBatal }: JabatanFormProps) {
  const sedangUbah = Boolean(jabatan);

  const form = useForm<JabatanFormValues>({
    resolver: jabatanFormResolver,
    defaultValues: { kode: jabatan?.kode ?? "", nama: jabatan?.nama ?? "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // Ubah = ganti nama saja. Kode tidak ikut dikirim, sehingga tidak ada jalan
    // dari layar ini yang bisa menggesernya.
    const result = jabatan
      ? await renameJabatan({ id: jabatan.id, nama: values.nama })
      : await createJabatan({
          kode: values.kode,
          nama: values.nama,
          status: "aktif",
        });

    if (!result.ok) {
      for (const [field, message] of Object.entries(
        result.error.fieldErrors ?? {},
      )) {
        if (field === "kode" || field === "nama") {
          form.setError(field, { type: "server", message });
        }
      }
      toast.error(result.error.message);
      return;
    }

    toast.success(
      sedangUbah
        ? `Nama ${TERMS.jabatan} diubah menjadi "${result.data.nama}".`
        : `${TERMS.jabatan} "${result.data.nama}" ditambahkan.`,
    );
    if (!sedangUbah) form.reset({ kode: "", nama: "" });
    onSelesai?.(result.data);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="kode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Kode {TERMS.jabatan}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  readOnly={sedangUbah}
                  autoFocus={!sedangUbah}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="mis. JBT-001"
                  className={sedangUbah ? "bg-muted" : undefined}
                />
              </FormControl>
              <FormDescription>
                {sedangUbah
                  ? "Kode tidak bisa diubah setelah Jabatan dibuat. Kalau dua kode ternyata Jabatan yang sama, gabungkan keduanya lewat Merge."
                  : "Kode tetap yang dipakai untuk merujuk Jabatan ini. Tidak bisa diubah setelah disimpan."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="nama"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nama {TERMS.jabatan}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus={sedangUbah}
                  autoComplete="off"
                  placeholder="mis. Manager Proyek"
                />
              </FormControl>
              <FormDescription>
                Nama boleh diperbaiki kapan saja; perubahannya langsung berlaku
                untuk semua {TERMS.karyawan} yang memegang {TERMS.jabatan} ini.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          {onBatal ? (
            <Button
              type="button"
              variant="outline"
              onClick={onBatal}
              disabled={form.formState.isSubmitting}
            >
              {UI.batal}
            </Button>
          ) : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Menyimpan…" : UI.simpan}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default JabatanForm;
