/**
 * Semua pilihan yang dibutuhkan Form Karyawan, dibaca sekali di server.
 *
 * ADR-002: setiap kolom referensi di `employees` adalah FK uuid, dan formnya
 * **tidak pernah** mengetik bebas — Unit Organisasi, Jabatan, dan sebelas
 * kolom Lookup semuanya dipilih dari daftar lewat `EntityPicker`. Daftar itu
 * harus datang dari server, jadi tempatnya di sini.
 *
 * Kenapa modul ini duduk di folder `baru/`: dua halaman yang memakainya —
 * `/karyawan/baru` dan `/karyawan/[id]/edit` — sama-sama milik unit Form
 * Karyawan, sedangkan `app/(app)/karyawan/_components/` milik unit daftar.
 * Halaman edit mengimpornya dari sini alih-alih menyalin tiga belas pemetaan
 * yang sama.
 *
 * **Tidak ada `"use client"` di file ini, dan itu bukan kebetulan.** Ketiga
 * pemetaan `toOrgUnitOptions`/`toJabatanOptions`/`toLookupOptions` diimpor dari
 * `components/shared/entityOptions` (modul tanpa direktif), bukan dari
 * `EntityPicker.tsx` yang ber-`"use client"`: memanggil export sebuah client
 * module dari server menghasilkan referensi yang melempar saat dipanggil — dan
 * hanya di production build, tidak di `next dev`. Itu persis cara `/bereskan`
 * pernah tumbang.
 *
 * Tiga bacaan, apa pun jumlah kolomnya: satu `org_units`, satu `jabatan`, satu
 * `lookups` untuk kesebelas tipe sekaligus.
 */
import {
  toJabatanOptions,
  toLookupOptions,
  toOrgUnitOptions,
  type EntityOption,
} from "@/components/shared/entityOptions";
import { listAllJabatan } from "@/lib/db/jabatan";
import { getLookupsGroupedByType } from "@/lib/db/lookups";
import { flattenOrgUnitTree, getOrgUnitTree } from "@/lib/db/orgUnits";
import type { DbClient } from "@/lib/db/shared";
import { ORG_UNIT_TYPE_LABELS, TERMS } from "@/lib/i18n/terms";
import {
  LOOKUP_TYPES,
  LOOKUP_TYPE_LABELS,
  type LookupType,
} from "@/lib/validation/lookupTypes";

/**
 * Satu daftar yang terbaca tidak utuh.
 *
 * PostgREST memotong pada `db-max-rows` (bawaan 1000) **sebelum** `.limit()`
 * kita, dan melaporkannya sebagai sukses. Untuk sebuah picker akibatnya khas
 * dan diam: Unit Organisasi yang sebenarnya ada tidak muncul di daftar, admin
 * tidak bisa memilihnya, dan tidak ada apa pun di layar yang menjelaskan
 * kenapa. Karena itu `truncated` dari `FullRead` diteruskan ke halaman, bukan
 * ditelan di sini (lihat `FullRead` di `lib/db/shared.ts`).
 */
export type DaftarTerpotong = {
  /** Nama daftarnya, siap ditulis di layar. */
  nama: string;
  /** Berapa baris yang berhasil dibaca. */
  dibaca: number;
  /** Berapa baris yang database bilang ada. */
  total: number;
};

/**
 * Kesebelas tipe Lookup menjadi kesebelas daftar pilihan — selalu kesebelasnya.
 *
 * Murni, dan dipisah supaya bisa diuji: sebuah tipe yang hilang dari hasil di
 * sini membuat `options.lookup.<tipe>` menjadi `undefined`, dan `EntityPicker`
 * yang menerima `undefined` bukan hanya kosong — ia menjatuhkan seluruh form.
 * Tipe yang memang belum punya baris harus menjadi daftar kosong.
 */
export function petakanLookupOptions(
  byType: Partial<Record<LookupType, readonly LookupLike[]>>,
): Record<LookupType, EntityOption[]> {
  return Object.fromEntries(
    LOOKUP_TYPES.map((tipe) => [tipe, toLookupOptions(byType[tipe] ?? [])]),
  ) as Record<LookupType, EntityOption[]>;
}

/** Baris seadanya yang bisa dipetakan `toLookupOptions`. */
type LookupLike = { id: string; kode: string; label: string; status: string };

/**
 * Bacaan mana saja yang pulang tidak utuh, siap ditulis di layar.
 *
 * Murni, dan dipisah karena inilah aturannya yang gampang hilang saat kode
 * dirapikan: `truncated` tidak boleh ditelan. Sebuah daftar yang terpotong
 * membuat admin tidak bisa memilih nilai yang sebenarnya ada, tanpa satu pun
 * petunjuk kenapa.
 */
export function ringkasPemotongan(
  bacaan: readonly {
    nama: string;
    dibaca: number;
    total: number;
    truncated: boolean;
  }[],
): DaftarTerpotong[] {
  return bacaan
    .filter((satu) => satu.truncated)
    .map(({ nama, dibaca, total }) => ({ nama, dibaca, total }));
}

export type EmployeeFormOptions = {
  /** Seluruh hierarki, rata dan berindentasi. Karyawan menunjuk unit terendah. */
  orgUnit: EntityOption[];
  jabatan: EntityOption[];
  /** Satu daftar per tipe Lookup; kesebelas tipe selalu ada sebagai key. */
  lookup: Record<LookupType, EntityOption[]>;
  /** Kosong berarti semua daftar utuh. */
  terpotong: DaftarTerpotong[];
};

/**
 * Semua pilihan Form Karyawan.
 *
 * `status: "semua"` di ketiga bacaan, dan itu keputusan yang disengaja: data
 * seed masuk kotor, jadi seorang Karyawan bisa saja sekarang menunjuk Unit
 * Organisasi atau Lookup yang sudah dinonaktifkan. Kalau baris itu tidak ikut
 * dimuat, `EntityPicker` tidak menemukan id yang tersimpan dan tombolnya
 * berubah menjadi "Pilih…" — form edit akan terlihat seolah-olah kolom itu
 * memang kosong, dan menyimpannya benar-benar mengosongkannya. `EntityPicker`
 * sudah menampilkan yang nonaktif dengan tanda coret, jadi pilihannya tetap
 * jujur tanpa menyembunyikan apa pun.
 */
export async function loadEmployeeFormOptions(
  client: DbClient,
): Promise<EmployeeFormOptions> {
  const [unitRead, jabatanRead, lookupRead] = await Promise.all([
    getOrgUnitTree(client, { status: "semua", orderBy: "nama" }),
    listAllJabatan(client, { status: "semua", orderBy: "nama" }),
    getLookupsGroupedByType(client, { status: "semua" }),
  ]);

  // Rata dari pohonnya, bukan dari baris mentah: `flattenOrgUnitTree()` yang
  // memberi `depth`, dan indentasi itulah yang membuat "Bagian Umum" di bawah
  // dua Divisi berbeda bisa dibedakan di dalam daftar.
  const unitFlat = flattenOrgUnitTree(unitRead.tree);

  return {
    orgUnit: toOrgUnitOptions(unitFlat, ORG_UNIT_TYPE_LABELS),
    jabatan: toJabatanOptions(jabatanRead.rows),
    lookup: petakanLookupOptions(lookupRead.byType),
    terpotong: ringkasPemotongan([
      {
        nama: TERMS.unitOrganisasi,
        dibaca: unitRead.rows.length,
        total: unitRead.total,
        truncated: unitRead.truncated,
      },
      {
        nama: TERMS.jabatan,
        dibaca: jabatanRead.rows.length,
        total: jabatanRead.total,
        truncated: jabatanRead.truncated,
      },
      {
        // Satu bacaan untuk kesebelas tipe, jadi pemotongannya juga satu —
        // tidak ada cara memastikan tipe mana yang kehilangan barisnya.
        nama: `${TERMS.lookup} (${LOOKUP_TYPES.map((tipe) => LOOKUP_TYPE_LABELS[tipe]).join(", ")})`,
        dibaca: lookupRead.rows.length,
        total: lookupRead.total,
        truncated: lookupRead.truncated,
      },
    ]),
  };
}
