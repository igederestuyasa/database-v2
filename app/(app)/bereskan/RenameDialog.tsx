"use client";

/**
 * Ganti nama satu Data Referensi tanpa meninggalkan "Perlu Dibereskan".
 *
 * PRD #12: "dari halaman tersebut admin bisa langsung merge atau rename tanpa
 * pindah halaman". Merge has `components/shared/MergeDialog.tsx`; this is the
 * other half. It is deliberately the smallest possible form — one field —
 * because the most common Temuan on this page ("DIVISI QHSSE" next to "Divisi
 * QHSSE") is often fixed by correcting the spelling rather than by merging.
 *
 * The write goes to a Server Action, which validates with the same frozen zod
 * schema the entity pages use; the schema below is the client half of that
 * check, never the only one.
 */
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/_guard";
import { TERMS, UI } from "@/lib/i18n/terms";

import { renameJabatan, renameLookup, renameOrgUnit } from "./actions";

/** Which Data Referensi is being renamed. */
export type RenameKind = "org_unit" | "jabatan" | "lookup";

export type RenameTarget = {
  kind: RenameKind;
  id: string;
  /** The current nama / label, pre-filled into the field. */
  nama: string;
  /** The kode, shown so the admin can see which of two same-named rows this is. */
  kode?: string;
};

export type RenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RenameTarget;
  /** Called after a successful rename, so the page can refresh. */
  onRenamed?: (result: { id: string; nama: string }) => void;
};

/** Per-kind wording. `lookups` stores a `label`, not a `nama` (CONTEXT.md). */
const KIND_COPY: Record<
  RenameKind,
  { entitas: string; field: string; judul: string }
> = {
  org_unit: {
    entitas: TERMS.unitOrganisasi,
    field: `Nama ${TERMS.unitOrganisasi}`,
    judul: `Ganti nama ${TERMS.unitOrganisasi}`,
  },
  jabatan: {
    entitas: TERMS.jabatan,
    field: `Nama ${TERMS.jabatan}`,
    judul: `Ganti nama ${TERMS.jabatan}`,
  },
  lookup: {
    entitas: TERMS.lookup,
    field: "Label",
    judul: `Ganti label ${TERMS.lookup}`,
  },
};

/**
 * The client half of the check.
 *
 * Deliberately a plain string schema rather than `requiredText()` from
 * `lib/validation/common.ts`: that helper wraps `z.preprocess`, whose *input*
 * type is `unknown`, which is right for a Server Action receiving a raw form
 * body and wrong for a typed field in this dialog. The authoritative check is
 * still the frozen `orgUnitRenameSchema` / `jabatanRenameSchema` /
 * `lookupRenameSchema` inside the Server Action — this one only saves a round
 * trip on an empty box.
 */
const formSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(1, { error: "Nama wajib diisi." })
    .max(255, { error: "Nama maksimal 255 karakter." }),
});
type FormValues = z.infer<typeof formSchema>;

async function submit(
  target: RenameTarget,
  nama: string,
): Promise<ActionResult<{ id: string; nama: string }>> {
  if (target.kind === "org_unit") return renameOrgUnit({ id: target.id, nama });
  if (target.kind === "jabatan") return renameJabatan({ id: target.id, nama });
  return renameLookup({ id: target.id, label: nama });
}

export function RenameDialog({
  open,
  onOpenChange,
  target,
  onRenamed,
}: RenameDialogProps) {
  const copy = KIND_COPY[target.kind];
  const [pesanGagal, setPesanGagal] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { nama: target.nama },
  });

  const { reset } = form;
  // A different Temuan can open this dialog without unmounting it; without
  // this the field would still hold the previous row's nama.
  React.useEffect(() => {
    reset({ nama: target.nama });
    setPesanGagal(null);
  }, [reset, target.id, target.nama]);

  const onSubmit = form.handleSubmit(async (values) => {
    setPesanGagal(null);
    const hasil = await submit(target, values.nama.trim());

    if (!hasil.ok) {
      // Field-level messages back onto the field; everything else in place, so
      // the admin does not lose what they typed to a toast that scrolls away.
      const fieldError = hasil.error.fieldErrors?.nama ?? hasil.error.fieldErrors?.label;
      if (fieldError) form.setError("nama", { message: fieldError });
      setPesanGagal(hasil.error.message);
      return;
    }

    toast.success(`${copy.entitas} sekarang bernama "${hasil.data.nama}".`);
    onOpenChange(false);
    onRenamed?.(hasil.data);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.judul}</DialogTitle>
          <DialogDescription>
            Nama baru langsung berlaku untuk semua {TERMS.karyawan} yang merujuk{" "}
            {copy.entitas} ini — tidak ada baris {TERMS.karyawan} yang berubah, dan
            perubahannya tercatat sebagai {TERMS.revisi} yang bisa dikembalikan.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bereskan-rename-nama">{copy.field}</Label>
            <Input
              id="bereskan-rename-nama"
              autoFocus
              aria-invalid={form.formState.errors.nama ? true : undefined}
              {...form.register("nama")}
            />
            {target.kode ? (
              <p className="text-xs text-muted-foreground">Kode: {target.kode}</p>
            ) : null}
            {form.formState.errors.nama ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.nama.message}
              </p>
            ) : null}
          </div>

          {pesanGagal && !form.formState.errors.nama ? (
            <p className="text-sm text-destructive" role="alert">
              {pesanGagal}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.formState.isSubmitting}
            >
              {UI.batal}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Menyimpan…" : UI.simpan}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default RenameDialog;
