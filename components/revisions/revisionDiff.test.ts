/**
 * What the Log Perubahan and the Riwayat Revisi panel actually SAY.
 *
 * `revisionDiff.ts` is pure — no React, no database, no clock — and it decides
 * four things that are each quietly expensive to get wrong:
 *
 *   1. which columns a reader is shown (an unchanged column in the list buries
 *      the one that moved);
 *   2. what a uuid means (a Revisi that reads `org_unit_id: 3f2a… → 9b1c…`
 *      tells staf HC nothing);
 *   3. what must never appear at all (`api_keys.key_hash` — the log must not
 *      become the back door round the RLS on that table, ARCHITECTURE.md §5);
 *   4. how a date reads, identically on the server and in the browser — these
 *      strings are rendered by Client Components that are server-rendered
 *      first, so an unstable format is a hydration mismatch.
 *
 * None of that could be tested before: `vitest.config.ts` collected only
 * `lib/**`, `scripts/**` and `tests/**`, so this file's author had to check it
 * with a throwaway script. Hence the widened `include`, and hence this file.
 *
 * Fixtures only — never a real Karyawan, email or Personnel Number (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";

import {
  API_KEY_ID,
  EMPLOYEE_ID,
  JABATAN_ID,
  LOOKUP_ID,
  ORG_UNIT_ID,
  PROFILE_ID,
  REVISI_EDIT_KARYAWAN,
  REVISI_INSERT_UNIT,
  REVISI_KOLOM_ASING,
  REVISI_TABEL_ASING,
  REVISI_UPDATE_PRIVATE,
  REVISI_UPDATE_PROFIL,
} from "@/fixtures";
import type { Json } from "@/lib/types/db";

import {
  actorLabel,
  collectReferenceIds,
  columnLabel,
  diffRevision,
  DISEMBUNYIKAN,
  emptyReferenceIds,
  formatTanggal,
  formatValue,
  formatWaktu,
  isEmptyReferenceIds,
  KOSONG,
  mergeReferenceIds,
  revisionRowTitle,
  shortId,
  tableLabel,
  TIDAK_DIKENAL,
  valueKind,
  type ReferenceLabels,
  type RevisionLike,
} from "./revisionDiff";

/** A uuid → nama map like the one `resolveRevisionLabels` builds. */
const LABELS: ReferenceLabels = {
  [ORG_UNIT_ID.bagian]: "Bagian Contoh (BAG-CONTOH)",
  [ORG_UNIT_ID.subBagian]: "Sub Bagian Contoh (SUB-CONTOH)",
  [ORG_UNIT_ID.divisi]: "Divisi Contoh (DIV-CONTOH)",
  [JABATAN_ID.staf]: "Staf Contoh (JAB-STAF)",
  [JABATAN_ID.manager]: "Manager Contoh (JAB-MGR)",
  [EMPLOYEE_ID.lengkap]: "Budi Contoh · 90000001",
  [PROFILE_ID.admin]: "admin.contoh@example.test",
};

const kolom = (fields: readonly { column: string }[]) =>
  fields.map((field) => field.column);

describe("diffRevision — kolom yang tidak berubah disembunyikan", () => {
  const fields = diffRevision(
    "employees",
    REVISI_EDIT_KARYAWAN.before,
    REVISI_EDIT_KARYAWAN.after,
  );

  it("hanya menampilkan kolom yang benar-benar bergerak", () => {
    expect(kolom(fields).sort()).toEqual(["jabatan_id", "org_unit_id"]);
  });

  it("tidak menampilkan kolom yang nilainya sama", () => {
    // `full_name` dan `status` ada di kedua snapshot dengan nilai identik.
    expect(kolom(fields)).not.toContain("full_name");
    expect(kolom(fields)).not.toContain("status");
  });

  it("tidak pernah menampilkan primary key maupun created_at/updated_at", () => {
    // `updated_at` bergerak di setiap tulisan dan tidak mengatakan apa pun;
    // `id` adalah barisnya, bukan perubahannya.
    expect(kolom(fields)).not.toContain("id");
    expect(kolom(fields)).not.toContain("created_at");
    expect(kolom(fields)).not.toContain("updated_at");
  });

  it("mengembalikan daftar kosong kalau tidak ada yang berubah", () => {
    expect(diffRevision("employees", REVISI_EDIT_KARYAWAN.after, REVISI_EDIT_KARYAWAN.after))
      .toEqual([]);
  });

  it("insert menampilkan kolom yang terisi saja, tanpa before", () => {
    const insert = diffRevision("org_units", null, REVISI_INSERT_UNIT.after);
    expect(kolom(insert)).toContain("nama");
    expect(kolom(insert)).toContain("kode");
    // `merged_into_id` null pada baris baru — tidak perlu ditampilkan.
    expect(kolom(insert)).not.toContain("merged_into_id");
    expect(insert.every((field) => field.before === undefined)).toBe(true);
  });

  it("kolom yang sudah tidak ada di skema tetap muncul, di urutan terakhir", () => {
    const fields = diffRevision(
      "jabatan",
      REVISI_KOLOM_ASING.before,
      REVISI_KOLOM_ASING.after,
    );
    expect(kolom(fields)).toEqual(["kolom_yang_sudah_dihapus"]);
    // Tidak ada label untuknya, jadi namanya dimanusiakan apa adanya.
    expect(fields[0].label).toBe("Kolom Yang Sudah Dihapus");
  });

  it("menghitung null dan kolom yang absen sebagai hal yang sama", () => {
    const before: Json = { id: JABATAN_ID.staf, nama: "Staf", merged_into_id: null };
    const after: Json = { id: JABATAN_ID.staf, nama: "Staf" };
    expect(diffRevision("jabatan", before, after)).toEqual([]);
  });
});

describe("formatValue — uuid FK menjadi nama yang terbaca", () => {
  const fields = diffRevision(
    "employees",
    REVISI_EDIT_KARYAWAN.before,
    REVISI_EDIT_KARYAWAN.after,
  );
  const unit = fields.find((field) => field.column === "org_unit_id");

  it("mengenali kolom FK sebagai referensi, bukan teks", () => {
    expect(unit?.kind).toBe("reference");
    expect(valueKind("employees", "jabatan_id")).toBe("reference");
    expect(valueKind("employees", "job_grade_id")).toBe("reference");
    expect(valueKind("org_units", "parent_id")).toBe("reference");
  });

  it("mengganti uuid dengan nama dari peta label", () => {
    expect(formatValue("reference", unit?.before, LABELS)).toBe(
      "Bagian Contoh (BAG-CONTOH)",
    );
    expect(formatValue("reference", unit?.after, LABELS)).toBe(
      "Sub Bagian Contoh (SUB-CONTOH)",
    );
  });

  it("tidak pernah menampilkan uuid mentah saat labelnya tidak terbaca (RLS)", () => {
    // Viewer tidak boleh membaca semua baris, jadi label bisa saja tidak ada.
    expect(formatValue("reference", LOOKUP_ID.jobGradeA, {})).toBe(TIDAK_DIKENAL);
  });

  it("nilai kosong menjadi (kosong), bukan string kosong", () => {
    expect(formatValue("reference", null, LABELS)).toBe(KOSONG);
    expect(formatValue("text", "", LABELS)).toBe(KOSONG);
    expect(formatValue("text", undefined, LABELS)).toBe(KOSONG);
  });

  it("menerjemahkan status, role, dan tipe ke label Indonesia", () => {
    expect(formatValue("status", "nonaktif", LABELS)).toBe("Nonaktif");
    expect(formatValue("role", "admin", LABELS)).toBe("Admin");
    expect(formatValue("tipe_unit", "sub_bagian", LABELS)).toBe("Sub Bagian");
    expect(formatValue("tipe_lookup", "job_grade", LABELS)).toBe("Job Grade");
  });

  it("merangkai text[] menjadi satu baris", () => {
    expect(formatValue("list", ["full_name", "nip"], LABELS)).toBe("full_name, nip");
    expect(formatValue("list", [], LABELS)).toBe(KOSONG);
  });
});

describe("key_hash tidak pernah tampil", () => {
  const rahasia = "b4f1c0de".repeat(8);
  const revisi: RevisionLike = {
    table_name: "api_keys",
    row_id: API_KEY_ID.perfApp,
    actor_id: PROFILE_ID.admin,
    before: {
      id: API_KEY_ID.perfApp,
      nama_konsumen: "Konsumen Contoh",
      key_prefix: "hc_demo1",
      key_hash: rahasia,
      allowed_fields: ["personnel_number"],
      status: "aktif",
    },
    after: {
      id: API_KEY_ID.perfApp,
      nama_konsumen: "Konsumen Contoh",
      key_prefix: "hc_demo2",
      key_hash: `${rahasia}ff`,
      allowed_fields: ["personnel_number", "full_name"],
      status: "nonaktif",
    },
  };

  it("menandai key_hash sebagai rahasia", () => {
    expect(valueKind("api_keys", "key_hash")).toBe("rahasia");
  });

  it("menampilkan (disembunyikan) alih-alih nilainya, di kedua sisi", () => {
    expect(formatValue("rahasia", rahasia, LABELS)).toBe(DISEMBUNYIKAN);
    expect(formatValue("rahasia", null, LABELS)).toBe(DISEMBUNYIKAN);
  });

  it("tidak membocorkan hash lewat satu pun nilai yang dirender", () => {
    const fields = diffRevision("api_keys", revisi.before, revisi.after);
    // Kolomnya boleh muncul (perubahannya nyata), nilainya tidak boleh.
    expect(kolom(fields)).toContain("key_hash");
    const dirender = fields.flatMap((field) => [
      formatValue(field.kind, field.before, LABELS),
      formatValue(field.kind, field.after, LABELS),
    ]);
    expect(dirender.some((teks) => teks.includes(rahasia))).toBe(false);
    expect(dirender).toContain(DISEMBUNYIKAN);
  });

  it("menamai barisnya dengan nama Konsumen, bukan uuid", () => {
    expect(revisionRowTitle(revisi, LABELS)).toBe("Konsumen Contoh");
  });
});

describe("format tanggal & waktu stabil", () => {
  it("tanggal ditulis 14 Sep 2026", () => {
    expect(formatTanggal("2026-09-14")).toBe("14 Sep 2026");
  });

  it("tidak menggeser tanggal lahir lewat zona waktu", () => {
    // `new Date("1980-02-29")` adalah tengah malam UTC — di New York masih
    // tanggal 28. Tanggal lahir tidak boleh pindah hari.
    expect(formatTanggal("1980-02-29")).toBe("29 Feb 1980");
    expect(formatValue("date", "1980-02-29", LABELS)).toBe("29 Feb 1980");
  });

  it("memakai nama bulan sendiri, bukan ICU (Agu vs Agt)", () => {
    expect(formatTanggal("2026-08-01")).toBe("1 Agu 2026");
  });

  it("timestamp dibaca dalam WIB, apa pun zona servernya", () => {
    // 2026-09-14T14:33:00Z = 21.33 di Jakarta (UTC+7).
    expect(formatWaktu("2026-09-14T14:33:00.000Z")).toBe("14 Sep 2026, 21.33 WIB");
  });

  it("timestamp lewat tengah malam WIB ikut pindah hari", () => {
    expect(formatWaktu("2026-09-14T17:05:00.000Z")).toBe("15 Sep 2026, 00.05 WIB");
  });

  it("mengembalikan nilai apa adanya kalau bukan tanggal", () => {
    expect(formatTanggal("bukan tanggal")).toBe("bukan tanggal");
    expect(formatWaktu("bukan waktu")).toBe("bukan waktu");
  });

  it("kolom tanggal dikenali dari namanya", () => {
    expect(valueKind("employees", "tanggal_diangkat")).toBe("date");
    expect(valueKind("employees", "original_start_date")).toBe("date");
    expect(valueKind("employee_private", "date_of_birth")).toBe("date");
    expect(valueKind("api_keys", "last_used_at")).toBe("timestamp");
  });
});

describe("label kolom & judul baris", () => {
  it("memakai kata yang sama dengan formulir", () => {
    expect(columnLabel("employees", "full_name")).toBe("Nama");
    expect(columnLabel("employees", "personnel_number")).toBe("Personnel Number");
    expect(columnLabel("org_units", "parent_id")).toBe("Induk");
    expect(columnLabel("lookups", "label")).toBe("Label");
  });

  it("memanusiakan kolom yang belum punya label", () => {
    expect(columnLabel("employees", "kolom_baru_nanti")).toBe("Kolom Baru Nanti");
  });

  it("menamai tabel dengan kosakata CONTEXT.md", () => {
    expect(tableLabel("org_units")).toBe("Unit Organisasi");
    expect(tableLabel("employee_private")).toBe("Data Pribadi Sensitif");
    expect(tableLabel("tabel_yang_tidak_ada")).toBe("tabel_yang_tidak_ada");
  });

  it("menamai baris dari snapshot-nya sendiri", () => {
    expect(revisionRowTitle(REVISI_EDIT_KARYAWAN, LABELS)).toBe("Budi Contoh");
    expect(revisionRowTitle(REVISI_INSERT_UNIT, LABELS)).toBe(
      "Proyek Contoh (PRY-CONTOH)",
    );
    expect(revisionRowTitle(REVISI_UPDATE_PROFIL, LABELS)).toBe(
      "viewer.contoh@example.test",
    );
  });

  it("Data Pribadi Sensitif dinamai lewat Karyawan-nya, bukan uuid", () => {
    expect(revisionRowTitle(REVISI_UPDATE_PRIVATE, LABELS)).toBe(
      "Budi Contoh · 90000001",
    );
    expect(revisionRowTitle(REVISI_UPDATE_PRIVATE, {})).toBe(
      shortId(EMPLOYEE_ID.lengkap),
    );
  });

  it("tabel di luar tujuh tabel ter-log tetap punya judul", () => {
    expect(revisionRowTitle(REVISI_TABEL_ASING, LABELS)).toContain(
      "tabel_yang_tidak_ada",
    );
  });

  it("aktor tanpa label tetap bisa dibedakan; seed adalah Sistem", () => {
    expect(actorLabel(null, LABELS)).toBe("Sistem");
    expect(actorLabel(PROFILE_ID.admin, LABELS)).toBe("admin.contoh@example.test");
    expect(actorLabel(PROFILE_ID.viewer, LABELS)).toBe(
      `Pengguna ${shortId(PROFILE_ID.viewer)}`,
    );
  });
});

describe("collectReferenceIds", () => {
  it("mengumpulkan kedua sisi diff, unik dan terurut", () => {
    const ids = collectReferenceIds([REVISI_EDIT_KARYAWAN]);
    expect(ids.org_units).toEqual(
      [ORG_UNIT_ID.bagian, ORG_UNIT_ID.subBagian].sort(),
    );
    expect(ids.jabatan).toEqual([JABATAN_ID.manager, JABATAN_ID.staf].sort());
    expect(ids.profiles).toEqual([PROFILE_ID.admin]);
  });

  it("mengambil row_id employee_private sebagai Karyawan", () => {
    const ids = collectReferenceIds([REVISI_UPDATE_PRIVATE]);
    expect(ids.employees).toEqual([EMPLOYEE_ID.lengkap]);
  });

  it("mengabaikan tabel yang tidak ter-log, tapi tetap mencatat aktornya", () => {
    const ids = collectReferenceIds([REVISI_TABEL_ASING]);
    expect(ids.org_units).toEqual([]);
    expect(ids.profiles).toEqual([PROFILE_ID.admin]);
  });

  it("emptyReferenceIds benar-benar kosong, dan mergeReferenceIds menyatukan", () => {
    expect(isEmptyReferenceIds(emptyReferenceIds())).toBe(true);
    const gabungan = mergeReferenceIds(
      collectReferenceIds([REVISI_EDIT_KARYAWAN]),
      collectReferenceIds([REVISI_UPDATE_PRIVATE]),
    );
    expect(gabungan.employees).toEqual([EMPLOYEE_ID.lengkap]);
    expect(gabungan.org_units).toHaveLength(2);
    expect(isEmptyReferenceIds(gabungan)).toBe(false);
  });
});
