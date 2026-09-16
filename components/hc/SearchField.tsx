"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { KELAS_KOLOM_CARI, KELAS_LABEL } from "./kelas";

/**
 * Kolom cari HC Panel — kontrol utama layar (docs/DESIGN.md §Komponen).
 *
 * SATU ELEVASI PER LAYAR. Ini satu-satunya elemen yang diberi `shadow-kontrol`.
 * Kalau di layar yang sama ada elemen berbayangan lain, salah satunya salah.
 *
 * Pintasannya ikut spesifikasi §Aksesibilitas: `/` dan Ctrl/Cmd+K memberi
 * fokus, Esc mengosongkan, Panah bawah pindah ke item pertama. `/` sengaja
 * diabaikan saat kursor sedang di kolom isian lain — di sana garis miring
 * memang huruf, bukan pintasan.
 */
export type SearchFieldProps = {
  /** Label di atas kolom. Selalu terlihat, tidak pernah hanya placeholder. */
  label: string;
  nilai: string;
  onNilaiChange: (nilai: string) => void;
  placeholder?: string;
  /** Enter di kolom cari — pola daftar-detail menjalankan aksi hasil teratas. */
  onSubmit?: () => void;
  /** Panah bawah dari kolom cari: pindah ke item pertama. */
  onPanahBawah?: () => void;
  id?: string;
  "aria-describedby"?: string;
  /** Matikan kalau satu layar terpaksa punya dua kolom cari. */
  pintasanGlobal?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Kursor sedang di kolom isian lain, jadi "/" di sana memang huruf. */
function sedangMengetik(sasaran: EventTarget | null): boolean {
  if (!(sasaran instanceof HTMLElement)) return false;
  if (sasaran.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(sasaran.tagName);
}

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      label,
      nilai,
      onNilaiChange,
      placeholder,
      onSubmit,
      onPanahBawah,
      id,
      pintasanGlobal = true,
      disabled = false,
      className,
      ...aria
    },
    refLuar,
  ) {
    const idBawaan = React.useId();
    const idKolom = id ?? idBawaan;
    const refDalam = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(refLuar, () => refDalam.current as HTMLInputElement);

    React.useEffect(() => {
      if (!pintasanGlobal) return;

      const tekan = (event: KeyboardEvent) => {
        const kombinasi =
          (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
        const miring = event.key === "/" && !event.metaKey && !event.ctrlKey;
        if (!kombinasi && !miring) return;
        if (miring && sedangMengetik(event.target)) return;

        event.preventDefault();
        refDalam.current?.focus();
        refDalam.current?.select();
      };

      document.addEventListener("keydown", tekan);
      return () => document.removeEventListener("keydown", tekan);
    }, [pintasanGlobal]);

    const tekanDiKolom = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && nilai !== "") {
        event.preventDefault();
        onNilaiChange("");
        return;
      }
      if (event.key === "ArrowDown" && onPanahBawah) {
        event.preventDefault();
        onPanahBawah();
        return;
      }
      if (event.key === "Enter" && onSubmit) {
        event.preventDefault();
        onSubmit();
      }
    };

    return (
      <div className={cn("w-full", className)}>
        <label htmlFor={idKolom} className={KELAS_LABEL}>
          {label}
        </label>

        <div className="relative mt-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          />

          <input
            ref={refDalam}
            id={idKolom}
            type="search"
            value={nilai}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => onNilaiChange(event.target.value)}
            onKeyDown={tekanDiKolom}
            aria-describedby={aria["aria-describedby"]}
            autoComplete="off"
            className={KELAS_KOLOM_CARI}
          />

          {nilai !== "" ? (
            <button
              type="button"
              onClick={() => {
                onNilaiChange("");
                refDalam.current?.focus();
              }}
              disabled={disabled}
              className={cn(
                "absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
                "text-muted-foreground transition-colors duration-150 ease-standar",
                "hover:bg-accent hover:text-foreground",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
              )}
            >
              <X aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">Kosongkan pencarian</span>
            </button>
          ) : (
            // Hanya untuk perangkat berkursor: di HP tidak ada tombol "/".
            <kbd
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2",
                "rounded-sm border border-border px-1.5 py-0.5 text-mikro text-muted-foreground",
                "[@media(pointer:fine)]:block",
              )}
            >
              /
            </kbd>
          )}
        </div>
      </div>
    );
  },
);

export default SearchField;
