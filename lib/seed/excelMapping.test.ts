/**
 * Tests for the pure half of the Seed.
 *
 * WHY THIS FILE IS LONG
 * ---------------------------------------------------------------------------
 * `lib/seed/excelMapping.ts` is the one place in HC Core where being wrong
 * is completely silent. Nothing throws when `Tanggal Promosi JG` is written
 * into `tanggal_promosi_pg`; the Seed reports success, the pages render, and
 * ~1.475 people carry the wrong date until somebody happens to check one. The
 * Seed also runs once, so there is no second attempt to notice it in.
 *
 * So every row of the mapping table gets an assertion, every date shape gets an
 * assertion, and the rules that only exist in prose — trim but never clean, the
 * two duplicated headers, "Sub Bagian equals Bagian", "Bagian starting with
 * Proyek" — get one each.
 *
 * DUMMY DATA ONLY (CLAUDE.md). Every name and number here is invented.
 */
import { describe, expect, it } from "vitest";

import { LOOKUP_TYPES } from "../validation/lookupTypes";
import {
  DUPLICATE_HEADER_GROUPS,
  HEADER_ROW,
  HEADER_TARGETS,
  IGNORED_FORMULA_HEADERS,
  KodeRegistry,
  SHEET_NAME,
  buildHeaderPlan,
  canonicalHeader,
  cellText,
  errorsOf,
  excelSerialToIsoDate,
  isExcelError,
  isIgnoredFormulaHeader,
  parseDateCell,
  planSeed,
  slugKode,
  warningsOf,
  type ColumnTarget,
} from "./excelMapping";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal sheet: three title rows, headers on row 4, then data rows. */
function sheet(
  headers: readonly unknown[],
  ...rows: readonly unknown[][]
): unknown[][] {
  return [["Judul"], [], [], [...headers], ...rows.map((row) => [...row])];
}

const MINIMAL_HEADERS = ["Personnel Number", "Nama"] as const;

function targetOf(header: string): ColumnTarget | undefined {
  const plan = buildHeaderPlan([...MINIMAL_HEADERS, header]);
  return plan.columns.find((column) => column.header === header)?.target;
}

// ---------------------------------------------------------------------------

describe("konstanta tata letak", () => {
  it("membaca sheet dan baris header yang didokumentasikan", () => {
    expect(SHEET_NAME).toBe("Demografi Karyawan - Posisi");
    expect(HEADER_ROW).toBe(4);
  });
});

describe("canonicalHeader", () => {
  it("melipat kapitalisasi dan spasi berlebih", () => {
    expect(canonicalHeader("  Personnel   Number ")).toBe("personnel number");
  });

  it("mengubah tanda baca jadi spasi", () => {
    expect(canonicalHeader("Teknik/Non Teknik")).toBe("teknik non teknik");
    expect(canonicalHeader("Keterangan PJ/PLT")).toBe("keterangan pj plt");
    expect(canonicalHeader("PG-JG")).toBe("pg jg");
  });

  it("menormalkan bentuk unicode (NFKC)", () => {
    expect(canonicalHeader("Ｎama")).toBe("nama");
  });

  it("mengembalikan string kosong untuk sel kosong", () => {
    expect(canonicalHeader(null)).toBe("");
    expect(canonicalHeader(undefined)).toBe("");
    expect(canonicalHeader("   ")).toBe("");
  });
});

describe("kolom rumus yang diabaikan", () => {
  it.each(IGNORED_FORMULA_HEADERS)("mengabaikan %s", (header) => {
    expect(isIgnoredFormulaHeader(header)).toBe(true);
  });

  it.each([
    "Masa Kerja",
    "Masa Jabatan",
    "Masa Sejak Diangkat",
    "Masa PG",
    "Masa JG",
    "Keterangan Naik PG",
    "Keterangan Naik JG",
  ])("mengabaikan kolom rumus %s", (header) => {
    expect(isIgnoredFormulaHeader(canonicalHeader(header))).toBe(true);
  });

  it("mengabaikan tepat 12 kolom rumus dari tata letak yang didokumentasikan", () => {
    const layout = [
      "No",
      "Masa Jabatan",
      "Age",
      "Range",
      "Gen",
      "Masa Kerja",
      "Masa Sejak Diangkat",
      "Masa PG",
      "Keterangan Naik PG",
      "Masa JG",
      "Keterangan Naik JG",
      "PG-JG",
    ];
    expect(
      layout.filter((h) => isIgnoredFormulaHeader(canonicalHeader(h))),
    ).toHaveLength(12);
  });

  it("TIDAK mengabaikan kolom yang cuma mengandung kata yang sama", () => {
    // "No" adalah nomor urut; "No Surat" bukan.
    expect(isIgnoredFormulaHeader(canonicalHeader("No Surat"))).toBe(false);
    // "Range" adalah rentang usia; "BoD Range" adalah Lookup.
    expect(isIgnoredFormulaHeader(canonicalHeader("BoD Range"))).toBe(false);
    // "Keterangan Naik PG" rumus; "Keterangan Rangkap" dan "Keterangan" bukan.
    expect(isIgnoredFormulaHeader(canonicalHeader("Keterangan Rangkap"))).toBe(
      false,
    );
    expect(isIgnoredFormulaHeader(canonicalHeader("Keterangan"))).toBe(false);
  });
});

describe("pemetaan header → kolom", () => {
  it.each([
    ["Personnel Number", "personnel_number"],
    ["NIP", "nip"],
    ["Nama", "full_name"],
    ["Keterangan PJ/PLT", "keterangan_pj_plt"],
    ["Keterangan", "keterangan"],
    ["Jurusan", "jurusan"],
  ])("%s → employees.%s", (header, field) => {
    expect(targetOf(header)).toEqual({ kind: "text", field });
  });

  it.each([
    ["Original Start Date", "original_start_date"],
    ["Tanggal Diangkat", "tanggal_diangkat"],
    ["Tanggal Promosi PG", "tanggal_promosi_pg"],
    ["Tanggal Promosi JG", "tanggal_promosi_jg"],
    ["Tanggal Keluar", "tanggal_keluar"],
  ])("%s → employees.%s (date)", (header, field) => {
    expect(targetOf(header)).toEqual({ kind: "date", field });
  });

  it.each([
    ["Gender", "gender"],
    ["Work Contract", "work_contract"],
    ["Person Grade", "person_grade"],
    ["Job Grade", "job_grade"],
    ["Legal Entity", "legal_entity"],
    ["Klasifikasi Rekrutmen", "klasifikasi_rekrutmen"],
    ["Teknik/Non Teknik", "teknik_non_teknik"],
    ["BoD Range", "bod_range"],
    ["Band Jabatan", "band_jabatan"],
    ["Kategori Penempatan", "kategori_penempatan"],
    ["Kategori Fungsi", "kategori_fungsi"],
  ])("%s → Lookup tipe %s", (header, tipe) => {
    expect(targetOf(header)).toEqual({ kind: "lookup", tipe });
  });

  it("memetakan kesebelas tipe Lookup, tidak kurang", () => {
    const mapped = new Set(
      HEADER_TARGETS.flatMap(([, target]) =>
        target.kind === "lookup" ? [target.tipe] : [],
      ),
    );
    expect([...mapped].sort()).toEqual([...LOOKUP_TYPES].sort());
  });

  it.each([
    ["Business Unit", "business_unit"],
    ["Divisi", "divisi"],
    ["Bagian", "bagian"],
    ["Sub Bagian", "sub_bagian"],
  ])("%s → tingkat hierarki %s", (header, level) => {
    expect(targetOf(header)).toEqual({ kind: "org", level });
  });

  it.each([
    ["Tempat Lahir", "place_of_birth"],
    ["Agama", "religion"],
    ["Status Pernikahan", "marital_status"],
  ])("%s → employee_private.%s", (header, field) => {
    expect(targetOf(header)).toEqual({ kind: "private_text", field });
  });

  it("Tanggal Lahir masuk employee_private, bukan employees", () => {
    expect(targetOf("Tanggal Lahir")).toEqual({ kind: "private_date" });
  });

  it("Jabatan punya tujuannya sendiri", () => {
    expect(targetOf("Jabatan")).toEqual({ kind: "jabatan" });
  });

  it("menerima ejaan alternatif yang umum", () => {
    expect(targetOf("Nama Karyawan")).toEqual({
      kind: "text",
      field: "full_name",
    });
    expect(targetOf("Tgl Lahir")).toEqual({ kind: "private_date" });
    expect(targetOf("Jenis Kelamin")).toEqual({
      kind: "lookup",
      tipe: "gender",
    });
  });

  /**
   * Ejaan yang benar-benar ada di workbook HC, ditemukan saat uji-coba Seed
   * pertama dan dilaporkan sebagai `kolom_tidak_dikenal`.
   *
   * Dipatok satu per satu, bukan sekadar "ada di HEADER_TARGETS": yang mahal
   * bukan header yang tidak dikenal — itu dilaporkan dan datanya dibuang —
   * melainkan header yang dikenal lalu mendarat di kolom yang salah pada
   * ±1.475 orang sekaligus.
   */
  it.each([
    ["Business Unit Name", { kind: "org", level: "business_unit" }],
    ["Company Legal Entity Name", { kind: "lookup", tipe: "legal_entity" }],
    [
      "Klasifikasi Program Rekrutmen",
      { kind: "lookup", tipe: "klasifikasi_rekrutmen" },
    ],
    [
      "Employment Details Original Start Date",
      { kind: "date", field: "original_start_date" },
    ],
  ])("ejaan workbook HC: %s", (header, target) => {
    expect(targetOf(header)).toEqual(target);
  });

  it('"Nomer Surat" kembar tetap jadi PG lalu JG, bukan digabung', () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "Nomer Surat",
      "Nomer Surat",
    ]);
    expect(plan.unknown).toEqual([]);
    expect(
      plan.columns
        .filter((c) => c.header === "Nomer Surat")
        .map((c) => c.target),
    ).toEqual([
      { kind: "text", field: "nomor_surat_pg" },
      { kind: "text", field: "nomor_surat_jg" },
    ]);
  });

  it("menyuruh pembacanya ke template, bukan ke berkas kode", () => {
    const plan = buildHeaderPlan([...MINIMAL_HEADERS, "Catatan HC"]);
    const pesan =
      plan.issues.find((i) => i.kode === "kolom_tidak_dikenal")?.pesan ?? "";
    // Pesan ini muncul di pratinjau halaman Impor dan dibaca staf HC
    // non-teknis. Dulu ia menyuruh mereka menyunting sebuah berkas .ts — dan
    // berkas yang ditunjuknya bahkan sudah pindah sekali tanpa ada yang sadar.
    // Sejak ada template yang bisa diunduh (PRD #24), jalan keluarnya ada di
    // layar yang sama dengan pesannya.
    expect(pesan).toContain("template");
    expect(pesan).not.toMatch(/\.ts\b/);
  });

  it("melaporkan kolom yang tidak dikenal, bukan menebaknya", () => {
    const plan = buildHeaderPlan([...MINIMAL_HEADERS, "Catatan HC"]);
    expect(plan.unknown).toEqual(["Catatan HC"]);
    expect(plan.issues.map((i) => i.kode)).toContain("kolom_tidak_dikenal");
    expect(plan.issues.every((i) => i.level === "peringatan")).toBe(true);
  });

  it("gagal keras kalau kolom wajib tidak ada", () => {
    const plan = buildHeaderPlan(["Divisi", "Jabatan"]);
    const kodes = plan.issues
      .filter((i) => i.level === "error")
      .map((i) => i.kode);
    expect(kodes).toEqual(["kolom_wajib_hilang", "kolom_wajib_hilang"]);
  });

  it("melewati kolom pemisah yang headernya kosong", () => {
    const plan = buildHeaderPlan(["Personnel Number", "", null, "Nama"]);
    expect(plan.columns.map((c) => c.index)).toEqual([0, 3]);
  });
});

describe("header kembar — jangan pernah digabung (CLAUDE.md)", () => {
  it("No Surat pertama jadi PG, yang kedua jadi JG", () => {
    const plan = buildHeaderPlan([...MINIMAL_HEADERS, "No Surat", "No Surat"]);
    expect(plan.columns.slice(2).map((c) => c.target)).toEqual([
      { kind: "text", field: "nomor_surat_pg" },
      { kind: "text", field: "nomor_surat_jg" },
    ]);
  });

  it("Keterangan Rangkap pertama jadi slot 1, yang kedua jadi slot 2", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "Keterangan Rangkap",
      "Keterangan Rangkap",
    ]);
    expect(plan.columns.slice(2).map((c) => c.target)).toEqual([
      { kind: "text", field: "keterangan_rangkap_1" },
      { kind: "text", field: "keterangan_rangkap_2" },
    ]);
  });

  it("kemunculan ketiga dilaporkan, bukan diam-diam menimpa", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "No Surat",
      "No Surat",
      "No Surat",
    ]);
    expect(plan.columns).toHaveLength(4);
    expect(plan.issues.map((i) => i.kode)).toContain("kolom_kembar_berlebih");
  });

  it("kemunculan ketiga TIDAK dilaporkan sebagai 'tidak dikenal' — sarannya beda", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "Keterangan Rangkap",
      "Keterangan Rangkap",
      "Keterangan Rangkap",
    ]);
    expect(plan.unknown).toEqual([]);
    const issue = plan.issues.find((i) => i.kode === "kolom_kembar_berlebih");
    expect(issue?.pesan).not.toContain("Tambahkan ejaannya");
    expect(issue?.pesan).toContain("keterangan_rangkap_2");
  });

  it("ejaan eksplisit lebih dulu: yang polos mengisi slot yang MASIH kosong", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "No Surat PG",
      "No Surat",
    ]);
    expect(plan.columns.slice(2).map((c) => c.target)).toEqual([
      { kind: "text", field: "nomor_surat_pg" },
      { kind: "text", field: "nomor_surat_jg" },
    ]);
    expect(plan.issues).toEqual([]);
  });

  it("ejaan eksplisit belakangan: tabrakan dilaporkan, bukan didiamkan", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "No Surat",
      "No Surat PG",
    ]);
    expect(plan.issues.map((i) => i.kode)).toContain("kolom_ganda");
  });

  it("ejaan yang sudah dibedakan tetap dipetakan langsung", () => {
    const plan = buildHeaderPlan([
      ...MINIMAL_HEADERS,
      "No Surat JG",
      "No Surat PG",
      "Keterangan Rangkap 2",
      "Keterangan Rangkap 1",
    ]);
    expect(plan.columns.slice(2).map((c) => c.target)).toEqual([
      { kind: "text", field: "nomor_surat_jg" },
      { kind: "text", field: "nomor_surat_pg" },
      { kind: "text", field: "keterangan_rangkap_2" },
      { kind: "text", field: "keterangan_rangkap_1" },
    ]);
  });

  it("dua grup kembar yang dikenal, masing-masing dua slot", () => {
    expect(DUPLICATE_HEADER_GROUPS).toHaveLength(2);
    expect(DUPLICATE_HEADER_GROUPS.every((g) => g.slots.length === 2)).toBe(
      true,
    );
  });

  it("kedua slot terisi terpisah dari dua kolom yang sama namanya", () => {
    const plan = planSeed(
      sheet(
        [
          "Personnel Number",
          "Nama",
          "Keterangan Rangkap",
          "Keterangan Rangkap",
        ],
        ["90000001", "Budi Contoh", "Ketua Tim A", "Sekretaris Tim B"],
      ),
    );
    expect(plan.employees[0].text.keterangan_rangkap_1).toBe("Ketua Tim A");
    expect(plan.employees[0].text.keterangan_rangkap_2).toBe(
      "Sekretaris Tim B",
    );
  });
});

describe("cellText — trim, dan tidak lebih", () => {
  it("memangkas spasi di ujung", () => {
    expect(cellText("  Divisi QHSSE  ")).toBe("Divisi QHSSE");
  });

  it("tidak menyentuh kapitalisasi, spasi ganda, atau tanda baca", () => {
    expect(cellText("DIVISI  QHSSE & K3")).toBe("DIVISI  QHSSE & K3");
  });

  it("sel kosong jadi null", () => {
    expect(cellText(null)).toBeNull();
    expect(cellText(undefined)).toBeNull();
    expect(cellText("")).toBeNull();
    expect(cellText("   ")).toBeNull();
  });

  it("angka jadi teks polos, bukan notasi ilmiah", () => {
    expect(cellText(90000001)).toBe("90000001");
    expect(cellText(12345678901234)).toBe("12345678901234");
  });

  it("nilai error rumus dianggap kosong", () => {
    expect(cellText("#N/A")).toBeNull();
    expect(cellText("#REF!")).toBeNull();
    expect(isExcelError("#value!")).toBe(true);
    expect(isExcelError("Teknik")).toBe(false);
  });
});

describe("excelSerialToIsoDate", () => {
  it.each([
    [1, "1900-01-01"],
    [59, "1900-02-28"],
    [61, "1900-03-01"],
    [25569, "1970-01-01"],
    [36526, "2000-01-01"],
    [45292, "2024-01-01"],
    [45657, "2024-12-31"],
  ])("serial %i → %s", (serial, iso) => {
    expect(excelSerialToIsoDate(serial)).toBe(iso);
  });

  it("menolak serial 60 — 29 Februari 1900 tidak pernah ada", () => {
    expect(excelSerialToIsoDate(60)).toBeNull();
  });

  it("menolak serial nol dan negatif", () => {
    expect(excelSerialToIsoDate(0)).toBeNull();
    expect(excelSerialToIsoDate(-5)).toBeNull();
  });

  it("membuang bagian pecahan (jam)", () => {
    expect(excelSerialToIsoDate(45292.75)).toBe("2024-01-01");
  });

  it("mendukung sistem tanggal 1904", () => {
    expect(excelSerialToIsoDate(0, true)).toBe("1904-01-01");
    expect(excelSerialToIsoDate(24107, true)).toBe("1970-01-01");
  });

  it("tidak tergantung timezone mesin yang menjalankan", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      const east = excelSerialToIsoDate(45292);
      process.env.TZ = "Pacific/Midway"; // UTC-11
      const west = excelSerialToIsoDate(45292);
      expect(east).toBe("2024-01-01");
      expect(west).toBe("2024-01-01");
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("parseDateCell", () => {
  it("membaca serial angka", () => {
    expect(parseDateCell(45292)).toEqual({ ok: true, iso: "2024-01-01" });
  });

  it("membaca teks ISO", () => {
    expect(parseDateCell("2019-08-05")).toEqual({
      ok: true,
      iso: "2019-08-05",
    });
  });

  it("membaca teks hari-dulu, bukan bulan-dulu", () => {
    expect(parseDateCell("05/08/2019")).toEqual({
      ok: true,
      iso: "2019-08-05",
    });
    expect(parseDateCell("31-12-2019")).toEqual({
      ok: true,
      iso: "2019-12-31",
    });
    expect(parseDateCell("01.02.2020")).toEqual({
      ok: true,
      iso: "2020-02-01",
    });
  });

  it("membaca objek Date memakai komponen UTC-nya", () => {
    expect(parseDateCell(new Date(Date.UTC(2019, 7, 5)))).toEqual({
      ok: true,
      iso: "2019-08-05",
    });
  });

  it("membaca serial yang kebetulan berupa teks", () => {
    expect(parseDateCell("45292")).toEqual({ ok: true, iso: "2024-01-01" });
  });

  it("sel kosong bukan kesalahan", () => {
    expect(parseDateCell(null)).toEqual({ ok: true, iso: null });
    expect(parseDateCell("")).toEqual({ ok: true, iso: null });
    expect(parseDateCell("#N/A")).toEqual({ ok: true, iso: null });
  });

  it("menolak tanggal yang tidak ada, bukan menggesernya", () => {
    expect(parseDateCell("31/02/2020").ok).toBe(false);
    expect(parseDateCell("2020-02-31").ok).toBe(false);
  });

  it("menolak teks yang bukan tanggal — tidak diam-diam jadi NULL", () => {
    expect(parseDateCell("belum ada")).toEqual({ ok: false, raw: "belum ada" });
    expect(parseDateCell("Agustus 2019").ok).toBe(false);
  });

  it("tahun saja TIDAK dikarang jadi tanggal", () => {
    // "1990" sebagai serial akan jadi 1905-06-12 — tanggal lahir palsu.
    expect(parseDateCell("1990")).toEqual({ ok: false, raw: "1990" });
    expect(parseDateCell("2024")).toEqual({ ok: false, raw: "2024" });
    expect(parseDateCell(1990)).toEqual({ ok: false, raw: "1990" });
  });

  it("serial 0 dianggap kosong — itu rumus yang menunjuk sel kosong", () => {
    expect(parseDateCell(0)).toEqual({ ok: true, iso: null });
    expect(parseDateCell("0")).toEqual({ ok: true, iso: null });
  });
});

describe("slugKode & KodeRegistry", () => {
  it("membuat kode yang bisa dibaca manusia", () => {
    expect(slugKode("Divisi QHSSE")).toBe("DIVISI-QHSSE");
    expect(slugKode("Bagian Keuangan & Akuntansi")).toBe(
      "BAGIAN-KEUANGAN-AKUNTANSI",
    );
  });

  it("membuang aksen dan tanda baca di ujung", () => {
    expect(slugKode("Divisi Café (Baru)")).toBe("DIVISI-CAFE-BARU");
  });

  it("selalu menghasilkan sesuatu, bahkan untuk nama tanpa huruf", () => {
    expect(slugKode("&&&")).toBe("X");
  });

  it("memotong nama yang sangat panjang", () => {
    expect(slugKode("A".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("membedakan varian yang slug-nya sama, bukan menggabungkannya", () => {
    const registry = new KodeRegistry("OU-");
    expect(registry.next("Divisi QHSSE")).toBe("OU-DIVISI-QHSSE");
    expect(registry.next("DIVISI QHSSE")).toBe("OU-DIVISI-QHSSE-2");
    expect(registry.next("divisi qhsse")).toBe("OU-DIVISI-QHSSE-3");
  });
});

describe("planSeed — hierarki Unit Organisasi", () => {
  const HEADERS = [
    "Personnel Number",
    "Nama",
    "Business Unit",
    "Divisi",
    "Bagian",
    "Sub Bagian",
  ] as const;

  it("merangkai Business Unit → Divisi → Bagian → Sub Bagian", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "Direktorat Contoh",
        "Divisi Misal",
        "Bagian Uji",
        "Sub Bagian Sampel",
      ]),
    );
    expect(plan.orgUnits.map((u) => [u.nama, u.tipe])).toEqual([
      ["Direktorat Contoh", "direktorat"],
      ["Divisi Misal", "divisi"],
      ["Bagian Uji", "bagian"],
      ["Sub Bagian Sampel", "sub_bagian"],
    ]);
    expect(plan.orgUnits[0].parentKey).toBeNull();
    expect(plan.orgUnits[1].parentKey).toBe(plan.orgUnits[0].key);
    expect(plan.orgUnits[3].parentKey).toBe(plan.orgUnits[2].key);
  });

  it("selalu menaruh induk sebelum anak, supaya bisa di-insert berurutan", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "BU A", "Divisi A", "Bagian A", "Sub A"],
        ["90000002", "Siti Misal", "BU B", "Divisi B", "Bagian B", ""],
      ),
    );
    const seen = new Set<string>();
    for (const unit of plan.orgUnits) {
      if (unit.parentKey !== null) expect(seen.has(unit.parentKey)).toBe(true);
      seen.add(unit.key);
    }
  });

  it("Karyawan menunjuk unit TERENDAH", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "BU",
        "Divisi",
        "Bagian",
        "Sub Bagian Terendah",
      ]),
    );
    const lowest = plan.orgUnits.at(-1);
    expect(plan.employees[0].orgUnitKey).toBe(lowest?.key);
    expect(lowest?.nama).toBe("Sub Bagian Terendah");
  });

  it("Sub Bagian yang sama persis dengan Bagian tidak jadi simpul anak", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "BU",
        "Divisi",
        "Bagian Akuntansi",
        "Bagian Akuntansi",
      ]),
    );
    expect(plan.orgUnits.filter((u) => u.tipe === "sub_bagian")).toHaveLength(
      0,
    );
    expect(plan.orgUnits.at(-1)?.nama).toBe("Bagian Akuntansi");
    expect(plan.employees[0].orgUnitKey).toBe(plan.orgUnits.at(-1)?.key);
  });

  it("Sub Bagian yang beda kapitalisasi TETAP dibuat — itu Temuan Bereskan, bukan urusan Seed", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "BU",
        "Divisi",
        "Bagian Akuntansi",
        "BAGIAN AKUNTANSI",
      ]),
    );
    expect(plan.orgUnits.filter((u) => u.tipe === "sub_bagian")).toHaveLength(
      1,
    );
  });

  it("Bagian yang diawali Proyek bertipe proyek", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "BU",
        "Divisi",
        "Proyek Tol Contoh",
        "",
      ]),
    );
    expect(plan.orgUnits.at(-1)).toMatchObject({
      nama: "Proyek Tol Contoh",
      tipe: "proyek",
    });
  });

  it("kata Proyek di tengah nama tidak mengubah tipe", () => {
    const plan = planSeed(
      sheet(HEADERS, [
        "90000001",
        "Budi Contoh",
        "BU",
        "Divisi",
        "Bagian Proyek",
        "",
      ]),
    );
    expect(plan.orgUnits.at(-1)?.tipe).toBe("bagian");
  });

  it("melewati tingkat yang kosong dan menyambung ke tingkat terisi di atasnya", () => {
    const plan = planSeed(
      sheet(HEADERS, ["90000001", "Budi Contoh", "BU", "", "Bagian Yatim", ""]),
    );
    expect(plan.orgUnits.map((u) => u.nama)).toEqual(["BU", "Bagian Yatim"]);
    expect(plan.orgUnits[1].parentKey).toBe(plan.orgUnits[0].key);
  });

  it("Bagian bernama sama di dua Divisi berbeda tetap dua simpul", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "BU", "Divisi A", "Bagian Umum", ""],
        ["90000002", "Siti Misal", "BU", "Divisi B", "Bagian Umum", ""],
      ),
    );
    const umum = plan.orgUnits.filter((u) => u.nama === "Bagian Umum");
    expect(umum).toHaveLength(2);
    expect(umum[0].kode).not.toBe(umum[1].kode);
  });

  it("Karyawan tanpa unit sama sekali diperingatkan, bukan ditolak", () => {
    const plan = planSeed(
      sheet(HEADERS, ["90000001", "Budi Contoh", "", "", "", ""]),
    );
    expect(plan.employees).toHaveLength(1);
    expect(plan.employees[0].orgUnitKey).toBeNull();
    expect(warningsOf(plan).map((i) => i.kode)).toContain(
      "karyawan_tanpa_unit",
    );
    expect(errorsOf(plan)).toHaveLength(0);
  });
});

describe("planSeed — Data Referensi masuk apa adanya (ADR-002)", () => {
  const HEADERS = [
    "Personnel Number",
    "Nama",
    "Divisi",
    "Jabatan",
    "Gender",
  ] as const;

  it("varian kapitalisasi TIDAK digabung", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "Divisi QHSSE", "Staf Muda", "Laki-laki"],
        ["90000002", "Siti Misal", "DIVISI QHSSE", "staf muda", "Laki-Laki"],
      ),
    );
    expect(plan.orgUnits.map((u) => u.nama)).toEqual([
      "Divisi QHSSE",
      "DIVISI QHSSE",
    ]);
    expect(plan.jabatan.map((j) => j.nama)).toEqual(["Staf Muda", "staf muda"]);
    expect(plan.lookups.map((l) => l.label)).toEqual([
      "Laki-laki",
      "Laki-Laki",
    ]);
  });

  it('"dan" dan "&" TIDAK disatukan', () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        [
          "90000001",
          "Budi Contoh",
          "Divisi Keuangan dan Akuntansi",
          "Staf",
          "L",
        ],
        ["90000002", "Siti Misal", "Divisi Keuangan & Akuntansi", "Staf", "L"],
      ),
    );
    expect(plan.orgUnits).toHaveLength(2);
  });

  it("spasi di ujung DIPANGKAS, jadi satu baris saja", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "Divisi QHSSE", "Staf", "L"],
        ["90000002", "Siti Misal", "  Divisi QHSSE  ", "Staf", "L"],
      ),
    );
    expect(plan.orgUnits).toHaveLength(1);
  });

  it("spasi ganda di tengah TIDAK dipangkas", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "Divisi QHSSE", "Staf", "L"],
        ["90000002", "Siti Misal", "Divisi  QHSSE", "Staf", "L"],
      ),
    );
    expect(plan.orgUnits).toHaveLength(2);
  });

  it("memberi Lookup urutan sesuai kemunculan pertama, per tipe", () => {
    const plan = planSeed(
      sheet(
        HEADERS,
        ["90000001", "Budi Contoh", "D", "J", "Perempuan"],
        ["90000002", "Siti Misal", "D", "J", "Laki-laki"],
        ["90000003", "Agus Uji", "D", "J", "Perempuan"],
      ),
    );
    expect(plan.lookups.map((l) => [l.label, l.urutan])).toEqual([
      ["Perempuan", 1],
      ["Laki-laki", 2],
    ]);
  });

  it("Lookup dari tipe berbeda tidak saling tabrakan kodenya", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Gender", "Band Jabatan"],
        ["90000001", "Budi Contoh", "Tetap", "Tetap"],
      ),
    );
    expect(plan.lookups.map((l) => [l.tipe, l.kode])).toEqual([
      ["gender", "TETAP"],
      ["band_jabatan", "TETAP"],
    ]);
  });

  it("Karyawan tanpa Jabatan diperingatkan, bukan ditolak", () => {
    const plan = planSeed(
      sheet(HEADERS, ["90000001", "Budi Contoh", "D", "", "L"]),
    );
    expect(plan.employees[0].jabatanKey).toBeNull();
    expect(warningsOf(plan).map((i) => i.kode)).toContain(
      "karyawan_tanpa_jabatan",
    );
  });
});

describe("planSeed — baris Karyawan", () => {
  const HEADERS = [
    "Personnel Number",
    "NIP",
    "Nama",
    "Tanggal Lahir",
    "Tempat Lahir",
    "Agama",
    "Status Pernikahan",
    "Original Start Date",
    "Status",
    "Tanggal Keluar",
  ] as const;

  const ROW = [
    "90000001",
    "D100001",
    "Budi Contoh",
    45292,
    "Kota Contoh",
    "Islam",
    "Menikah",
    "05/08/2019",
    "",
    "",
  ];

  it("memetakan identitas dan tanggal", () => {
    const plan = planSeed(sheet(HEADERS, ROW));
    expect(plan.employees[0]).toMatchObject({
      baris: 5,
      personnel_number: "90000001",
      nip: "D100001",
      full_name: "Budi Contoh",
      status: "aktif",
    });
    expect(plan.employees[0].dates.original_start_date).toBe("2019-08-05");
  });

  it("Data Pribadi Sensitif dipisahkan ke employee_private (PRD #22)", () => {
    const plan = planSeed(sheet(HEADERS, ROW));
    expect(plan.employees[0].private).toEqual({
      date_of_birth: "2024-01-01",
      place_of_birth: "Kota Contoh",
      religion: "Islam",
      marital_status: "Menikah",
    });
    expect(plan.stats.karyawanDenganDataPribadi).toBe(1);
  });

  it("Personnel Number berupa angka tetap jadi teks", () => {
    const plan = planSeed(
      sheet(["Personnel Number", "Nama"], [90000001, "Budi Contoh"]),
    );
    expect(plan.employees[0].personnel_number).toBe("90000001");
  });

  it("baris kosong dilewati, bukan jadi Karyawan tanpa nama", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama"],
        ["90000001", "Budi Contoh"],
        [],
        ["", ""],
      ),
    );
    expect(plan.employees).toHaveLength(1);
    expect(plan.stats.barisKosong).toBe(2);
    expect(errorsOf(plan)).toHaveLength(0);
  });

  it("nomor baris yang dilaporkan = nomor baris di Excel", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama"],
        ["90000001", "Budi"],
        ["90000002", "Siti"],
      ),
    );
    expect(plan.employees.map((e) => e.baris)).toEqual([5, 6]);
  });

  it("mengikuti --header-row kalau header tidak di baris 4", () => {
    const rows = [
      ["Personnel Number", "Nama"],
      ["90000001", "Budi Contoh"],
    ];
    const plan = planSeed(rows, { headerRowNumber: 1 });
    expect(plan.employees).toHaveLength(1);
    expect(plan.employees[0].baris).toBe(2);
  });

  it("status 'Nonaktif' terbaca; ejaan lain diperingatkan dan jadi aktif", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Status"],
        ["90000001", "Budi Contoh", "Nonaktif"],
        ["90000002", "Siti Misal", "Non Aktif"],
        ["90000003", "Agus Uji", "resign"],
      ),
    );
    expect(plan.employees.map((e) => e.status)).toEqual([
      "nonaktif",
      "nonaktif",
      "aktif",
    ]);
    expect(warningsOf(plan).map((i) => i.kode)).toContain(
      "status_tidak_dikenal",
    );
  });

  it("dua kolom untuk tujuan yang sama: yang terisi belakangan yang dipakai", () => {
    // "Status" kosong dan "Status Karyawan" berisi "Nonaktif": Karyawan yang
    // sudah keluar tidak boleh diam-diam masuk sebagai aktif.
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Status", "Status Karyawan"],
        ["90000001", "Budi Contoh", "", "Nonaktif"],
      ),
    );
    expect(plan.employees[0].status).toBe("nonaktif");
    expect(plan.issues.map((i) => i.kode)).toContain("kolom_ganda");
  });

  it("kolom identitas kembar yang kosong tidak menutupi yang terisi", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Nama Karyawan"],
        ["90000001", "", "Budi Contoh"],
      ),
    );
    expect(errorsOf(plan)).toHaveLength(0);
    expect(plan.employees[0].full_name).toBe("Budi Contoh");
  });

  it("Tanggal Keluar pada Karyawan aktif diperingatkan, tidak ditebak", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Tanggal Keluar"],
        ["90000001", "Budi Contoh", "30/06/2025"],
      ),
    );
    expect(plan.employees[0].status).toBe("aktif");
    expect(warningsOf(plan).map((i) => i.kode)).toContain("keluar_tapi_aktif");
  });
});

describe("planSeed — yang menghentikan Seed", () => {
  it("Personnel Number kosong adalah error", () => {
    const plan = planSeed(
      sheet(["Personnel Number", "Nama"], ["", "Budi Contoh"]),
    );
    expect(errorsOf(plan).map((i) => i.kode)).toContain(
      "personnel_number_kosong",
    );
  });

  it("Nama kosong adalah error", () => {
    const plan = planSeed(
      sheet(["Personnel Number", "Nama"], ["90000001", ""]),
    );
    expect(errorsOf(plan).map((i) => i.kode)).toContain("nama_kosong");
  });

  it("Personnel Number ganda adalah error — kolomnya UNIQUE", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama"],
        ["90000001", "Budi Contoh"],
        ["90000001", "Siti Misal"],
      ),
    );
    const issue = errorsOf(plan).find(
      (i) => i.kode === "personnel_number_ganda",
    );
    expect(issue?.pesan).toContain("baris 5 dan 6");
    expect(plan.employees).toHaveLength(1);
  });

  it("NIP ganda adalah error — kolomnya UNIQUE juga", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "NIP", "Nama"],
        ["90000001", "D1", "Budi Contoh"],
        ["90000002", "D1", "Siti Misal"],
      ),
    );
    expect(errorsOf(plan).map((i) => i.kode)).toContain("nip_ganda");
  });

  it("NIP kosong di banyak baris bukan masalah", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "NIP", "Nama"],
        ["90000001", "", "Budi Contoh"],
        ["90000002", "", "Siti Misal"],
      ),
    );
    expect(errorsOf(plan)).toHaveLength(0);
    expect(plan.employees.map((e) => e.nip)).toEqual([null, null]);
  });

  it("tanggal yang tidak terbaca adalah error dan barisnya tidak diseed", () => {
    const plan = planSeed(
      sheet(
        ["Personnel Number", "Nama", "Tanggal Diangkat"],
        ["90000001", "Budi Contoh", "belum ada SK"],
      ),
    );
    const issue = errorsOf(plan).find(
      (i) => i.kode === "tanggal_tidak_terbaca",
    );
    expect(issue?.kolom).toBe("Tanggal Diangkat");
    expect(plan.employees).toHaveLength(0);
  });

  it("sheet tanpa satu pun Karyawan adalah error", () => {
    const plan = planSeed(sheet(["Personnel Number", "Nama"]));
    expect(errorsOf(plan).map((i) => i.kode)).toContain("tidak_ada_karyawan");
  });

  it("sheet kosong total tidak membuat crash", () => {
    const plan = planSeed([]);
    expect(plan.employees).toHaveLength(0);
    expect(errorsOf(plan).length).toBeGreaterThan(0);
  });
});
