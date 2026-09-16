"use client";

/**
 * OrgUnitForm — tambah / ubah satu Unit Organisasi (PRD #7).
 *
 * Validated by `lib/validation/orgUnit.ts`, the same module the Server Action
 * validates with (ARCHITECTURE.md §1): one schema, two places, no second copy
 * of the rules. The resolver below is a thin adapter rather than
 * `zodResolver` because every field in those frozen schemas is wrapped in
 * `z.preprocess`, which makes `z.input` collapse to `unknown` and takes every
 * field of a react-hook-form form down with it.
 *
 * Two things the form is here to teach, neither of which the database
 * enforces:
 *
 *   * **Induk.** `parent_id` may be NULL only for a Direktorat. The column is
 *     deliberately unconstrained so dirty seed data can land and be reported
 *     as a Temuan on "Perlu Dibereskan" (ARCHITECTURE.md §3), so this form
 *     guides instead of blocking: a Direktorat cannot pick an induk at all,
 *     and anything else without one says, before you save, that it will show
 *     up as a Temuan.
 *   * **Kode.** Stable, and never changed after creation (ARCHITECTURE.md §3)
 *     — a Konsumen may already be holding it. So it is editable while adding
 *     and read-only afterwards; the "ubah" submit does not even send it.
 */
import * as React from "react";

import {
  KELAS_ISIAN,
  BidangLabel,
  BidangBantuan,
  BidangPesan,
} from "@/components/hc/Bidang";
import Tombol from "@/components/hc/Tombol";
import { cn } from "@/lib/utils";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { AlertTriangle } from "lucide-react";

import { EntityPicker, type EntityOption } from "@/components/shared/EntityPicker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  createOrgUnit,
  updateOrgUnit,
  type OrgUnitActionData,
} from "@/lib/actions/orgUnits";
import { ORG_UNIT_TYPE_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { formatZodErrors } from "@/lib/validation/common";
import {
  ORG_UNIT_TYPES,
  orgUnitFieldsSchema,
  type OrgUnitType,
} from "@/lib/validation/orgUnit";

export type OrgUnitFormValues = {
  kode: string;
  nama: string;
  tipe: OrgUnitType;
  parent_id: string | null;
};

export type OrgUnitFormProps = {
  /** `"tambah"` inserts; `"ubah"` updates `unit`. */
  mode: "tambah" | "ubah";
  /** The row being edited. Required when `mode` is `"ubah"`. */
  unit?: {
    id: string;
    kode: string;
    nama: string;
    tipe: OrgUnitType;
    parent_id: string | null;
  };
  /** Pre-selected induk, e.g. "Tambah sub unit" from a row in the tree. */
  defaultParentId?: string | null;
  /** Pre-selected tipe, e.g. one level below the row that was clicked. */
  defaultTipe?: OrgUnitType;
  /**
   * Units that may be chosen as induk — already flattened, indented and, in
   * `"ubah"` mode, stripped of the unit itself and everything below it.
   */
  parentOptions: readonly EntityOption[];
  /** Called with the saved row after a successful write. */
  onSelesai: (unit: OrgUnitActionData) => void;
  onBatal: () => void;
};

const FIELD_NAMES = ["kode", "nama", "tipe", "parent_id"] as const;
type OrgUnitFieldName = (typeof FIELD_NAMES)[number];

function isFieldName(name: string): name is OrgUnitFieldName {
  return (FIELD_NAMES as readonly string[]).includes(name);
}

/**
 * Validate the form with the shared schema, and surface per-field messages the
 * way `formatZodErrors` already does for the Server Action.
 *
 * Only `values` is handed back on success, not `parsed.data`: the parsed
 * output has been coerced (`""` → `null`, strings trimmed) and feeding that
 * back would rewrite what the user is still typing. The Server Action parses
 * the same input again and uses the coerced version for the write.
 */
const resolver: Resolver<OrgUnitFormValues> = async (values) => {
  const parsed = orgUnitFieldsSchema.safeParse(values);
  if (parsed.success) return { values, errors: {} };

  const { fieldErrors } = formatZodErrors(parsed.error);
  const errors: FieldErrors<OrgUnitFormValues> = {};
  for (const [name, message] of Object.entries(fieldErrors)) {
    if (isFieldName(name)) errors[name] = { type: "validation", message };
  }
  return { values: {}, errors };
};

export function OrgUnitForm({
  mode,
  unit,
  defaultParentId = null,
  defaultTipe,
  parentOptions,
  onSelesai,
  onBatal,
}: OrgUnitFormProps) {
  const form = useForm<OrgUnitFormValues>({
    resolver,
    defaultValues: {
      kode: unit?.kode ?? "",
      nama: unit?.nama ?? "",
      // Adding at the root almost always means a new Direktorat — the only
      // tipe that is *meant* to sit there without an induk.
      tipe: unit?.tipe ?? defaultTipe ?? (defaultParentId ? "divisi" : "direktorat"),
      parent_id: unit?.parent_id ?? defaultParentId,
    },
  });

  const tipe = form.watch("tipe");
  const parentId = form.watch("parent_id");
  const isDirektorat = tipe === "direktorat";
  const yatimPiatu = !isDirektorat && !parentId;

  // A Direktorat sits at the top of the hierarchy, so it never carries an
  // induk. Clearing it here keeps the form and the rule in step instead of
  // silently saving an induk the user can no longer see.
  React.useEffect(() => {
    if (isDirektorat && form.getValues("parent_id")) {
      form.setValue("parent_id", null, { shouldDirty: true });
    }
  }, [isDirektorat, form]);

  const submit = form.handleSubmit(async (values) => {
    const result =
      mode === "tambah"
        ? await createOrgUnit({
            kode: values.kode,
            nama: values.nama,
            tipe: values.tipe,
            parent_id: values.parent_id,
          })
        : await updateOrgUnit({
            // `kode` is stable and deliberately not sent (ARCHITECTURE.md §3).
            id: unit?.id ?? "",
            nama: values.nama,
            tipe: values.tipe,
            parent_id: values.parent_id,
          });

    if (!result.ok) {
      for (const [name, message] of Object.entries(result.error.fieldErrors ?? {})) {
        if (isFieldName(name)) form.setError(name, { type: "server", message });
      }
      toast.error(result.error.message);
      return;
    }

    toast.success(
      mode === "tambah"
        ? `${TERMS.unitOrganisasi} "${result.data.nama}" ditambahkan.`
        : `${TERMS.unitOrganisasi} "${result.data.nama}" disimpan.`,
    );
    onSelesai(result.data);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="kode"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Kode</BidangLabel>
              <FormControl>
                <Input
                  {...field}
                  readOnly={mode === "ubah"}
                  autoComplete="off"
                  placeholder="mis. DIV-QHSSE"
                  className={cn(KELAS_ISIAN, mode === "ubah" ? "bg-muted" : undefined)}
                />
              </FormControl>
              <BidangBantuan>
                {mode === "ubah"
                  ? "Kode tidak diubah setelah dibuat — Konsumen API bisa saja sudah memakainya."
                  : "Kode tetap dan unik. Nama boleh diganti kapan saja, kode tidak."}
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="nama"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Nama</BidangLabel>
              <FormControl>
                <Input className={KELAS_ISIAN} {...field} autoComplete="off" placeholder="mis. Divisi QHSSE" />
              </FormControl>
              <BidangBantuan>
                Mengganti nama di sini otomatis berlaku untuk semua {TERMS.karyawan} di
                unit ini — tidak ada baris {TERMS.karyawan} yang ikut diubah.
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tipe"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Tipe</BidangLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className={KELAS_ISIAN}>
                    <SelectValue placeholder="Pilih tipe…" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ORG_UNIT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ORG_UNIT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <BidangBantuan>
                Urutan hierarki: Direktorat → Divisi → Departemen → Bagian → Sub Bagian.
                Proyek adalah tipe unit tersendiri, letaknya di bawah Divisi.
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="parent_id"
          render={({ field }) => (
            <FormItem>
              <BidangLabel>Induk</BidangLabel>
              <FormControl>
                <EntityPicker
                  options={parentOptions}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isDirektorat}
                  placeholder={isDirektorat ? "Tidak ada (puncak hierarki)" : "Pilih induk…"}
                  searchPlaceholder="Cari nama atau kode unit…"
                  emptyMessage="Tidak ada Unit Organisasi yang cocok."
                  aria-label="Induk Unit Organisasi"
                  invalid={Boolean(form.formState.errors.parent_id)}
                />
              </FormControl>
              <BidangBantuan>
                {isDirektorat
                  ? "Direktorat berada di puncak hierarki, jadi tidak punya induk."
                  : "Induk dipilih dari daftar, tidak diketik bebas."}
              </BidangBantuan>
              <BidangPesan />
            </FormItem>
          )}
        />

        {yatimPiatu ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Unit selain Direktorat sebaiknya punya induk. Tanpa induk, unit ini akan
              muncul sebagai {TERMS.temuan} di halaman {TERMS.perluDibereskan}. Tetap
              bisa disimpan kalau memang begitu keadaannya.
            </span>
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Tombol
            type="button"
            nada="sekunder"
            onClick={onBatal}
            disabled={form.formState.isSubmitting}
          >
            {UI.batal}
          </Tombol>
          <Tombol type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Menyimpan…" : UI.simpan}
          </Tombol>
        </div>
      </form>
    </Form>
  );
}

export default OrgUnitForm;
