/**
 * Every field of one Karyawan, grouped and already turned into text.
 *
 * This module is deliberately a PLAIN module — no `"use client"`, no JSX, no
 * hooks, no database. It is imported by `page.tsx`, a Server Component, and a
 * mapper that a Server Component imports must never live in a `"use client"`
 * file: the page would keep building and only fail in a production build.
 *
 * What it owes the page:
 *
 *   * **Names, never uuids.** Everything here reads `v_employees`, which has
 *     already resolved `org_unit_id` → nama, `jabatan_id` → nama and all
 *     eleven Lookup FKs → label (ARCHITECTURE.md §3). No uuid is ever rendered.
 *   * **Derived columns marked as derived (PRD #6).** Usia, masa kerja and
 *     masa sejak promosi PG/JG are computed — never stored — so nothing on
 *     this page offers to edit them. `turunan: true` is what draws the
 *     "dihitung otomatis" mark.
 *   * **`*_bulan` is the RESIDUAL month count (0–11), not a total** (ADR-005
 *     §10). `formatMasa()` is the only thing that renders them, so the trap is
 *     sprung in exactly one place.
 *   * **The same Indonesian wording as the log.** Labels come from
 *     `columnLabel()` in `components/revisions/revisionDiff.ts`, the map the
 *     Riwayat Revisi panel right below uses for its diff. A column must not
 *     change its name between the panel and the field it describes.
 */
import {
  columnLabel,
  formatTanggal,
} from "@/components/revisions/revisionDiff";
import type { DetailField } from "@/components/shared/DetailCard";
import {
  computeMasaJg,
  computeMasaKerja,
  computeMasaPg,
  computeMasaSejakDiangkat,
  computeUsia,
  formatMasa,
  formatUsia,
  KOSONG,
  type DateInput,
} from "@/lib/derived";
import { ORG_UNIT_TYPE_LABELS, STATUS_LABELS } from "@/lib/i18n/terms";
import type { EmployeePrivate, VEmployee } from "@/lib/types/db";
import {
  LOOKUP_TYPE_LABELS,
  type LookupType,
} from "@/lib/validation/lookupTypes";

/**
 * One row of a definition list.
 *
 * Defined once, next to the card that renders it
 * (`components/shared/DetailCard.tsx`), and re-exported here so the callers and
 * the test that already import it from this module keep working. A type-only
 * re-export, so nothing from a `.tsx` is pulled into this plain module.
 */
export type { DetailField };

export type DetailSection = {
  /** Stable key for React and for anchor links. */
  id: string;
  judul: string;
  /** One line explaining the group, when it is not self-evident. */
  keterangan?: string;
  fields: readonly DetailField[];
};

/** `null` and `""` read as the same dash, on every page (`lib/derived`). */
function teks(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? KOSONG : trimmed;
}

/**
 * A `date` column: "14 Sep 2026", or the dash.
 *
 * Through `formatTanggal`, never `new Date()`: "1980-02-29" parsed as UTC
 * midnight is still the 28th in half the world, and a birthday must not move.
 */
function tanggal(value: string | null | undefined): string {
  return value ? formatTanggal(value) : KOSONG;
}

/**
 * Kalimat penanda untuk jenjang Unit Organisasi.
 *
 * Bukan kalimat bawaan penanda turunan, yang berbunyi "dihitung dari tanggal"
 * — itu benar untuk usia dan masa kerja, dan salah untuk hierarki.
 */
const TURUNAN_HIERARKI =
  "Diturunkan dari hierarki Unit Organisasi, bukan diisi di baris Karyawan. Untuk mengubahnya, pindahkan unitnya di halaman Struktur Organisasi — dan perubahannya berlaku untuk semua orang di bawahnya.";

/** Label of an `employees` column, worded as the log words it. */
function labelKolom(column: string): string {
  return columnLabel("employees", column);
}

/*
  KODE DATA REFERENSI TIDAK DITAMPILKAN DI SINI.

  Dulu tiap Lookup, Unit Organisasi, dan Jabatan membawa satu baris kecil
  "Kode FEMALE" di bawah "Female". Kode-nya memang diturunkan dari labelnya,
  jadi hampir selalu ia hanya mengeja ulang baris di atasnya dengan huruf
  besar — tiga belas baris abu-abu di satu halaman yang tidak menjawab
  pertanyaan siapa pun tentang orang ini.

  Yang hilang, dan kenapa itu tidak apa-apa: kalau dua Lookup punya label yang
  sama persis, halaman ini tidak lagi bisa memberi tahu yang mana. Tapi itu
  memang Temuan — halaman Perlu Dibereskan yang mendaftarnya dan Merge yang
  membereskannya (PRD #11/#12), bukan halaman ini. Dan untuk siapa pun yang
  memang butuh kodenya — integrasi Konsumen API, atau mencocokkan dengan
  Excel — kodenya tetap ada di halaman detail Data Referensi-nya sendiri
  (/master-data/[id], /jabatan/[id], /struktur/[id]), tempat kode itu adalah
  identitas barangnya dan bukan catatan kaki.
*/

/**
 * One Lookup, read from the view's resolved `<tipe>_label` / `<tipe>_kode`.
 *
 * Keyed off `LookupType` so the eleven types cannot drift apart from
 * `lib/validation/lookupTypes.ts` — a new tipe there is a type error here.
 */
function lookupField(employee: VEmployee, tipe: LookupType): DetailField {
  return {
    label: LOOKUP_TYPE_LABELS[tipe],
    value: teks(employee[`${tipe}_label`]),
  };
}

/** `org_units.tipe` → "Sub Bagian". An unknown value is shown as it is. */
export function labelTipeUnit(tipe: string | null | undefined): string {
  if (!tipe) return KOSONG;
  return (
    ORG_UNIT_TYPE_LABELS[tipe as keyof typeof ORG_UNIT_TYPE_LABELS] ?? tipe
  );
}

/** `employees.status` → "Nonaktif". */
export function labelStatus(status: string | null | undefined): string {
  if (status === "aktif" || status === "nonaktif") return STATUS_LABELS[status];
  return teks(status);
}

/**
 * The unit chain from the top down, as one line: "Direktorat A › Divisi B".
 *
 * A Karyawan points at the LOWEST unit only; everything above it is derived by
 * the view from the hierarchy (CLAUDE.md). Empty levels are dropped here,
 * because a chain printed with gaps reads as a broken chain — the per-level
 * fields in the Penempatan section still show every level, dash included.
 */
export function rantaiUnit(employee: VEmployee): string {
  const chain = [
    employee.direktorat_nama,
    employee.divisi_nama,
    employee.departemen_nama,
    employee.bagian_nama,
    employee.sub_bagian_nama,
    employee.proyek_nama,
  ].filter(
    (nama): nama is string => typeof nama === "string" && nama.trim() !== "",
  );
  return chain.length > 0 ? chain.join(" › ") : KOSONG;
}

/**
 * Unit Organisasi small print: tingkatnya saja — "Sub Bagian".
 *
 * Tingkat BUKAN ejaan ulang namanya: "Bagian Human Capital Strategy" kebetulan
 * memuat katanya, "Proyek Tol Trans Sumatera" tidak, dan tingkat itulah yang
 * menentukan di mana unit ini duduk di hierarki. Kode-nya yang dicabut; lihat
 * catatan di atas.
 */
function catatanUnit(employee: VEmployee): string | undefined {
  if (!employee.org_unit_nama || !employee.org_unit_tipe) return undefined;
  return labelTipeUnit(employee.org_unit_tipe);
}

/**
 * Every field of a Karyawan, in the order the page shows them.
 *
 * `asOf` exists so a caller can pin "today"; left out, it is pinned ONCE here
 * rather than per field. All four masa values are computed from that single
 * instant — see the Masa Kerja field for why they are computed at all instead
 * of read off the view.
 */
export function buildEmployeeSections(
  employee: VEmployee,
  asOf?: DateInput,
): DetailSection[] {
  const saatIni: DateInput = asOf ?? new Date();

  return [
    {
      id: "identitas",
      judul: "Identitas",
      fields: [
        { label: labelKolom("full_name"), value: teks(employee.full_name) },
        {
          label: labelKolom("personnel_number"),
          value: teks(employee.personnel_number),
          info: "Business key — kode yang dipakai Konsumen lewat API.",
        },
        { label: labelKolom("nip"), value: teks(employee.nip) },
        {
          label: labelKolom("email_kantor"),
          value: teks(employee.email_kantor),
          info: "Alamat kantor, bukan akun login HC Core. Ikut keluar lewat API — aplikasi lain memakainya untuk mencocokkan orang ini dengan akunnya di sistem mereka.",
        },
        lookupField(employee, "gender"),
        { label: labelKolom("status"), value: labelStatus(employee.status) },
      ],
    },
    {
      id: "penempatan",
      judul: "Penempatan",
      keterangan:
        "Karyawan menunjuk satu Unit Organisasi terendah; jenjang di atasnya diturunkan dari hierarki, bukan disimpan di baris Karyawan.",
      fields: [
        {
          label: labelKolom("org_unit_id"),
          value: teks(employee.org_unit_nama),
          catatan: catatanUnit(employee),
        },
        {
          label: labelKolom("jabatan_id"),
          value: teks(employee.jabatan_nama),
        },
        /*
          KEENAM JENJANG INI DITURUNKAN, BUKAN DIISI.

          Karyawan menunjuk SATU Unit Organisasi terendah; Direktorat sampai
          Proyek dibaca `v_employees` dari hierarki `org_units`
          (ARCHITECTURE.md §3). Karena itu keenamnya tidak punya isian di form
          Ubah — dan tanpa penanda, halaman ini memajang enam kolom yang
          terlihat persis seperti kolom yang bisa diisi, lalu formnya cuma
          punya satu. Pertanyaan "kenapa Departemen tidak ada isiannya?" lahir
          di situ.

          "—" pada Departemen juga bukan data yang hilang: unit orang itu
          memang menggantung langsung di bawah Divisi, tanpa jenjang
          Departemen di antaranya.
        */
        ...[
          [ORG_UNIT_TYPE_LABELS.direktorat, employee.direktorat_nama],
          [ORG_UNIT_TYPE_LABELS.divisi, employee.divisi_nama],
          [ORG_UNIT_TYPE_LABELS.departemen, employee.departemen_nama],
          [ORG_UNIT_TYPE_LABELS.bagian, employee.bagian_nama],
          [ORG_UNIT_TYPE_LABELS.sub_bagian, employee.sub_bagian_nama],
          [ORG_UNIT_TYPE_LABELS.proyek, employee.proyek_nama],
        ].map(([label, nama]) => ({
          label: label as string,
          value: teks(nama as string | null),
          turunan: TURUNAN_HIERARKI,
        })),
      ],
    },
    {
      id: "grade",
      judul: "Grade & Band",
      fields: [
        lookupField(employee, "person_grade"),
        lookupField(employee, "job_grade"),
        lookupField(employee, "band_jabatan"),
        lookupField(employee, "bod_range"),
        lookupField(employee, "kategori_penempatan"),
        lookupField(employee, "kategori_fungsi"),
      ],
    },
    {
      id: "kepegawaian",
      judul: "Kepegawaian",
      fields: [
        lookupField(employee, "work_contract"),
        lookupField(employee, "legal_entity"),
        lookupField(employee, "klasifikasi_rekrutmen"),
        lookupField(employee, "teknik_non_teknik"),
        { label: labelKolom("jurusan"), value: teks(employee.jurusan) },
      ],
    },
    {
      id: "masa",
      judul: "Tanggal & Masa Kerja",
      keterangan:
        "Masa kerja dan masa sejak promosi dihitung dari tanggal di sebelahnya — tidak pernah disimpan, jadi tidak pernah basi (PRD #6).",
      fields: [
        {
          label: labelKolom("original_start_date"),
          value: tanggal(employee.original_start_date),
        },
        {
          label: "Masa Kerja",
          /**
           * All four masa on this card are computed here, from one `saatIni`,
           * rather than half of them being read off `v_employees`.
           *
           * Not because the view is wrong — `lib/derived/pgAge.ts` is a
           * faithful port of Postgres's `age()` and `lib/derived/sql.test.ts`
           * checks the two against a real database — but because the view can
           * only supply half of them. `masa_pg_tahun` and `masa_jg_tahun` are
           * WHOLE YEARS ONLY, so a promotion eleven months ago reads as "0
           * tahun" there. Mixing the two sources on one card would also mean
           * mixing two clocks: the view answers `age(current_date, …)` on the
           * Postgres session's calendar day, this answers on the Node
           * process's. They are the same day on Vercel and in Supabase (both
           * UTC), but on a deployment where they are not, the card would
           * contradict itself on an anniversary. One source, one instant.
           *
           * The tahun/bulan pair is whole years plus the RESIDUAL months
           * (0–11), never a total — the trap ADR-005 §10 warns about, sprung
           * here and nowhere else on the page.
           */
          value: formatMasa(
            computeMasaKerja(employee.original_start_date, saatIni),
          ),
          turunan: true,
        },
        {
          label: labelKolom("tanggal_diangkat"),
          value: tanggal(employee.tanggal_diangkat),
        },
        {
          label: "Masa Sejak Diangkat",
          value: formatMasa(
            computeMasaSejakDiangkat(employee.tanggal_diangkat, saatIni),
          ),
          turunan: true,
        },
        {
          label: labelKolom("tanggal_promosi_pg"),
          value: tanggal(employee.tanggal_promosi_pg),
          catatan: employee.nomor_surat_pg
            ? `${labelKolom("nomor_surat_pg")}: ${employee.nomor_surat_pg}`
            : undefined,
        },
        {
          label: "Masa Sejak Promosi PG",
          value: formatMasa(
            computeMasaPg(employee.tanggal_promosi_pg, saatIni),
          ),
          turunan: true,
        },
        {
          label: labelKolom("tanggal_promosi_jg"),
          value: tanggal(employee.tanggal_promosi_jg),
          // `nomor_surat_pg` and `nomor_surat_jg` come from two Excel columns
          // whose headers were identical. Two fields, never merged (CLAUDE.md).
          catatan: employee.nomor_surat_jg
            ? `${labelKolom("nomor_surat_jg")}: ${employee.nomor_surat_jg}`
            : undefined,
        },
        {
          label: "Masa Sejak Promosi JG",
          value: formatMasa(
            computeMasaJg(employee.tanggal_promosi_jg, saatIni),
          ),
          turunan: true,
        },
        {
          label: labelKolom("tanggal_keluar"),
          value: tanggal(employee.tanggal_keluar),
          catatan:
            employee.status === "nonaktif" && !employee.tanggal_keluar
              ? "Karyawan sudah nonaktif tetapi tanggal keluarnya belum diisi."
              : undefined,
        },
      ],
    },
    {
      id: "keterangan",
      judul: "Keterangan",
      fields: [
        {
          label: labelKolom("keterangan_pj_plt"),
          value: teks(employee.keterangan_pj_plt),
        },
        // Rangkap 1 and Rangkap 2 likewise come from two Excel columns that
        // shared one header. Two fields, two values (CLAUDE.md).
        {
          label: labelKolom("keterangan_rangkap_1"),
          value: teks(employee.keterangan_rangkap_1),
        },
        {
          label: labelKolom("keterangan_rangkap_2"),
          value: teks(employee.keterangan_rangkap_2),
        },
        {
          label: labelKolom("keterangan"),
          value: teks(employee.keterangan),
          lebar: true,
        },
      ],
    },
  ];
}

/**
 * Data Pribadi Sensitif (PRD #22) — admin only.
 *
 * `row` is `null` for a viewer (RLS filtered it out) and for an admin whose
 * Karyawan simply has nothing filled in; both render as dashes. The CALLER
 * decides whether to draw this at all — a viewer must not even see the
 * heading. The page never reads `v_employees_private`, whose INNER JOIN hands
 * a viewer zero rows: that would be an empty page rather than a page without
 * this panel (ADR-005 §10).
 */
export function buildPrivateFields(
  row: EmployeePrivate | null,
  asOf?: DateInput,
): DetailField[] {
  const label = (column: string) => columnLabel("employee_private", column);
  return [
    { label: label("date_of_birth"), value: tanggal(row?.date_of_birth) },
    {
      label: "Usia",
      value: formatUsia(computeUsia(row?.date_of_birth, asOf)),
      turunan: true,
    },
    { label: label("place_of_birth"), value: teks(row?.place_of_birth) },
    { label: label("religion"), value: teks(row?.religion) },
    { label: label("marital_status"), value: teks(row?.marital_status) },
  ];
}

/** True when every field is empty — "belum diisi", not "tidak boleh dilihat". */
export function semuaKosong(fields: readonly DetailField[]): boolean {
  return fields.every((field) => field.value === KOSONG);
}
