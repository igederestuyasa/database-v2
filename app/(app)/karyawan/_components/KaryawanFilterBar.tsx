"use client";

import * as React from "react";

import { EntityPicker } from "@/components/shared/EntityPicker";
import Tombol from "@/components/hc/Tombol";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { EntityOption } from "@/lib/entityOptions";
import { TERMS, UI } from "@/lib/i18n/terms";
import { cn } from "@/lib/utils";
import {
  LOOKUP_TYPES,
  LOOKUP_TYPE_LABELS,
  type LookupType,
} from "@/lib/validation/lookupTypes";

import {
  hitungFilterAktif,
  hitungFilterLookup,
  TANPA,
  ubahFilter,
  type IdFilter,
  type KaryawanFilters,
} from "./karyawanFilters";

/**
 * Filter lanjutan Karyawan.
 *
 * Pencarian dan status TIDAK lagi di sini: pencarian naik jadi kontrol utama di
 * pembuka layar dan status jadi tab filter (docs/DESIGN.md). Yang tersisa di
 * bar ini adalah saringan yang memang butuh daftar pilihan — Unit Organisasi,
 * Jabatan, dan sebelas tipe Lookup.
 */
export type KaryawanFilterBarProps = {
  filters: KaryawanFilters;
  unitOptions: readonly EntityOption[];
  jabatanOptions: readonly EntityOption[];
  lookupOptions: Readonly<Record<LookupType, readonly EntityOption[]>>;
  pindah: (filters: KaryawanFilters) => void;
  bersihkan: () => void;
  pending: boolean;
};

function keNilaiPicker(value: IdFilter): string | null {
  if (value === undefined) return null;
  return value === null ? TANPA : value;
}

function dariNilaiPicker(value: string | null): IdFilter {
  if (value === null) return undefined;
  return value === TANPA ? null : value;
}

function denganOpsiTanpa(
  options: readonly EntityOption[],
  label: string,
  keterangan: string,
): EntityOption[] {
  return [{ id: TANPA, label, keterangan }, ...options];
}

/** Tinggi bidang isian HC Panel, ditempelkan ke pemicu picker. */
const KELAS_PICKER = "h-11 rounded-bidang text-isi font-normal";

export function KaryawanFilterBar({
  filters,
  unitOptions,
  jabatanOptions,
  lookupOptions,
  pindah,
  bersihkan,
  pending,
}: KaryawanFilterBarProps) {
  const jumlahLookup = hitungFilterLookup(filters);
  const jumlahFilter = hitungFilterAktif(filters);
  const [lookupTerbuka, setLookupTerbuka] = React.useState(jumlahLookup > 0);
  const unitTerpilih = typeof filters.unitId === "string";

  return (
    <section
      aria-label={`${UI.filter} ${TERMS.karyawan}`}
      aria-busy={pending}
      className="hc-permukaan space-y-4 rounded-kartu border border-border bg-card p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="filter-unit" className="text-label">
            {TERMS.unitOrganisasi}
          </Label>
          <EntityPicker
            id="filter-unit"
            options={denganOpsiTanpa(
              unitOptions,
              `Tanpa ${TERMS.unitOrganisasi}`,
              `${TERMS.karyawan} yang belum ditempatkan`,
            )}
            value={keNilaiPicker(filters.unitId)}
            onChange={(id) =>
              pindah(ubahFilter(filters, { unitId: dariNilaiPicker(id) }))
            }
            disabled={pending}
            placeholder={`Semua ${TERMS.unitOrganisasi}`}
            searchPlaceholder="Cari nama atau kode unit…"
            className={KELAS_PICKER}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="filter-jabatan" className="text-label">
            {TERMS.jabatan}
          </Label>
          <EntityPicker
            id="filter-jabatan"
            options={denganOpsiTanpa(
              jabatanOptions,
              `Tanpa ${TERMS.jabatan}`,
              `${TERMS.karyawan} yang belum punya ${TERMS.jabatan}`,
            )}
            value={keNilaiPicker(filters.jabatanId)}
            onChange={(id) =>
              pindah(ubahFilter(filters, { jabatanId: dariNilaiPicker(id) }))
            }
            disabled={pending}
            placeholder={`Semua ${TERMS.jabatan}`}
            searchPlaceholder={`Cari nama atau kode ${TERMS.jabatan}…`}
            className={KELAS_PICKER}
          />
        </div>
      </div>

      {/*
        Hanya masuk akal kalau ada unit yang dipilih: "Tanpa Unit Organisasi"
        tidak punya anak. Defaultnya menyertakan seluruh cabang — orang yang
        memfilter sebuah Direktorat memaksudkan semua orang di bawahnya.
      */}
      {unitTerpilih ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-sub"
            checked={filters.includeChildren}
            disabled={pending}
            onCheckedChange={(checked) =>
              pindah(ubahFilter(filters, { includeChildren: checked === true }))
            }
          />
          <Label htmlFor="filter-sub" className="text-pendukung font-normal">
            Termasuk {TERMS.unitOrganisasi} di bawahnya
          </Label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Tombol
          nada="sekunder"
          ukuran="ringkas"
          aria-expanded={lookupTerbuka}
          aria-controls="filter-lookup"
          onClick={() => setLookupTerbuka((terbuka) => !terbuka)}
        >
          {lookupTerbuka ? "Sembunyikan" : "Tampilkan"} filter {TERMS.lookup}
          {jumlahLookup > 0 ? ` (${jumlahLookup} aktif)` : ""}
        </Tombol>

        {jumlahFilter > 0 ? (
          <Tombol nada="halus" ukuran="ringkas" disabled={pending} onClick={bersihkan}>
            Bersihkan {jumlahFilter} filter
          </Tombol>
        ) : null}

        {pending ? (
          <span role="status" className="text-mikro font-normal text-muted-foreground">
            {UI.sedangMemuat}
          </span>
        ) : null}
      </div>

      {/*
        Disembunyikan lewat kelas, BUKAN atribut `hidden`. Tailwind menaruh
        `[hidden] { display: none }` di layer `base` dan `.grid { display: grid }`
        di layer `utilities` dengan kekhususan yang sama, jadi utility yang
        menang: `hidden` di elemen ber-`grid` tidak menyembunyikan apa pun.
      */}
      <div
        id="filter-lookup"
        className={cn(
          lookupTerbuka ? "grid" : "hidden",
          "gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {LOOKUP_TYPES.map((tipe) => (
          <div key={tipe} className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={`filter-${tipe}`} className="text-label">
              {LOOKUP_TYPE_LABELS[tipe]}
            </Label>
            <EntityPicker
              id={`filter-${tipe}`}
              options={denganOpsiTanpa(
                lookupOptions[tipe],
                `Tanpa ${LOOKUP_TYPE_LABELS[tipe]}`,
                "Belum diisi",
              )}
              value={keNilaiPicker(filters.lookups[tipe])}
              onChange={(id) =>
                pindah(
                  ubahFilter(filters, {
                    lookups: { ...filters.lookups, [tipe]: dariNilaiPicker(id) },
                  }),
                )
              }
              disabled={pending}
              placeholder="Semua"
              searchPlaceholder={`Cari ${LOOKUP_TYPE_LABELS[tipe]}…`}
              className={KELAS_PICKER}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default KaryawanFilterBar;
