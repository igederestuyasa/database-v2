"use client";

/**
 * LookupForm — tambah / ubah satu Lookup (PRD #9).
 *
 * Lives inside the dialog on `/master-data`, one form per `tipe`.
 *
 * Three things worth knowing before changing it:
 *
 *  * **`tipe` is decided by the tab, not by the form.** The FK column on
 *    `employees` is chosen by tipe (`job_grade` → `job_grade_id`), so a Lookup
 *    that changed tipe would point its Karyawan at the wrong kind of value.
 *    `lookupUpdateSchema` omits the field; moving a value between tipe is a
 *    Merge, not an edit (ADR-002, PRD #10).
 *  * **One schema, both sides.** `lookupCreateSchema` validates here and the
 *    Server Action validates again with the same building blocks
 *    (ARCHITECTURE.md §1) — the client check is for the user, never for the
 *    database.
 *  * **The inputs are strings.** `lookupCreateSchema` preprocesses `""` → null
 *    and `"12"` → 12, which is exactly what an HTML form sends, so the raw
 *    field values go into `safeParse` untouched.
 */
import * as React from "react";

import {
  KELAS_ISIAN,
  BidangLabel,
  BidangBantuan,
  BidangPesan,
} from "@/components/hc/Bidang";
import Tombol from "@/components/hc/Tombol";
import { useForm } from "react-hook-form";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createLookup, updateLookup, type LookupSummary } from "@/lib/actions/lookups";
import { UI } from "@/lib/i18n/terms";
import { formatZodErrors } from "@/lib/validation/common";
import { lookupCreateSchema } from "@/lib/validation/lookup";
import { LOOKUP_TYPE_LABELS, type LookupType } from "@/lib/validation/lookupTypes";

/** The row being edited, or `null`/absent to create a new one. */
export type LookupFormValue = {
  id: string;
  kode: string;
  label: string;
  urutan: number | null;
};

export type LookupFormProps = {
  /** Decided by the active tab; never editable here. */
  tipe: LookupType;
  /** Omit or pass `null` to add a new Lookup. */
  lookup?: LookupFormValue | null;
  /** Called with the saved row after the Server Action succeeds. */
  onSaved: (lookup: LookupSummary) => void;
  onCancel?: () => void;
};

/** What the three inputs hold — plain strings, as an HTML form sends them. */
type FormValues = {
  kode: string;
  label: string;
  urutan: string;
};

/** Which zod path belongs to which input, so `setError` can aim at one. */
const FIELD_NAMES: readonly (keyof FormValues)[] = ["kode", "label", "urutan"];

function isFieldName(path: string): path is keyof FormValues {
  return (FIELD_NAMES as readonly string[]).includes(path);
}

export function LookupForm({ tipe, lookup, onSaved, onCancel }: LookupFormProps) {
  const isEdit = Boolean(lookup);
  const [pesanGagal, setPesanGagal] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      kode: lookup?.kode ?? "",
      label: lookup?.label ?? "",
      urutan: lookup?.urutan === null || lookup?.urutan === undefined ? "" : String(lookup.urutan),
    },
  });

  /** Put a `{ path: pesan }` map from zod or from the action onto the inputs. */
  const terapkanFieldErrors = (fieldErrors: Record<string, string>): boolean => {
    let adaYangNempel = false;
    for (const [path, message] of Object.entries(fieldErrors)) {
      if (isFieldName(path)) {
        form.setError(path, { type: "server", message });
        adaYangNempel = true;
      }
    }
    return adaYangNempel;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setPesanGagal(null);
    form.clearErrors();

    // The same schema the Server Action uses. `tipe` comes from the tab, not
    // from an input, so it is added here rather than registered as a field.
    const parsed = lookupCreateSchema.safeParse({
      tipe,
      kode: values.kode,
      label: values.label,
      urutan: values.urutan,
      status: "aktif",
    });
    if (!parsed.success) {
      const { fieldErrors, messages } = formatZodErrors(parsed.error);
      if (!terapkanFieldErrors(fieldErrors)) {
        setPesanGagal(messages[0] ?? "Data yang diisi tidak valid.");
      }
      return;
    }

    const result = lookup
      ? await updateLookup({
          id: lookup.id,
          kode: parsed.data.kode,
          label: parsed.data.label,
          urutan: parsed.data.urutan,
        })
      : await createLookup(parsed.data);

    if (!result.ok) {
      const nempel = result.error.fieldErrors
        ? terapkanFieldErrors(result.error.fieldErrors)
        : false;
      if (!nempel) setPesanGagal(result.error.message);
      return;
    }

    onSaved(result.data);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Tipe daftar: </span>
          <span className="font-medium">{LOOKUP_TYPE_LABELS[tipe]}</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Tipe ditentukan tab yang sedang dibuka dan tidak bisa diubah di sini.
            Memindahkan satu nilai ke tipe lain dilakukan lewat Merge.
          </p>
        </div>

        <FormField
          control={form.control}
          name="kode"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Kode</BidangLabel>
              <FormControl>
                <Input className={KELAS_ISIAN} {...field} autoComplete="off" placeholder="mis. JG-13" />
              </FormControl>
              <BidangBantuan>
                Kode adalah bagian yang tetap dan dipakai Konsumen lewat API —
                ganti hanya kalau memang salah ketik. Harus unik di dalam tipe ini.
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Label</BidangLabel>
              <FormControl>
                <Input className={KELAS_ISIAN} {...field} autoComplete="off" placeholder="mis. Pratama III - 13" />
              </FormControl>
              <BidangBantuan>
                Tulisan yang dibaca staf HC di dropdown. Menggantinya langsung
                berlaku untuk semua Karyawan yang memakai Lookup ini — tidak ada
                data Karyawan yang ikut diubah.
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="urutan"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Urutan</BidangLabel>
              <FormControl>
                <Input className={KELAS_ISIAN}
                  {...field}
                  // Deliberately `text`: `<input type="number">` hands back an
                  // empty string for content it cannot parse ("1e", "--"),
                  // which is exactly what "kosongkan" looks like — so a typo
                  // would silently clear the urutan. As text, the raw value
                  // reaches `urutanSchema` and is refused with a message.
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="kosongkan kalau tidak diatur"
                />
              </FormControl>
              <BidangBantuan>
                Angka kecil tampil lebih dulu. Yang dikosongkan tampil paling
                bawah, diurutkan menurut Label.
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        {pesanGagal ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {pesanGagal}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel ? (
            <Tombol
              type="button"
              nada="sekunder"
              onClick={onCancel}
              disabled={form.formState.isSubmitting}
            >
              {UI.batal}
            </Tombol>
          ) : null}
          <Tombol type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Menyimpan…" : isEdit ? UI.simpan : UI.tambah}
          </Tombol>
        </div>
      </form>
    </Form>
  );
}

export default LookupForm;
