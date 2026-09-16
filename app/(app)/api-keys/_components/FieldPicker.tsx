"use client";

/**
 * Pemilih `allowed_fields` — inti halaman API Key (PRD #19).
 *
 * Whitelist inilah seluruh kendali akses sebuah Konsumen: route `/api/v1`
 * memakai service-role client yang melewati RLS (ADR-004), jadi kolom yang
 * tercentang di sini adalah kolom yang keluar, tanpa lapis kedua di
 * belakangnya. Maka layarnya harus membuat pilihan sempit lebih mudah
 * daripada pilihan lebar — 57 kotak centang berderet tanpa urutan yang
 * berarti hanya akan membuat orang menekan "pilih semua" supaya selesai.
 *
 * Karena itu:
 *
 *   * kolomnya dikelompokkan persis seperti API-CONTRACT.md
 *     mengelompokkannya (`lib/apiKeys/fieldGroups.ts`), dokumen yang juga
 *     dibaca pengembang Konsumen, jadi "Identitas + Posisi" di layar ini
 *     berarti hal yang sama dengan di percakapan mereka;
 *   * tiap grup punya penghitung sendiri dan tombol pilih/kosongkan grup,
 *     supaya keputusan diambil per kelompok, bukan per 57 kotak;
 *   * ada pencarian, karena yang tahu nama kolomnya biasanya sudah tahu
 *     persis kolom mana yang dicarinya;
 *   * yang tampil adalah **nama kolom apa adanya**, bukan label karangan:
 *     nama itulah yang nanti diketik Konsumen di `fields=a,b,c`, dan label
 *     yang lebih ramah tapi tidak bisa disalin justru menyesatkan.
 *
 * Yang TIDAK ada di sini adalah tombol "pilih semua kolom" yang berlaku untuk
 * seluruh grup sekaligus. Bukan karena tidak mungkin ditekan satu per satu,
 * tapi karena tombol itu membuat pemberian akses penuh lebih murah daripada
 * memikirkannya sebentar — dan halaman ini memang tempat memikirkannya.
 *
 * Data Pribadi Sensitif tidak bisa muncul di sini dalam keadaan apa pun:
 * kolomnya tidak ada di `v_employees_api`, jadi tidak ada grup yang memuatnya
 * dan tidak ada kotak centang yang bisa memberikannya (PRD #22).
 */
import * as React from "react";

import Tombol from "@/components/hc/Tombol";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  API_FIELD_GROUPS,
  TOTAL_API_FIELDS,
  countSelectedInGroup,
  sortApiFields,
} from "@/lib/apiKeys/fieldGroups";
import { UI } from "@/lib/i18n/terms";

export type FieldPickerProps = {
  /** Kolom yang sedang dipilih. */
  value: readonly string[];
  /** Dipanggil dengan daftar baru, selalu urut seperti API-CONTRACT.md. */
  onChange: (fields: string[]) => void;
  disabled?: boolean;
  /** Id elemen yang menjelaskan pemilih ini, untuk pembaca layar. */
  "aria-describedby"?: string;
};

export function FieldPicker({
  value,
  onChange,
  disabled,
  "aria-describedby": ariaDescribedBy,
}: FieldPickerProps) {
  const [cari, setCari] = React.useState("");
  // Satu awalan id per pemilih: dialog Tambah dan dialog Ubah bisa hidup
  // bersamaan di pohon yang sama, dan dua `<label for="kolom-nip">` akan
  // membuat klik pada label yang satu mencentang kotak yang lain.
  const idAwalan = React.useId();
  const pencarianId = `${idAwalan}-cari`;

  const terpilih = React.useMemo(() => new Set(value), [value]);

  const kataKunci = cari.trim().toLowerCase();
  const grupTampil = React.useMemo(() => {
    if (!kataKunci) {
      return API_FIELD_GROUPS.map((group) => ({
        group,
        fields: group.fields,
      }));
    }
    return API_FIELD_GROUPS.map((group) => ({
      group,
      fields: group.fields.filter((field) =>
        field.toLowerCase().includes(kataKunci),
      ),
    })).filter((entry) => entry.fields.length > 0);
  }, [kataKunci]);

  const ubah = React.useCallback(
    (berikutnya: Iterable<string>) => {
      onChange(sortApiFields([...berikutnya]));
    },
    [onChange],
  );

  const toggleField = React.useCallback(
    (field: string, checked: boolean) => {
      const berikutnya = new Set(terpilih);
      if (checked) berikutnya.add(field);
      else berikutnya.delete(field);
      ubah(berikutnya);
    },
    [terpilih, ubah],
  );

  /**
   * Tombol grup bekerja pada kolom yang **terlihat** saat itu.
   *
   * Kalau pencarian sedang menyaring, "Pilih semua" yang diam-diam ikut
   * mencentang kolom yang tidak ada di layar adalah persis jenis kejutan yang
   * tidak boleh ada di halaman pemberian akses.
   */
  const toggleGrup = React.useCallback(
    (fields: readonly string[], pilih: boolean) => {
      const berikutnya = new Set(terpilih);
      for (const field of fields) {
        if (pilih) berikutnya.add(field);
        else berikutnya.delete(field);
      }
      ubah(berikutnya);
    },
    [terpilih, ubah],
  );

  const jumlahTerpilih = terpilih.size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={pencarianId} className="sr-only">
          {UI.cari} nama kolom
        </Label>
        <Input
          id={pencarianId}
          value={cari}
          onChange={(event) => setCari(event.target.value)}
          /**
           * Enter di sini TIDAK mengirim form.
           *
           * Kotak ini hidup di dalam `<form>` milik `ApiKeyForm`, jadi tanpa
           * penjagaan ini Enter — refleks siapa pun setelah mengetik di kotak
           * pencarian — akan menyimpan key beserta whitelist yang baru
           * setengah dicentang. Untuk halaman yang whitelist-nya adalah
           * seluruh kendali akses Konsumen, itu bukan kejutan kecil.
           */
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder={`${UI.cari} nama kolom… (mis. divisi)`}
          className="h-9 w-full sm:w-72"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <p
          className="text-mikro font-normal text-muted-foreground sm:ml-auto"
          aria-live="polite"
        >
          {jumlahTerpilih} dari {TOTAL_API_FIELDS} kolom dipilih
        </p>
        <Tombol
          type="button"
          nada="halus"
          ukuran="ringkas"
          disabled={disabled || jumlahTerpilih === 0}
          onClick={() => ubah([])}
        >
          Kosongkan semua
        </Tombol>
      </div>

      <div
        className="max-h-80 space-y-5 overflow-y-auto rounded-md border p-3"
        aria-describedby={ariaDescribedBy}
      >
        {grupTampil.length === 0 ? (
          <p className="py-6 text-center text-pendukung text-muted-foreground">
            Tidak ada kolom yang cocok dengan &laquo;{cari}&raquo;.
          </p>
        ) : null}

        {grupTampil.map(({ group, fields }) => {
          const terpilihDiGrup = countSelectedInGroup(group, terpilih);
          const semuaTampilTerpilih = fields.every((field) =>
            terpilih.has(field),
          );
          const judulId = `${idAwalan}-${group.id}`;
          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={judulId}
              className="space-y-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span id={judulId} className="text-pendukung font-medium">
                  {group.label}
                </span>
                <span className="text-mikro font-normal text-muted-foreground">
                  {terpilihDiGrup} dari {group.fields.length} dipilih
                </span>
                <Tombol
                  type="button"
                  nada="halus"
                  ukuran="ringkas"
                  className="ml-auto h-7 px-2 text-mikro font-normal"
                  disabled={disabled}
                  onClick={() => toggleGrup(fields, !semuaTampilTerpilih)}
                >
                  {semuaTampilTerpilih ? "Kosongkan grup" : "Pilih grup"}
                  <span className="sr-only"> {group.label}</span>
                </Tombol>
              </div>

              <p className="text-mikro font-normal text-muted-foreground">
                {group.keterangan}
              </p>

              <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {fields.map((field) => {
                  const id = `${idAwalan}-kolom-${field}`;
                  return (
                    <div key={field} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={terpilih.has(field)}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          toggleField(field, checked === true)
                        }
                      />
                      <Label
                        htmlFor={id}
                        className="cursor-pointer font-mono text-mikro font-normal"
                      >
                        {field}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FieldPicker;
