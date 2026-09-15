"use client";

/**
 * Pencarian dan filter daftar Karyawan (PRD #2).
 *
 * Setiap perubahan di sini menulis URL baru — bukan state lokal — lalu
 * `page.tsx` yang mengambil datanya lagi. Itu yang membuat sebuah daftar
 * tersaring bisa ditautkan ke rekan, di-bookmark, dan bertahan setelah halaman
 * dimuat ulang; sekaligus alasan pencarian dilakukan di query, bukan di tabel:
 * yang dicari adalah ±1.500 Karyawan, bukan 50 baris yang kebetulan terlihat.
 *
 * Isi kotak pencarian dipegang `KaryawanClient`, bukan komponen ini: setiap
 * perpindahan — ganti filter, ganti urutan, pindah halaman — harus membawanya,
 * supaya isi kotak dan isi tabel tidak pernah menceritakan dua hal yang
 * berbeda. Yang dilakukan tombol Cari hanyalah mengirimkannya tanpa mengubah
 * filter lain.
 */
import * as React from "react";

import { EntityPicker } from "@/components/shared/EntityPicker";
import type { EntityOption } from "@/components/shared/entityOptions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  TANPA,
  ubahFilter,
  type IdFilter,
  type KaryawanFilters,
} from "./karyawanFilters";

export type KaryawanFilterBarProps = {
  filters: KaryawanFilters;
  unitOptions: readonly EntityOption[];
  jabatanOptions: readonly EntityOption[];
  lookupOptions: Readonly<Record<LookupType, readonly EntityOption[]>>;
  /** Isi kotak pencarian yang belum tentu sudah ada di URL. */
  teks: string;
  setTeks: (teks: string) => void;
  /**
   * Navigasi ke filter berikutnya; dipegang `KaryawanClient`, yang menyisipkan
   * `q` dari kotak pencarian ke setiap perpindahan.
   */
  pindah: (filters: KaryawanFilters) => void;
  /** Kosongkan semua filter sekaligus, termasuk kotak pencarian. */
  bersihkan: () => void;
  /** Navigasi sedang berjalan — kontrol dikunci supaya tidak saling menimpa. */
  pending: boolean;
};

/**
 * `IdFilter` (tiga keadaan) ↔ nilai `EntityPicker` (dua keadaan).
 *
 * "Belum difilter" dan "justru yang kosong" adalah dua hal berbeda, dan yang
 * kedua tidak bisa diungkapkan oleh sebuah id — itulah gunanya satu opsi
 * tambahan ber-id `tanpa` di puncak daftar.
 */
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

export function KaryawanFilterBar({
  filters,
  unitOptions,
  jabatanOptions,
  lookupOptions,
  teks,
  setTeks,
  pindah,
  bersihkan,
  pending,
}: KaryawanFilterBarProps) {
  const jumlahLookup = hitungFilterLookup(filters);
  const jumlahFilter = hitungFilterAktif(filters);
  const [lookupTerbuka, setLookupTerbuka] = React.useState(jumlahLookup > 0);

  // Mengirim kotak pencarian tanpa mengubah filter lain; `pindah` yang
  // menyisipkan teksnya, jadi di sini cukup "muat ulang dengan filter yang
  // sama, dari halaman pertama".
  const kirimPencarian = (event: React.FormEvent) => {
    event.preventDefault();
    pindah(ubahFilter(filters, {}));
  };

  const unitTerpilih = typeof filters.unitId === "string";

  return (
    <section
      aria-label={`${UI.filter} ${TERMS.karyawan}`}
      aria-busy={pending}
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={kirimPencarian} className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cari-karyawan" className="text-xs text-muted-foreground">
              {UI.cari} {TERMS.karyawan}
            </Label>
            <Input
              id="cari-karyawan"
              type="search"
              value={teks}
              onChange={(event) => setTeks(event.target.value)}
              placeholder={`Nama, ${TERMS.nip}, atau ${TERMS.personnelNumber}`}
              className="h-9 w-64"
            />
          </div>
          <Button type="submit" variant="secondary" className="h-9" disabled={pending}>
            {UI.cari}
          </Button>
        </form>

        <div className="flex min-w-[15rem] flex-1 flex-col gap-1">
          <Label htmlFor="filter-unit" className="text-xs text-muted-foreground">
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
              pindah(
                ubahFilter(filters, { unitId: dariNilaiPicker(id) }),
              )
            }
            disabled={pending}
            placeholder={`Semua ${TERMS.unitOrganisasi}`}
            searchPlaceholder="Cari nama atau kode unit…"
            className="h-9"
          />
        </div>

        <div className="flex min-w-[13rem] flex-1 flex-col gap-1">
          <Label htmlFor="filter-jabatan" className="text-xs text-muted-foreground">
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
              pindah(
                ubahFilter(filters, { jabatanId: dariNilaiPicker(id) }),
              )
            }
            disabled={pending}
            placeholder={`Semua ${TERMS.jabatan}`}
            searchPlaceholder={`Cari nama atau kode ${TERMS.jabatan}…`}
            className="h-9"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
            {TERMS.statusKaryawan}
          </Label>
          <Select
            value={filters.status}
            onValueChange={(nilai) =>
              pindah(
                ubahFilter(filters, {
                  status: nilai as KaryawanFilters["status"],
                }),
              )
            }
            disabled={pending}
          >
            <SelectTrigger id="filter-status" className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((nilai) => (
                <SelectItem key={nilai} value={nilai}>
                  {STATUS_FILTER_LABELS[nilai]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              pindah(
                ubahFilter(filters, { includeChildren: checked === true }),
              )
            }
          />
          <Label htmlFor="filter-sub" className="text-sm font-normal">
            Termasuk {TERMS.unitOrganisasi} di bawahnya
          </Label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={lookupTerbuka}
          aria-controls="filter-lookup"
          onClick={() => setLookupTerbuka((terbuka) => !terbuka)}
        >
          {lookupTerbuka ? "Sembunyikan" : "Tampilkan"} filter {TERMS.lookup}
          {jumlahLookup > 0 ? ` (${jumlahLookup} aktif)` : ""}
        </Button>

        {jumlahFilter > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={bersihkan}
          >
            Bersihkan {jumlahFilter} filter
          </Button>
        ) : null}

        {pending ? (
          <span className="text-xs text-muted-foreground">{UI.sedangMemuat}</span>
        ) : null}
      </div>

      {/*
        Disembunyikan lewat kelas, BUKAN atribut `hidden`. Tailwind menaruh
        `[hidden] { display: none }` di layer `base` dan `.grid { display:
        grid }` di layer `utilities` dengan kekhususan yang sama, jadi utility
        yang menang: `hidden` di elemen ber-`grid` tidak menyembunyikan apa pun.
      */}
      <div
        id="filter-lookup"
        className={cn(
          lookupTerbuka ? "grid" : "hidden",
          "gap-3 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {LOOKUP_TYPES.map((tipe) => (
          <div key={tipe} className="flex flex-col gap-1">
            <Label htmlFor={`filter-${tipe}`} className="text-xs text-muted-foreground">
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
              className="h-9"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export default KaryawanFilterBar;
