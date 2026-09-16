"use client";

/**
 * Form Tambah / Ubah API Key (PRD #19).
 *
 * Dua isian, dan yang kedua adalah seluruh isi keputusannya: nama Konsumen,
 * dan kolom apa saja yang boleh diambilnya. Tidak ada isian key: key dibuat
 * server, tidak pernah diketik atau ditempel orang, dan tidak pernah melewati
 * form ini ke arah mana pun.
 *
 * Status juga tidak diatur di sini. Menonaktifkan sebuah key memutus akses
 * Konsumen yang sedang berjalan — keputusan tersendiri dengan konfirmasinya
 * sendiri di halaman, bukan sebuah kotak centang yang ikut tersimpan bersama
 * perubahan nama.
 */
import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Tombol from "@/components/hc/Tombol";
import {
  Form,
  FormDescription,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  createApiKey,
  updateApiKey,
  type ApiKeyBaru,
  type ApiKeyRingkas,
} from "@/lib/actions/apiKeys";
import { sortApiFields, unknownApiFields } from "@/lib/apiKeys/fieldGroups";
import { TERMS, UI } from "@/lib/i18n/terms";
import { apiKeyFieldsSchema } from "@/lib/validation/apiKey";

import { FieldPicker } from "./FieldPicker";

/** Kolom yang benar-benar diisi manusia. `status` diurus di luar form ini. */
const apiKeyFormSchema = apiKeyFieldsSchema.pick({
  nama_konsumen: true,
  allowed_fields: true,
});

type ApiKeyFormValues = { nama_konsumen: string; allowed_fields: string[] };

/**
 * Schema yang sama dipakai form dan Server Action (ARCHITECTURE.md §1).
 *
 * Cast-nya perlu karena field di `lib/validation/common.ts` dibungkus
 * `z.preprocess`, sehingga tipe *input* schema-nya `unknown` — benar untuk
 * data yang datang dari HTML, tapi tidak bisa dipakai react-hook-form sebagai
 * tipe field. Keluaran schema untuk kedua kolom ini memang
 * `{ nama_konsumen: string; allowed_fields: string[] }`, jadi cast ini
 * menyatakan hal yang sudah benar, bukan melonggarkan validasinya: zod tetap
 * yang memvalidasi, dan Server Action memvalidasi ulang dengan schema yang
 * sama.
 */
const apiKeyFormResolver = zodResolver(
  apiKeyFormSchema,
) as Resolver<ApiKeyFormValues>;

export type ApiKeyFormProps = {
  /** Key yang sedang diubah. Kosong berarti membuat key baru. */
  apiKey?: {
    id: string;
    nama_konsumen: string;
    allowed_fields: readonly string[];
  } | null;
  /**
   * Dipanggil setelah key BARU berhasil dibuat, membawa key penuhnya.
   * Pemanggil wajib menampilkannya sekali — tidak ada cara membacanya lagi.
   */
  onDibuat?: (hasil: ApiKeyBaru) => void;
  /** Dipanggil setelah perubahan pada key yang sudah ada berhasil disimpan. */
  onDiubah?: (apiKey: ApiKeyRingkas) => void;
  onBatal?: () => void;
};

export function ApiKeyForm({
  apiKey,
  onDibuat,
  onDiubah,
  onBatal,
}: ApiKeyFormProps) {
  const sedangUbah = Boolean(apiKey);

  /**
   * Kolom tersimpan yang sudah tidak ada lagi di `v_employees_api`.
   *
   * Sebuah key yang dibuat sebelum sebuah kolom dibuang dari view masih
   * menyimpan namanya di `allowed_fields`. Kotak centangnya tidak ada di
   * layar, jadi menyimpan ulang akan membuangnya — itu memang yang benar,
   * tapi harus dikatakan, bukan terjadi diam-diam.
   */
  const kolomTidakDikenal = React.useMemo(
    () => (apiKey ? unknownApiFields([...apiKey.allowed_fields]) : []),
    [apiKey],
  );

  const form = useForm<ApiKeyFormValues>({
    resolver: apiKeyFormResolver,
    defaultValues: {
      nama_konsumen: apiKey?.nama_konsumen ?? "",
      allowed_fields: apiKey ? sortApiFields([...apiKey.allowed_fields]) : [],
    },
  });

  /** Pesan kegagalan yang sama untuk kedua jalur, termasuk per-isian. */
  const tanganiGagal = React.useCallback(
    (error: { message: string; fieldErrors?: Record<string, string> }) => {
      for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
        if (field === "nama_konsumen" || field === "allowed_fields") {
          form.setError(field, { type: "server", message });
        }
      }
      toast.error(error.message);
    },
    [form],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    if (apiKey) {
      const result = await updateApiKey({
        id: apiKey.id,
        nama_konsumen: values.nama_konsumen,
        allowed_fields: values.allowed_fields,
      });
      if (!result.ok) {
        tanganiGagal(result.error);
        return;
      }
      toast.success(`${TERMS.apiKey} "${result.data.nama_konsumen}" disimpan.`);
      onDiubah?.(result.data);
      return;
    }

    const result = await createApiKey({
      nama_konsumen: values.nama_konsumen,
      allowed_fields: values.allowed_fields,
      status: "aktif",
    });
    if (!result.ok) {
      tanganiGagal(result.error);
      return;
    }

    // Sengaja TIDAK ada toast sukses di sini: yang harus dibaca pemakainya
    // sekarang adalah dialog berisi key penuhnya, dan sebuah notifikasi yang
    // melintas di atasnya hanya mengalihkan perhatian dari satu-satunya
    // kesempatan menyalin key itu.
    onDibuat?.(result.data);
  });

  const jumlahKolom = form.watch("allowed_fields").length;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="nama_konsumen"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nama {TERMS.konsumen}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus
                  autoComplete="off"
                  placeholder="mis. Aplikasi Performance Management"
                />
              </FormControl>
              <FormDescription>
                Nama aplikasi HC yang memakai key ini. Dipakai untuk mengenali
                key-nya di daftar dan di {TERMS.revisi} — jadi tulis nama
                aplikasinya, bukan nama orangnya.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="allowed_fields"
          render={({ field }) => (
            <FormItem>
              <p className="text-pendukung font-medium leading-none">
                Kolom yang boleh diambil
              </p>
              <FormDescription>
                Hanya kolom yang tercentang yang bisa diminta key ini lewat{" "}
                <code>fields=…</code>; kolom lain dijawab 403 dan permintaannya
                tidak dijalankan sebagian pun. {TERMS.dataPribadiSensitif} tidak
                ada di daftar ini sama sekali dan tidak pernah bisa keluar lewat
                API.
              </FormDescription>
              <FieldPicker
                value={field.value}
                onChange={field.onChange}
                disabled={form.formState.isSubmitting}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {kolomTidakDikenal.length > 0 ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-pendukung"
          >
            <p className="font-medium">
              {kolomTidakDikenal.length} kolom tersimpan sudah tidak ada lagi.
            </p>
            <p className="mt-1 text-muted-foreground">
              <span className="font-mono text-mikro font-normal">
                {kolomTidakDikenal.join(", ")}
              </span>{" "}
              bukan kolom <code>v_employees_api</code> lagi, jadi tidak ada
              kotak centangnya di atas. Menyimpan form ini akan membuangnya dari
              daftar key ini.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <p className="mr-auto text-mikro font-normal text-muted-foreground">
            {jumlahKolom} kolom dipilih
          </p>
          {onBatal ? (
            <Tombol
              type="button"
              nada="sekunder"
              onClick={onBatal}
              disabled={form.formState.isSubmitting}
            >
              {UI.batal}
            </Tombol>
          ) : null}
          <Tombol type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? "Menyimpan…"
              : sedangUbah
                ? UI.simpan
                : `Buat ${TERMS.apiKey}`}
          </Tombol>
        </div>
      </form>
    </Form>
  );
}

export default ApiKeyForm;
