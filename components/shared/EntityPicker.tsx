"use client";

/**
 * EntityPicker — choose a Unit Organisasi, Jabatan or Lookup **by id**.
 *
 * FROZEN CONTRACT (Wave 1). ADR-002 is the reason this component exists and
 * the reason it works the way it does: every reference column on `employees`
 * is a uuid FK, and "form karyawan tidak bisa mengetik bebas; nilai baru harus
 * dibuat dulu di halaman referensi". So:
 *
 *   * the text box **filters** the list; it never becomes the value;
 *   * there is no "create from here" text path — `onCreateNew` opens the
 *     proper page, it does not invent a row from what was typed;
 *   * the value handed back is always an id from `options`, or `null`.
 *
 * That is what keeps "Divisi QHSSE" from acquiring a fourth spelling every
 * time someone fills in a form.
 */
import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UI } from "@/lib/i18n/terms";
import { cn } from "@/lib/utils";

/** One choosable row. `id` is what gets stored; everything else is display. */
export type EntityOption = {
  id: string;
  /** What the user reads and searches: a nama, a label, a kode + nama. */
  label: string;
  /** Second line: the kode, the induk, the tipe — whatever disambiguates. */
  keterangan?: string;
  /** Nonaktif options are shown greyed and sorted last, never hidden. */
  status?: "aktif" | "nonaktif";
  /** Indent level, for a Unit Organisasi tree flattened into a list. */
  depth?: number;
  disabled?: boolean;
};

export type EntityPickerProps = {
  options: readonly EntityOption[];
  /** The selected id, or `null`. Controlled. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Button text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing. */
  emptyMessage?: string;
  disabled?: boolean;
  /** Offer a "kosongkan" entry. Default `true`. */
  allowClear?: boolean;
  /** Opens the page where a new entity is created (ADR-002). */
  onCreateNew?: () => void;
  createNewLabel?: string;
  /** `id` of the trigger, for a `<Label htmlFor>`. */
  id?: string;
  /**
   * Renders a hidden input with this name, so the picker works inside a plain
   * `<form>` / Server Action submission as well as with react-hook-form.
   */
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Marks the trigger invalid, for a form that failed validation. */
  invalid?: boolean;
  className?: string;
};

export function EntityPicker({
  options,
  value,
  onChange,
  placeholder = "Pilih…",
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  allowClear = true,
  onCreateNew,
  createNewLabel = "Tambah baru…",
  id,
  name,
  invalid = false,
  className,
  ...aria
}: EntityPickerProps) {
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );

  const select = (optionId: string | null) => {
    onChange(optionId);
    setOpen(false);
  };

  return (
    <>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-label={aria["aria-label"]}
            aria-describedby={aria["aria-describedby"]}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              invalid && "border-destructive",
              className,
            )}
          >
            <span className="truncate">{selected ? selected.label : placeholder}</span>
            <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder ?? `${UI.cari}…`} />
            <CommandList>
              <CommandEmpty>{emptyMessage ?? UI.tidakDitemukan}</CommandEmpty>

              <CommandGroup>
                {allowClear && value !== null ? (
                  <CommandItem value="__kosongkan__" onSelect={() => select(null)}>
                    <X aria-hidden="true" className="mr-2 h-4 w-4 opacity-50" />
                    <span className="text-muted-foreground">Kosongkan pilihan</span>
                  </CommandItem>
                ) : null}

                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    // cmdk filters on this string, so it carries everything the
                    // user might type. Selection uses the closure, not the value
                    // cmdk hands back — that one is lowercased.
                    value={`${option.label} ${option.keterangan ?? ""} ${option.id}`}
                    disabled={option.disabled}
                    onSelect={() => select(option.id)}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        option.id === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span
                      className="min-w-0"
                      style={
                        option.depth ? { paddingLeft: `${option.depth * 12}px` } : undefined
                      }
                    >
                      <span
                        className={cn(
                          "block truncate",
                          option.status === "nonaktif" && "text-muted-foreground line-through",
                        )}
                      >
                        {option.label}
                      </span>
                      {option.keterangan ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.keterangan}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>

              {onCreateNew ? (
                // forceMount on both: cmdk scores every item against what was
                // typed, so without it the one control that lets the user go
                // and create the missing entity disappears exactly when their
                // search matches nothing — which is when they need it.
                <CommandGroup forceMount>
                  <CommandItem
                    forceMount
                    value="__tambah_baru__"
                    onSelect={() => {
                      setOpen(false);
                      onCreateNew();
                    }}
                  >
                    <span className="text-muted-foreground">{createNewLabel}</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Row → option mappers.
 *
 * Pure functions, so a Server Component can map rows before handing them to the
 * picker. Every one of them puts the kode in `keterangan`: two Unit Organisasi
 * really can share a nama, and the kode is the half that never changes.
 * ──────────────────────────────────────────────────────────────────────────── */

type OrgUnitLike = {
  id: string;
  kode: string;
  nama: string;
  tipe: string;
  status: string;
  depth?: number;
};

export function toOrgUnitOptions(
  rows: readonly OrgUnitLike[],
  labels?: Record<string, string>,
): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.nama,
    keterangan: `${row.kode} · ${labels?.[row.tipe] ?? row.tipe}`,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
    depth: row.depth,
  }));
}

type JabatanLike = { id: string; kode: string; nama: string; status: string };

export function toJabatanOptions(rows: readonly JabatanLike[]): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.nama,
    keterangan: row.kode,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}

type LookupLike = { id: string; kode: string; label: string; status: string };

export function toLookupOptions(rows: readonly LookupLike[]): EntityOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    keterangan: row.kode,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}

export default EntityPicker;
