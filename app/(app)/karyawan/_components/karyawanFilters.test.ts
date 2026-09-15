/**
 * The `/karyawan?…` contract, pinned.
 *
 * WHY THIS FILE IS HERE AND NOT UNDER `tests/`. It tests the two modules next
 * to it, so it lives next to them — the same reasoning that put
 * `revisionDiff.test.ts` inside `components/` (see `vitest.config.ts`). Neither
 * module touches React, the database or `next/navigation`: one reads a query
 * string and writes one back, the other maps a `v_employees` row to the seven
 * fields the table draws. Pure, and exactly the kind of logic that is cheap to
 * test and expensive to get quietly wrong — a dropped filter does not throw,
 * it silently hides Karyawan from the person searching for them.
 *
 * NOT COLLECTED BY THE DEFAULT CONFIG YET — said out loud here so that nobody
 * reads a green `npm test` as proof that these cases were covered.
 * `vitest.config.ts` collects `lib`, `components`, `scripts` and `tests`, but
 * not `app`, and that config is deliberately left alone while sibling units are
 * in flight. A follow-up unit widens it; from then on this file runs in CI with
 * everything else, unchanged.
 *
 * Until then it has to be asked for. Vitest 3 has no `--include` flag, and a
 * positional filter only narrows what the config already collects, so running
 * it takes a throwaway config — the command is under this comment.
 *
 * Data in here is invented. Never put real Karyawan data in a fixture.
 */
// Run it before the config is widened, from the repository root:
//
//   cat > /tmp/vitest.app.ts <<'EOF'
//   const root = process.cwd();
//   export default {
//     root,
//     resolve: { alias: { "@": root } },
//     test: { environment: "node", include: ["app/**/*.test.ts"] },
//   };
//   EOF
//   npx vitest run --config /tmp/vitest.app.ts
import { describe, expect, it } from "vitest";

import type { VEmployee } from "@/lib/types/db";

import {
  bersihkanFilter,
  DEFAULT_SORT,
  FILTER_KOSONG,
  hitungFilterAktif,
  hitungFilterLookup,
  KARYAWAN_PER_PAGE,
  karyawanHref,
  parseKaryawanFilters,
  SORT_OPTIONS,
  sortOption,
  TANPA,
  ubahFilter,
  type KaryawanFilters,
} from "./karyawanFilters";
import { toKaryawanRow, toKaryawanRows } from "./karyawanRows";

const UNIT = "11111111-2222-3333-4444-555555555555";
const JABATAN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const JOB_GRADE = "99999999-8888-7777-6666-555555555555";

/** `searchParams` as Next hands them over, from an href this module produced. */
function bacaHref(href: string): KaryawanFilters {
  const url = new URL(href, "https://hc-core.test");
  return parseKaryawanFilters(Object.fromEntries(url.searchParams));
}

describe("parseKaryawanFilters", () => {
  it("URL kosong berarti daftar aktif, halaman 1, urutan bawaan", () => {
    expect(parseKaryawanFilters({})).toEqual(FILTER_KOSONG);
    expect(FILTER_KOSONG.status).toBe("aktif");
    expect(FILTER_KOSONG.sort).toBe(DEFAULT_SORT);
    expect(FILTER_KOSONG.includeChildren).toBe(true);
  });

  it("membuang nilai yang tidak masuk akal, bukan meneruskannya ke query", () => {
    // Semuanya pernah bisa sampai ke PostgREST sebagai uuid rusak atau kolom
    // karangan. Yang salah diperlakukan sebagai "tidak ada filter".
    const filters = parseKaryawanFilters({
      unit: "bukan-uuid",
      jabatan: "'; drop table employees; --",
      job_grade: "12345",
      status: "apa-saja",
      urut: "tidak-ada",
      page: "-4",
    });

    expect(filters.unitId).toBeUndefined();
    expect(filters.jabatanId).toBeUndefined();
    expect(filters.lookups).toEqual({});
    expect(filters.status).toBe("aktif");
    expect(filters.sort).toBe(DEFAULT_SORT);
    expect(filters.page).toBe(1);
    expect(karyawanHref(filters)).toBe("/karyawan");
  });

  it("mengabaikan tipe Lookup yang tidak dikenal", () => {
    const filters = parseKaryawanFilters({ warna_favorit: UNIT });
    expect(filters.lookups).toEqual({});
    expect(karyawanHref(filters)).toBe("/karyawan");
  });

  it("`?unit=a&unit=b` memakai yang pertama, bukan menggabungkannya", () => {
    expect(parseKaryawanFilters({ unit: [UNIT, JABATAN] }).unitId).toBe(UNIT);
  });

  it("`tanpa` adalah satu-satunya cara meminta yang kolomnya kosong", () => {
    const filters = parseKaryawanFilters({
      unit: TANPA,
      jabatan: TANPA,
      gender: TANPA,
    });

    // null (justru yang kosong) ≠ undefined (tidak difilter) — dua hal berbeda
    // yang tidak bisa diwakili sebuah id.
    expect(filters.unitId).toBeNull();
    expect(filters.jabatanId).toBeNull();
    expect(filters.lookups.gender).toBeNull();
    expect(hitungFilterAktif(filters)).toBe(3);
  });

  it("memangkas spasi pencarian, dan spasi saja berarti tidak mencari", () => {
    expect(parseKaryawanFilters({ q: "  budi  " }).q).toBe("budi");
    expect(parseKaryawanFilters({ q: "   " }).q).toBeNull();
  });

  it("cabang unit ikut kecuali diminta tidak", () => {
    expect(parseKaryawanFilters({ unit: UNIT }).includeChildren).toBe(true);
    expect(parseKaryawanFilters({ unit: UNIT, sub: "0" }).includeChildren).toBe(
      false,
    );
  });
});

describe("karyawanHref", () => {
  it("bolak-balik tanpa kehilangan apa pun", () => {
    const penuh: KaryawanFilters = {
      q: "budi",
      status: "semua",
      unitId: UNIT,
      includeChildren: false,
      jabatanId: JABATAN,
      lookups: { job_grade: JOB_GRADE, gender: null },
      sort: "diubah",
      page: 3,
    };

    const href = karyawanHref(penuh);
    expect(bacaHref(href)).toEqual(penuh);
    // Idempoten: menautkan ulang hasil bacaan tidak mengubah alamatnya.
    expect(karyawanHref(bacaHref(href))).toBe(href);
    expect(hitungFilterAktif(penuh)).toBe(6);
    expect(hitungFilterLookup(penuh)).toBe(2);
  });

  it("tidak menuliskan nilai bawaan", () => {
    expect(karyawanHref(FILTER_KOSONG)).toBe("/karyawan");
    expect(karyawanHref({ ...FILTER_KOSONG, q: "budi" })).toBe("/karyawan?q=budi");
    // Halaman pertama tidak pernah membawa `page=1`, supaya alamat yang
    // dibagikan tetap sependek mungkin.
    expect(karyawanHref({ ...FILTER_KOSONG, page: 1 })).toBe("/karyawan");
    expect(karyawanHref({ ...FILTER_KOSONG, sort: DEFAULT_SORT })).toBe("/karyawan");
  });

  it("`sub=0` hanya ikut bersama unit sungguhan", () => {
    expect(karyawanHref({ ...FILTER_KOSONG, unitId: UNIT })).toBe(
      `/karyawan?unit=${UNIT}`,
    );
    expect(
      karyawanHref({ ...FILTER_KOSONG, unitId: UNIT, includeChildren: false }),
    ).toBe(`/karyawan?unit=${UNIT}&sub=0`);
    // "Tanpa Unit Organisasi" tidak punya anak, jadi `sub` tidak punya arti.
    expect(
      karyawanHref({ ...FILTER_KOSONG, unitId: null, includeChildren: false }),
    ).toBe("/karyawan?unit=tanpa");
    expect(karyawanHref({ ...FILTER_KOSONG, includeChildren: false })).toBe(
      "/karyawan",
    );
  });

  it("melewatkan tipe Lookup yang tidak difilter", () => {
    const filters: KaryawanFilters = {
      ...FILTER_KOSONG,
      lookups: { job_grade: JOB_GRADE, person_grade: undefined },
    };
    expect(karyawanHref(filters)).toBe(`/karyawan?job_grade=${JOB_GRADE}`);
    expect(hitungFilterLookup(filters)).toBe(1);
  });
});

describe("ubahFilter", () => {
  const penuh: KaryawanFilters = {
    ...FILTER_KOSONG,
    q: "budi",
    unitId: UNIT,
    sort: "diubah",
    page: 8,
  };

  it("mengganti filter mengembalikan ke halaman 1", () => {
    // Bertahan di halaman 8 setelah 1.500 Karyawan disaring jadi 12 hanya
    // menampilkan tabel kosong yang terbaca seperti "tidak ada yang cocok".
    expect(ubahFilter(penuh, { status: "semua" }).page).toBe(1);
    expect(ubahFilter(penuh, { jabatanId: JABATAN }).page).toBe(1);
  });

  it("berpindah halaman mempertahankan halamannya", () => {
    expect(ubahFilter(penuh, { page: 7 }).page).toBe(7);
  });

  it("tidak mengubah objek aslinya", () => {
    ubahFilter(penuh, { status: "semua" });
    expect(penuh.status).toBe("aktif");
    expect(penuh.page).toBe(8);
  });
});

describe("bersihkanFilter", () => {
  it("membuang semua filter tapi mempertahankan urutan yang dipilih", () => {
    const filters: KaryawanFilters = {
      q: "budi",
      status: "nonaktif",
      unitId: UNIT,
      includeChildren: false,
      jabatanId: null,
      lookups: { job_grade: JOB_GRADE },
      sort: "diubah",
      page: 4,
    };

    const bersih = bersihkanFilter(filters);

    expect(hitungFilterAktif(bersih)).toBe(0);
    expect(bersih).toEqual({ ...FILTER_KOSONG, sort: "diubah" });
    // Urutan tidak pernah dihitung sebagai filter, jadi tombol "Bersihkan N
    // filter" tidak boleh diam-diam mengembalikannya ke A → Z.
    expect(bersih.sort).toBe("diubah");
    expect(karyawanHref(bersih)).toBe("/karyawan?urut=diubah");
  });

  it("urutan bawaan tetap menghasilkan alamat yang bersih", () => {
    expect(karyawanHref(bersihkanFilter(FILTER_KOSONG))).toBe("/karyawan");
  });
});

describe("hitungFilterAktif", () => {
  it("tidak menghitung status bawaan, urutan, dan halaman", () => {
    expect(
      hitungFilterAktif({ ...FILTER_KOSONG, sort: "diubah", page: 5 }),
    ).toBe(0);
    expect(hitungFilterAktif({ ...FILTER_KOSONG, status: "semua" })).toBe(1);
  });
});

describe("SORT_OPTIONS", () => {
  it("menyebut kolom `v_employees` yang benar", () => {
    expect(sortOption("diubah")).toEqual({
      value: "diubah",
      label: "Terakhir diubah",
      orderBy: "updated_at",
      direction: "desc",
    });
    expect(sortOption(DEFAULT_SORT).orderBy).toBe("full_name");
  });

  it("nilainya unik dan yang bawaan ada di dalamnya", () => {
    const nilai = SORT_OPTIONS.map((option) => option.value);
    expect(new Set(nilai).size).toBe(nilai.length);
    expect(nilai).toContain(DEFAULT_SORT);
  });

  it("satu halaman berisi 50 baris, sesuai bawaan lapisan baca", () => {
    expect(KARYAWAN_PER_PAGE).toBe(50);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A `v_employees` row. Dummy data only (CLAUDE.md), and one cast in one place:
 * the view has seventy-odd columns, the table reads seven, and spelling out
 * the other sixty in every fixture would hide what each test is about.
 */
function karyawan(overrides: Partial<VEmployee>): VEmployee {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    personnel_number: "90001",
    nip: "1234567",
    full_name: "Budi Dummy",
    status: "aktif",
    org_unit_nama: null,
    direktorat_nama: null,
    divisi_nama: null,
    departemen_nama: null,
    bagian_nama: null,
    sub_bagian_nama: null,
    proyek_nama: null,
    jabatan_nama: null,
    person_grade_label: null,
    person_grade_kode: null,
    job_grade_label: null,
    job_grade_kode: null,
    ...overrides,
  } as VEmployee;
}

describe("toKaryawanRow", () => {
  it("merangkai induk unit dari atas ke bawah", () => {
    const row = toKaryawanRow(
      karyawan({
        org_unit_nama: "Bagian Kepesertaan",
        direktorat_nama: "Direktorat SDM",
        divisi_nama: "Divisi Human Capital",
        bagian_nama: "Bagian Kepesertaan",
      }),
    );

    expect(row.unitNama).toBe("Bagian Kepesertaan");
    // Nama unitnya sendiri tidak diulang di baris kedua.
    expect(row.unitInduk).toBe("Direktorat SDM › Divisi Human Capital");
  });

  it("tidak mengulang nama yang kembar di rantainya", () => {
    // Sub Bagian yang namanya sama dengan Bagian-nya adalah Temuan "Perlu
    // Dibereskan" yang memang ada di data seed — ditampilkan sekali, bukan dua.
    const row = toKaryawanRow(
      karyawan({
        org_unit_nama: "Sub Bagian Umum",
        divisi_nama: "Divisi Operasi",
        bagian_nama: "Bagian Umum",
        sub_bagian_nama: "Bagian Umum",
      }),
    );

    expect(row.unitInduk).toBe("Divisi Operasi › Bagian Umum");
  });

  it("Karyawan tanpa unit tidak punya baris induk", () => {
    const row = toKaryawanRow(karyawan({}));
    expect(row.unitNama).toBeNull();
    expect(row.unitInduk).toBeNull();
  });

  it("memakai label Lookup, dan jatuh ke kode kalau labelnya kosong", () => {
    const row = toKaryawanRow(
      karyawan({
        person_grade_label: "Pratama III",
        person_grade_kode: "PG-13",
        job_grade_label: null,
        job_grade_kode: "JG-12",
      }),
    );

    expect(row.personGrade).toBe("Pratama III");
    expect(row.jobGrade).toBe("JG-12");
  });

  it("status apa pun selain `aktif` ditampilkan sebagai nonaktif", () => {
    expect(toKaryawanRow(karyawan({ status: "aktif" })).status).toBe("aktif");
    expect(toKaryawanRow(karyawan({ status: "nonaktif" })).status).toBe("nonaktif");
    // Tidak mungkin lolos CHECK constraint, tapi jangan sampai tercetak mentah.
    expect(toKaryawanRow(karyawan({ status: "entah" })).status).toBe("nonaktif");
  });

  it("memetakan setiap baris dan mempertahankan urutannya", () => {
    const rows = toKaryawanRows([
      karyawan({ id: "a", full_name: "Ani Dummy" }),
      karyawan({ id: "b", full_name: "Budi Dummy" }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.nama)).toEqual(["Ani Dummy", "Budi Dummy"]);
  });
});
