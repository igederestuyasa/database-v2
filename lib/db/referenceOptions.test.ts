/**
 * Bagian murni dari pembacaan pilihan Data Referensi.
 *
 * Dua hal yang diuji, dan keduanya gagal dalam diam kalau salah:
 *
 *   * kesebelas tipe Lookup harus selalu punya daftarnya — `undefined` yang
 *     masuk ke `EntityPicker` menjatuhkan seluruh form, bukan sekadar satu
 *     dropdown;
 *   * bacaan yang pulang terpotong harus dilaporkan, bukan ditelan: daftar
 *     yang pendek diam-diam membuat admin tidak bisa memilih nilai yang
 *     sebenarnya ada.
 */
import { describe, expect, it } from "vitest";

import { LOOKUPS } from "@/fixtures";
import { LOOKUP_TYPES } from "@/lib/validation/lookupTypes";

import { petakanLookupOptions, ringkasPemotongan } from "./referenceOptions";

describe("petakanLookupOptions", () => {
  it("selalu memuat kesebelas tipe, meski kosong", () => {
    const hasil = petakanLookupOptions({});
    expect(Object.keys(hasil).sort()).toEqual([...LOOKUP_TYPES].sort());
    for (const tipe of LOOKUP_TYPES) expect(hasil[tipe]).toEqual([]);
  });

  it("memetakan baris menjadi opsi berlabel dan berkode", () => {
    const gender = LOOKUPS.filter((row) => row.tipe === "gender");
    expect(gender.length).toBeGreaterThan(0);

    const hasil = petakanLookupOptions({ gender });
    expect(hasil.gender).toHaveLength(gender.length);
    expect(hasil.gender[0]).toMatchObject({
      id: gender[0].id,
      label: gender[0].label,
      keterangan: gender[0].kode,
    });
    // Tipe lain tetap ada sebagai daftar kosong, bukan undefined.
    expect(hasil.job_grade).toEqual([]);
  });

  it("menandai baris nonaktif, bukan membuangnya", () => {
    const hasil = petakanLookupOptions({
      gender: [
        { id: "a", kode: "K1", label: "Aktif", status: "aktif" },
        { id: "b", kode: "K2", label: "Nonaktif", status: "nonaktif" },
      ],
    });
    expect(hasil.gender).toHaveLength(2);
    expect(hasil.gender[1].status).toBe("nonaktif");
  });
});

describe("ringkasPemotongan", () => {
  const utuh = { nama: "Jabatan", dibaca: 12, total: 12, truncated: false };
  const pendek = { nama: "Unit Organisasi", dibaca: 1000, total: 1240, truncated: true };

  it("diam ketika semua bacaan utuh", () => {
    expect(ringkasPemotongan([utuh])).toEqual([]);
  });

  it("melaporkan bacaan yang pendek beserta angkanya", () => {
    expect(ringkasPemotongan([utuh, pendek])).toEqual([
      { nama: "Unit Organisasi", dibaca: 1000, total: 1240 },
    ]);
  });

  it("melaporkan setiap daftar yang terpotong, bukan hanya yang pertama", () => {
    const lain = { nama: "Lookup", dibaca: 1000, total: 1001, truncated: true };
    expect(ringkasPemotongan([pendek, utuh, lain]).map((satu) => satu.nama)).toEqual([
      "Unit Organisasi",
      "Lookup",
    ]);
  });
});
