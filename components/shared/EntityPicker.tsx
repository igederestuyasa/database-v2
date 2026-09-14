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

import type { EntityOption } from "./entityOptions";

/**
 * The frozen surface, unchanged: `EntityOption` and the three mappers are still
 * importable from this module, because other units already import them here.
 *
 * They are DEFINED in `./entityOptions.ts`, which carries no `"use client"`, so
 * that a Server Component can actually call them — importing a client module's
 * export from the server yields a reference that throws when called, which is
 * what used to break `/bereskan` the moment it found a Temuan. Server code must
 * import from `./entityOptions` directly: re-exported here, they are client
 * references again.
 */
export type { EntityOption };
export {
  toJabatanOptions,
  toLookupOptions,
  toOrgUnitOptions,
} from "./entityOptions";

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

export default EntityPicker;
