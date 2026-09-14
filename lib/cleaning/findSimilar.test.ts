/**
 * Tests for `lib/cleaning/findSimilar.ts`.
 *
 * The first test is the ROADMAP Fase 3 exit criterion written out: "halaman
 * Bereskan menampilkan pasangan 'Divisi QHSSE' / 'DIVISI QHSSE' sebagai
 * mirip". Everything else guards the decisions that keep the page finishable —
 * nonaktif rows drop out, Lookup tipe never crosses, groups of one are not
 * Temuan.
 *
 * DUMMY DATA ONLY (CLAUDE.md). "QHSSE" appears because the ROADMAP names it as
 * the acceptance case; it is a department-type abbreviation, not a Karyawan.
 */
import { describe, expect, it } from "vitest";

import { findSimilarNames, type ReferenceRow } from "./findSimilar";

function row(over: Partial<ReferenceRow> & { id: string; nama: string }): ReferenceRow {
  return { kode: over.id.toUpperCase(), status: "aktif", ...over };
}

describe("findSimilarNames — kriteria keluar Fase 3", () => {
  it("melaporkan 'Divisi QHSSE' dan 'DIVISI QHSSE' sebagai satu pasangan", () => {
    const temuan = findSimilarNames("org_unit", [
      row({ id: "u1", kode: "DIV-01", nama: "Divisi QHSSE" }),
      row({ id: "u2", kode: "DIV-02", nama: "DIVISI QHSSE" }),
      row({ id: "u3", kode: "DIV-03", nama: "Divisi Contoh" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].entitas).toBe("org_unit");
    expect(temuan[0].baris.map((r) => r.nama)).toEqual([
      "Divisi QHSSE",
      "DIVISI QHSSE",
    ]);
    expect(temuan[0].perbedaan).toEqual(["kapitalisasi"]);
  });
});

describe("findSimilarNames — pengelompokan", () => {
  it("menggabungkan tiga ejaan satu nama jadi satu Temuan", () => {
    const temuan = findSimilarNames("org_unit", [
      row({ id: "u1", kode: "DIV-01", nama: "Divisi K3 & Lingkungan" }),
      row({ id: "u2", kode: "DIV-02", nama: "Divisi K3 dan Lingkungan" }),
      row({ id: "u3", kode: "DIV-03", nama: "DIVISI K3 DAN LINGKUNGAN" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].baris).toHaveLength(3);
    expect(temuan[0].perbedaan).toEqual(["kapitalisasi", "ampersand"]);
  });

  it("tidak melaporkan nama yang cuma muncul sekali", () => {
    expect(
      findSimilarNames("jabatan", [
        row({ id: "j1", nama: "Manager Contoh" }),
        row({ id: "j2", nama: "Staf Contoh" }),
      ]),
    ).toEqual([]);
  });

  it("tetap melaporkan dua baris yang namanya sama persis", () => {
    // Dua Unit Organisasi dengan nama identik tapi kode berbeda tetap dua
    // baris di database — dan tetap perlu dibereskan.
    const temuan = findSimilarNames("org_unit", [
      row({ id: "u1", kode: "DIV-01", nama: "Divisi Contoh" }),
      row({ id: "u2", kode: "DIV-02", nama: "Divisi Contoh" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].perbedaan).toEqual([]);
    expect(temuan[0].namaIdentik).toBe(true);
  });

  it("membedakan 'nama identik' dari 'perbedaan tanpa nama'", () => {
    // Keduanya menghasilkan perbedaan kosong; hanya namaIdentik yang bisa
    // memisahkan "memang sama persis" dari "beda, tapi tidak ada dimensi yang
    // memilikinya".
    const temuan = findSimilarNames("lookup", [
      row({ id: "l1", kode: "JG-A", nama: "Pratama III - 13", tipe: "job_grade" }),
      row({ id: "l2", kode: "JG-B", nama: "Pratama III-13", tipe: "job_grade" }),
    ]);

    expect(temuan[0].perbedaan).toEqual([]);
    expect(temuan[0].namaIdentik).toBe(false);
  });

  it("mengurutkan baris menurut kode, bukan urutan masukan", () => {
    const temuan = findSimilarNames("jabatan", [
      row({ id: "j2", kode: "JBT-002", nama: "STAF CONTOH" }),
      row({ id: "j1", kode: "JBT-001", nama: "Staf Contoh" }),
    ]);

    expect(temuan[0].baris.map((r) => r.kode)).toEqual(["JBT-001", "JBT-002"]);
  });

  it("menaruh kelompok terbesar di atas", () => {
    const temuan = findSimilarNames("jabatan", [
      row({ id: "a1", kode: "A1", nama: "Analis Contoh" }),
      row({ id: "a2", kode: "A2", nama: "ANALIS CONTOH" }),
      row({ id: "b1", kode: "B1", nama: "Staf Contoh" }),
      row({ id: "b2", kode: "B2", nama: "STAF CONTOH" }),
      row({ id: "b3", kode: "B3", nama: "staf contoh" }),
    ]);

    expect(temuan.map((t) => t.baris.length)).toEqual([3, 2]);
  });

  it("melewati nama kosong alih-alih mengumpulkannya jadi satu kelompok", () => {
    expect(
      findSimilarNames("jabatan", [
        row({ id: "j1", nama: "" }),
        row({ id: "j2", nama: "   " }),
        row({ id: "j3", nama: "-" }),
      ]),
    ).toEqual([]);
  });

  it("memberi id yang stabil dari id baris, bukan dari nama", () => {
    const sebelum = findSimilarNames("org_unit", [
      row({ id: "u1", kode: "DIV-01", nama: "Divisi Contoh" }),
      row({ id: "u2", kode: "DIV-02", nama: "DIVISI CONTOH" }),
    ]);
    const sesudahRename = findSimilarNames("org_unit", [
      row({ id: "u1", kode: "DIV-01", nama: "Divisi Lain" }),
      row({ id: "u2", kode: "DIV-02", nama: "DIVISI LAIN" }),
    ]);

    expect(sesudahRename[0].id).toBe(sebelum[0].id);
  });
});

describe("findSimilarNames — status", () => {
  const ROWS: ReferenceRow[] = [
    row({ id: "u1", kode: "DIV-01", nama: "Divisi Contoh" }),
    row({ id: "u2", kode: "DIV-02", nama: "DIVISI CONTOH", status: "nonaktif" }),
  ];

  it("mengabaikan baris nonaktif secara default, supaya halaman bisa habis", () => {
    // Inilah yang membuat Temuan hilang setelah di-merge: Merge menonaktifkan
    // asal, tidak menghapusnya (PRD §6).
    expect(findSimilarNames("org_unit", ROWS)).toEqual([]);
  });

  it("ikut menghitung baris nonaktif kalau diminta", () => {
    const temuan = findSimilarNames("org_unit", ROWS, { includeNonaktif: true });
    expect(temuan).toHaveLength(1);
    expect(temuan[0].baris).toHaveLength(2);
  });
});

describe("findSimilarNames — Lookup", () => {
  it("tidak pernah memasangkan Lookup dari tipe berbeda", () => {
    // merge_lookup menolak merge lintas tipe (kolom employees-nya beda), jadi
    // pasangan ini hanya akan menawarkan Merge yang pasti ditolak database.
    const temuan = findSimilarNames("lookup", [
      row({ id: "l1", kode: "JG-A", nama: "Pratama I", tipe: "job_grade" }),
      row({ id: "l2", kode: "PG-A", nama: "PRATAMA I", tipe: "person_grade" }),
    ]);

    expect(temuan).toEqual([]);
  });

  it("memasangkan Lookup dengan tipe sama", () => {
    const temuan = findSimilarNames("lookup", [
      row({ id: "l1", kode: "JG-A", nama: "Pratama III - 13", tipe: "job_grade" }),
      row({ id: "l2", kode: "JG-B", nama: "PRATAMA III - 13", tipe: "job_grade" }),
    ]);

    expect(temuan).toHaveLength(1);
    expect(temuan[0].tipe).toBe("job_grade");
    expect(temuan[0].perbedaan).toEqual(["kapitalisasi"]);
  });
});

describe("findSimilarNames — biaya", () => {
  it("memindai ribuan baris tanpa membandingkan setiap pasangan", () => {
    // Penjaga regresi, bukan benchmark: kalau pengelompokan Map diganti jadi
    // perbandingan n², 5.000 baris akan makan detik, bukan milidetik. Ambang
    // dibuat sangat longgar supaya tidak rewel di mesin CI yang sibuk.
    const rows: ReferenceRow[] = [];
    for (let i = 0; i < 5000; i += 1) {
      rows.push(row({ id: `u${i}`, kode: `U-${i}`, nama: `Unit Contoh ${i}` }));
    }
    // 250 pasangan mirip di tengah data yang bersih.
    for (let i = 0; i < 250; i += 1) {
      rows.push(row({ id: `d${i}`, kode: `D-${i}`, nama: `UNIT CONTOH ${i}` }));
    }

    const mulai = performance.now();
    const temuan = findSimilarNames("org_unit", rows);
    const durasi = performance.now() - mulai;

    expect(temuan).toHaveLength(250);
    expect(durasi).toBeLessThan(1000);
  });
});
