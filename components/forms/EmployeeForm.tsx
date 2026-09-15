"use client";

/**
 * Form Tambah / Ubah Karyawan (PRD #3 dan #4).
 *
 * Empat aturan yang membentuk seluruh berkas ini:
 *
 *   * **Kolom referensi dipilih dari daftar, tidak pernah diketik** (PRD #4,
 *     ADR-002). Unit Organisasi, Jabatan, dan kesebelas kolom Lookup semuanya
 *     memakai `EntityPicker`, yang memang menolak teks bebas: kotak ketiknya
 *     menyaring daftar, tidak pernah menjadi nilainya. Itulah yang menjaga
 *     "Divisi QHSSE" tidak bertambah satu ejaan setiap kali ada yang mengisi
 *     form.
 *   * **Karyawan menunjuk unit TERENDAH.** Tidak ada isian Direktorat, Divisi,
 *     Departemen, atau Bagian di sini — semuanya diturunkan `v_employees` dari
 *     hierarki `org_units` (ARCHITECTURE.md §3). Menambahkannya berarti
 *     menyalin hierarki ke baris Karyawan, dan rename unit tidak akan pernah
 *     merambat lagi.
 *   * **Kolom turunan tidak bisa diedit** (PRD #6). Usia, masa kerja, dan masa
 *     sejak promosi PG/JG tidak punya kolom di tabel `employees`; keduanya
 *     dihitung `v_employees` dan `lib/derived/`. Yang ditampilkan di bawah
 *     hanya hasil hitungan dari tanggal yang sedang diisi — pratinjau, bukan
 *     isian.
 *   * **Status tidak diatur dari sini.** Menonaktifkan seorang Karyawan wajib
 *     disertai tanggal keluar (PRD #5), jadi tempatnya dialog tersendiri
 *     (`EmployeeStatusDialog`) dan bukan sebuah kotak centang yang bisa
 *     tergeser tanpa sengaja saat memperbaiki ejaan nama.
 *
 * Data Pribadi Sensitif (PRD #22) juga tidak ada di sini: tabelnya lain, jadi
 * statement-nya lain, jadi Batch-nya lain (ADR-006). Lihat
 * `EmployeePrivateForm`.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  useForm,
  type Control,
  type FieldErrors,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";

import { EntityPicker, type EntityOption } from "@/components/shared/EntityPicker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import type { EmployeeRingkas } from "@/lib/actions/employees";
import {
  computeMasaJg,
  computeMasaKerja,
  computeMasaPg,
  computeMasaSejakDiangkat,
  formatMasa,
  KOSONG,
} from "@/lib/derived";
import { TERMS, UI } from "@/lib/i18n/terms";
import type { Employee } from "@/lib/types/db";
import { formatZodErrors } from "@/lib/validation/common";
import { employeeFieldsSchema } from "@/lib/validation/employee";
import type { EmployeeCreateInput } from "@/lib/validation/employee";
import { LOOKUP_TYPE_LABELS, type LookupType } from "@/lib/validation/lookupTypes";

/**
 * Kolom yang benar-benar diisi manusia.
 *
 * `status` dan `tanggal_keluar` sengaja dibuang dari schema beku: keduanya
 * hanya bergerak lewat `deactivateEmployee()` / `reactivateEmployee()`, yang
 * memastikan tanggal keluar dan status selalu cocok (PRD #5).
 */
const employeeFormSchema = employeeFieldsSchema.omit({
  status: true,
  tanggal_keluar: true,
});

export type EmployeeFormValues = {
  personnel_number: string;
  nip: string;
  full_name: string;
  org_unit_id: string | null;
  jabatan_id: string | null;
  gender_id: string | null;
  work_contract_id: string | null;
  person_grade_id: string | null;
  job_grade_id: string | null;
  legal_entity_id: string | null;
  klasifikasi_rekrutmen_id: string | null;
  teknik_non_teknik_id: string | null;
  bod_range_id: string | null;
  band_jabatan_id: string | null;
  kategori_penempatan_id: string | null;
  kategori_fungsi_id: string | null;
  keterangan_pj_plt: string;
  keterangan_rangkap_1: string;
  keterangan_rangkap_2: string;
  keterangan: string;
  jurusan: string;
  original_start_date: string;
  tanggal_diangkat: string;
  tanggal_promosi_pg: string;
  tanggal_promosi_jg: string;
  nomor_surat_pg: string;
  nomor_surat_jg: string;
};

/**
 * Setiap kolom yang form ini tulis, dan **hanya** itu.
 *
 * Diekspor supaya bisa diuji terhadap katalog kolom asli
 * (`lib/schema/columns.generated.ts`): nama field yang salah ketik di sini
 * lolos TypeScript kalau tipe barisnya ikut salah, dan tidak terlihat oleh
 * `check:columns` karena tidak ada `.select()` yang memuatnya.
 */
export const EMPLOYEE_FORM_FIELDS = [
  "personnel_number",
  "nip",
  "full_name",
  "org_unit_id",
  "jabatan_id",
  "gender_id",
  "work_contract_id",
  "person_grade_id",
  "job_grade_id",
  "legal_entity_id",
  "klasifikasi_rekrutmen_id",
  "teknik_non_teknik_id",
  "bod_range_id",
  "band_jabatan_id",
  "kategori_penempatan_id",
  "kategori_fungsi_id",
  "keterangan_pj_plt",
  "keterangan_rangkap_1",
  "keterangan_rangkap_2",
  "keterangan",
  "jurusan",
  "original_start_date",
  "tanggal_diangkat",
  "tanggal_promosi_pg",
  "tanggal_promosi_jg",
  "nomor_surat_pg",
  "nomor_surat_jg",
] as const satisfies readonly (keyof EmployeeFormValues)[];

type EmployeeFieldName = (typeof EMPLOYEE_FORM_FIELDS)[number];

function isFieldName(name: string): name is EmployeeFieldName {
  return (EMPLOYEE_FORM_FIELDS as readonly string[]).includes(name);
}

/** `null`/`undefined` dari database menjadi `""` untuk sebuah `<input>`. */
function teks(value: string | null | undefined): string {
  return value ?? "";
}

/**
 * Isi awal form, dari satu baris `employees` (atau kosong untuk Karyawan baru).
 *
 * Murni, dan diekspor untuk diuji: inilah tempat sebuah kolom bisa hilang
 * tanpa suara. Kolom yang lupa dipetakan di sini akan tampil kosong di layar,
 * dan karena form mengirim seluruh isinya saat Simpan, yang kosong itu
 * benar-benar menghapus isi kolomnya di database.
 *
 * `status` dan `tanggal_keluar` tidak ada di sini, dan itu disengaja: keduanya
 * milik `EmployeeStatusDialog` (PRD #5). Lihat catatan di berkas itu.
 */
export function nilaiAwalEmployeeForm(employee?: Employee): EmployeeFormValues {
  return {
    personnel_number: teks(employee?.personnel_number),
    nip: teks(employee?.nip),
    full_name: teks(employee?.full_name),
    org_unit_id: employee?.org_unit_id ?? null,
    jabatan_id: employee?.jabatan_id ?? null,
    gender_id: employee?.gender_id ?? null,
    work_contract_id: employee?.work_contract_id ?? null,
    person_grade_id: employee?.person_grade_id ?? null,
    job_grade_id: employee?.job_grade_id ?? null,
    legal_entity_id: employee?.legal_entity_id ?? null,
    klasifikasi_rekrutmen_id: employee?.klasifikasi_rekrutmen_id ?? null,
    teknik_non_teknik_id: employee?.teknik_non_teknik_id ?? null,
    bod_range_id: employee?.bod_range_id ?? null,
    band_jabatan_id: employee?.band_jabatan_id ?? null,
    kategori_penempatan_id: employee?.kategori_penempatan_id ?? null,
    kategori_fungsi_id: employee?.kategori_fungsi_id ?? null,
    keterangan_pj_plt: teks(employee?.keterangan_pj_plt),
    keterangan_rangkap_1: teks(employee?.keterangan_rangkap_1),
    keterangan_rangkap_2: teks(employee?.keterangan_rangkap_2),
    keterangan: teks(employee?.keterangan),
    jurusan: teks(employee?.jurusan),
    original_start_date: teks(employee?.original_start_date),
    tanggal_diangkat: teks(employee?.tanggal_diangkat),
    tanggal_promosi_pg: teks(employee?.tanggal_promosi_pg),
    tanggal_promosi_jg: teks(employee?.tanggal_promosi_jg),
    nomor_surat_pg: teks(employee?.nomor_surat_pg),
    nomor_surat_jg: teks(employee?.nomor_surat_jg),
  };
}

/**
 * Isi form menjadi muatan `createEmployee()`.
 *
 * Dua kolom yang selalu ditambahkan dan tidak pernah berasal dari layar:
 * Karyawan baru selalu `aktif` dan tidak punya tanggal keluar. Keduanya hanya
 * bergerak lewat `EmployeeStatusDialog` (PRD #5), dan `updateEmployee()`
 * menolak keduanya secara terbuka.
 */
export function payloadTambahKaryawan(
  values: EmployeeFormValues,
): EmployeeCreateInput {
  return { ...values, status: "aktif", tanggal_keluar: null };
}

/**
 * Opsi nonaktif tidak bisa dipilih — kecuali yang memang sedang terpakai.
 *
 * Daftar pilihan sengaja dimuat dengan `status: "semua"` supaya nilai yang
 * sudah tersimpan selalu punya barisnya (data seed kotor: ada Karyawan yang
 * menunjuk unit atau Lookup yang kemudian dinonaktifkan). Tapi "supaya yang
 * lama tetap terbaca" bukan "boleh dipakai untuk yang baru": menempatkan
 * Karyawan baru ke {@link EntityOption} nonaktif menghasilkan baris yang tidak
 * dianggap Temuan oleh halaman Perlu Dibereskan (referensinya ada, hanya
 * nonaktif) sekaligus melanggar janji `deactivateOrgUnit()`, yang menolak
 * menonaktifkan unit yang masih berisi Karyawan aktif. Jadi yang nonaktif
 * tetap tampil — dicoret, supaya jelas kenapa — tapi tidak bisa dipilih.
 */
export function pilihanYangBolehDipilih(
  options: readonly EntityOption[],
  terpilih: string | null,
): EntityOption[] {
  return options.map((option) =>
    option.status === "nonaktif" && option.id !== terpilih
      ? { ...option, disabled: true }
      : option,
  );
}

/**
 * Validasi form memakai schema yang sama dengan Server Action
 * (ARCHITECTURE.md §1) — satu aturan, dua tempat.
 *
 * Ditulis tangan, bukan `zodResolver`, karena setiap field di
 * `lib/validation/common.ts` dibungkus `z.preprocess`, sehingga tipe *input*
 * schema-nya runtuh menjadi `unknown` dan menyeret seluruh tipe field
 * react-hook-form ikut runtuh. Pola ini sama dengan `OrgUnitForm`.
 *
 * Yang dikembalikan saat sukses adalah `values` mentah, bukan `parsed.data`:
 * hasil parse sudah dipangkas dan `""`-nya sudah menjadi `null`, dan
 * menuliskannya kembali ke form akan mengubah apa yang sedang diketik orang.
 * Server Action mem-parse ulang input yang sama dan memakai versi yang sudah
 * dirapikan itu untuk menulis.
 */
const resolver: Resolver<EmployeeFormValues> = async (values) => {
  const parsed = employeeFormSchema.safeParse(values);
  if (parsed.success) return { values, errors: {} };

  const { fieldErrors } = formatZodErrors(parsed.error);
  const errors: FieldErrors<EmployeeFormValues> = {};
  for (const [name, message] of Object.entries(fieldErrors)) {
    if (isFieldName(name)) errors[name] = { type: "validation", message };
  }
  return { values: {}, errors };
};

/** Semua daftar pilihan, sudah dipetakan di server. */
export type EmployeeFormOptionSets = {
  orgUnit: readonly EntityOption[];
  jabatan: readonly EntityOption[];
  lookup: Record<LookupType, readonly EntityOption[]>;
};

export type EmployeeFormProps = {
  /** `"tambah"` menyisipkan baris baru; `"ubah"` menyimpan `employee`. */
  mode: "tambah" | "ubah";
  /** Baris `employees` mentah (FK id, bukan label). Wajib untuk `"ubah"`. */
  employee?: Employee;
  options: EmployeeFormOptionSets;
};

export function EmployeeForm({ mode, employee, options }: EmployeeFormProps) {
  const router = useRouter();
  const [sedangMuatUlang, mulaiMuatUlang] = React.useTransition();

  /**
   * Tanggal yang diketik separuh.
   *
   * Sebuah `<input type="date">` yang isinya belum lengkap ("31/02/2025", atau
   * hari dan bulan tanpa tahun) melaporkan `value === ""` — persis sama dengan
   * kolom yang memang dikosongkan. Tanpa penanda ini, "saya sudah mengetik
   * tanggalnya" dan "kosongkan kolom ini" tidak bisa dibedakan, dan yang
   * tersimpan adalah yang kedua. `validity.badInput` adalah satu-satunya hal
   * yang membedakan keduanya, jadi setiap kolom tanggal melaporkannya ke sini
   * dan form menolak disimpan selama masih ada yang menyala.
   *
   * Disimpan dua kali — sebuah state untuk yang terlihat (spanduk peringatan,
   * tombol Simpan yang mati) dan sebuah ref untuk yang memutuskan. Bukan
   * kemubaziran: Chromium **tidak memancarkan event `input`/`change` sama
   * sekali** untuk tanggal yang belum lengkap (dibuktikan di browser), jadi
   * satu-satunya kabar datang saat blur — dan blur itu terjadi pada `mousedown`
   * tombol Simpan, satu tarikan napas sebelum `click`-nya. Kalau penjaga di
   * dalam `submit` membaca state, ia membaca nilai dari render SEBELUM blur
   * itu, yaitu `false`, dan tanggal separuh tadi tersimpan sebagai kosong.
   * Sebuah ref selalu terbaca versi terbarunya, apa pun urutan render-nya.
   */
  const [tanggalBelumLengkap, setTanggalBelumLengkap] = React.useState<
    Partial<Record<EmployeeFieldName, boolean>>
  >({});
  const tanggalBelumLengkapRef = React.useRef<
    Partial<Record<EmployeeFieldName, boolean>>
  >({});

  const catatBadInput = React.useCallback(
    (name: EmployeeFieldName, belumLengkap: boolean) => {
      tanggalBelumLengkapRef.current = {
        ...tanggalBelumLengkapRef.current,
        [name]: belumLengkap,
      };
      setTanggalBelumLengkap((sebelumnya) =>
        Boolean(sebelumnya[name]) === belumLengkap
          ? sebelumnya
          : { ...sebelumnya, [name]: belumLengkap },
      );
    },
    [],
  );

  const adaTanggalBelumLengkap = Object.values(tanggalBelumLengkap).some(Boolean);

  const form = useForm<EmployeeFormValues>({
    resolver,
    defaultValues: nilaiAwalEmployeeForm(employee),
  });

  const selesai = (data: EmployeeRingkas) => {
    toast.success(
      mode === "tambah"
        ? `${TERMS.karyawan} "${data.full_name}" ditambahkan.`
        : `Perubahan pada "${data.full_name}" disimpan.`,
    );
    // Form-nya ditinggalkan, jadi tidak perlu `form.reset()`: halaman detail
    // adalah tempat perubahan itu terbaca, lengkap dengan Riwayat Revisi-nya.
    router.push(`/karyawan/${data.id}`);
    router.refresh();
  };

  const submit = form.handleSubmit(async (values) => {
    // Ref, bukan state — lihat catatan di atas.
    if (Object.values(tanggalBelumLengkapRef.current).some(Boolean)) {
      toast.error(
        "Masih ada kolom tanggal yang belum lengkap. Lengkapi atau kosongkan dulu — kalau dibiarkan, isinya tersimpan sebagai kosong.",
      );
      return;
    }

    const result =
      mode === "tambah"
        ? await createEmployee(payloadTambahKaryawan(values))
        : await updateEmployee({ id: employee?.id ?? "", ...values });

    if (!result.ok) {
      for (const [name, message] of Object.entries(result.error.fieldErrors ?? {})) {
        if (isFieldName(name)) form.setError(name, { type: "server", message });
      }
      toast.error(result.error.message);
      return;
    }

    selesai(result.data);
  });

  const control = form.control;

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Kolom bertanda daftar dipilih dari {TERMS.dataReferensi}, tidak
            diketik bebas. Nilai baru dibuat dulu di halaman {TERMS.masterData},{" "}
            {TERMS.jabatan}, atau Struktur Organisasi.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sedangMuatUlang}
            onClick={() => mulaiMuatUlang(() => router.refresh())}
          >
            {sedangMuatUlang ? UI.sedangMemuat : "Muat ulang daftar pilihan"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Identitas</CardTitle>
            <CardDescription>
              {TERMS.personnelNumber} adalah kunci bisnis {TERMS.karyawan} —
              kode inilah yang dipakai {TERMS.konsumen} untuk merujuk seseorang.{" "}
              {TERMS.nip} adalah kode kedua yang berbeda, dan boleh kosong.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={control}
              name="personnel_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{TERMS.personnelNumber}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus={mode === "tambah"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="mis. 10012345"
                    />
                  </FormControl>
                  <FormDescription>
                    {mode === "ubah"
                      ? `Wajib dan unik. ${TERMS.konsumen} merujuk ${TERMS.karyawan} lewat kode ini, jadi ubah hanya kalau memang salah ketik — aplikasi lain yang menyimpannya harus ikut menyesuaikan.`
                      : "Wajib dan unik. Dipakai selamanya untuk merujuk orang ini."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="nip"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{TERMS.nip}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="boleh kosong"
                    />
                  </FormControl>
                  <FormDescription>
                    Boleh kosong, tapi kalau diisi harus unik.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="full_name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Nama Lengkap</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus={mode === "ubah"}
                      autoComplete="off"
                      placeholder="mis. Budi Santoso"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PickerField
              control={control}
              name="gender_id"
              label={LOOKUP_TYPE_LABELS.gender}
              options={options.lookup.gender}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <FormField
              control={control}
              name="jurusan"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Jurusan</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" placeholder="mis. Teknik Sipil" />
                  </FormControl>
                  <FormDescription>
                    Di Excel sumber kolom ini VLOOKUP dari sheet lain, jadi saat
                    Seed ia sengaja dibiarkan kosong dan diisi manual di sini.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Penempatan</CardTitle>
            <CardDescription>
              {TERMS.karyawan} menunjuk {TERMS.unitOrganisasi}{" "}
              <strong>terendah</strong> tempatnya ditempatkan. Direktorat,
              Divisi, Departemen, dan Bagian tidak diisi di sini — semuanya
              diturunkan dari hierarki, sehingga mengganti nama sebuah unit
              langsung berlaku untuk semua orang di bawahnya.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <PickerField
              control={control}
              name="org_unit_id"
              label={TERMS.unitOrganisasi}
              options={options.orgUnit}
              tujuanBaru="/struktur"
              labelHalamanBaru="Struktur Organisasi"
              description="Pilih unit paling bawah (Sub Bagian atau Proyek kalau ada), bukan Divisi-nya."
            />

            <PickerField
              control={control}
              name="jabatan_id"
              label={TERMS.jabatan}
              options={options.jabatan}
              tujuanBaru="/jabatan"
              labelHalamanBaru={TERMS.jabatan}
              description={`${TERMS.jabatan} adalah nama pekerjaan yang boleh dipegang banyak orang sekaligus, bukan kursi.`}
            />

            <PickerField
              control={control}
              name="band_jabatan_id"
              label={LOOKUP_TYPE_LABELS.band_jabatan}
              options={options.lookup.band_jabatan}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <PickerField
              control={control}
              name="bod_range_id"
              label={LOOKUP_TYPE_LABELS.bod_range}
              options={options.lookup.bod_range}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <PickerField
              control={control}
              name="kategori_penempatan_id"
              label={LOOKUP_TYPE_LABELS.kategori_penempatan}
              options={options.lookup.kategori_penempatan}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <PickerField
              control={control}
              name="kategori_fungsi_id"
              label={LOOKUP_TYPE_LABELS.kategori_fungsi}
              options={options.lookup.kategori_fungsi}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <FormField
              control={control}
              name="keterangan_pj_plt"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Keterangan PJ / PLT</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/*
              Dua kolom rangkap, dan keduanya tetap terpisah selamanya: di Excel
              sumber, dua kolom ini punya header yang sama persis, dan
              menggabungkannya berarti membuang salah satunya (CLAUDE.md).
            */}
            <FormField
              control={control}
              name="keterangan_rangkap_1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keterangan Rangkap 1</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormDescription>
                    Kolom pertama dari dua kolom &laquo;Keterangan Rangkap&raquo;
                    di Excel sumber. Tidak digabung dengan yang kedua.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="keterangan_rangkap_2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keterangan Rangkap 2</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormDescription>
                    Kolom kedua, berdiri sendiri.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kepegawaian</CardTitle>
            <CardDescription>
              Semuanya dipilih dari {TERMS.masterData}. Kalau nilai yang benar
              belum ada di daftar, tambahkan dulu di sana — bukan dengan
              mengetiknya di sini.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <PickerField
              control={control}
              name="work_contract_id"
              label={LOOKUP_TYPE_LABELS.work_contract}
              options={options.lookup.work_contract}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />
            <PickerField
              control={control}
              name="legal_entity_id"
              label={LOOKUP_TYPE_LABELS.legal_entity}
              options={options.lookup.legal_entity}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />
            <PickerField
              control={control}
              name="klasifikasi_rekrutmen_id"
              label={LOOKUP_TYPE_LABELS.klasifikasi_rekrutmen}
              options={options.lookup.klasifikasi_rekrutmen}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />
            <PickerField
              control={control}
              name="teknik_non_teknik_id"
              label={LOOKUP_TYPE_LABELS.teknik_non_teknik}
              options={options.lookup.teknik_non_teknik}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
              description="Di Excel sumber kolom ini VLOOKUP dari sheet lain, jadi sesudah Seed sering masih kosong."
            />

            <TanggalField
              control={control}
              name="original_start_date"
              label="Original Start Date"
              description="Tanggal mulai bekerja. Dasar perhitungan masa kerja."
              onBadInput={catatBadInput}
            />
            <TanggalField
              control={control}
              name="tanggal_diangkat"
              label="Tanggal Diangkat"
              description="Tanggal diangkat sebagai karyawan tetap, bukan tanggal pertama masuk."
              onBadInput={catatBadInput}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grade &amp; Promosi</CardTitle>
            <CardDescription>
              Person Grade dan Job Grade dipilih dari {TERMS.masterData}.
              Tanggal dan nomor surat promosi PG dan JG adalah dua hal yang
              berbeda dan disimpan terpisah.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <PickerField
              control={control}
              name="person_grade_id"
              label={LOOKUP_TYPE_LABELS.person_grade}
              options={options.lookup.person_grade}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />
            <PickerField
              control={control}
              name="job_grade_id"
              label={LOOKUP_TYPE_LABELS.job_grade}
              options={options.lookup.job_grade}
              tujuanBaru="/master-data"
              labelHalamanBaru={TERMS.masterData}
            />

            <TanggalField
              control={control}
              name="tanggal_promosi_pg"
              label="Tanggal Promosi PG"
              onBadInput={catatBadInput}
            />
            <FormField
              control={control}
              name="nomor_surat_pg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nomor Surat PG</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" spellCheck={false} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <TanggalField
              control={control}
              name="tanggal_promosi_jg"
              label="Tanggal Promosi JG"
              onBadInput={catatBadInput}
            />
            <FormField
              control={control}
              name="nomor_surat_jg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nomor Surat JG</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" spellCheck={false} />
                  </FormControl>
                  <FormDescription>
                    Nomor surat JG berdiri sendiri, tidak digabung dengan nomor
                    surat PG.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Keterangan</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={control}
              name="keterangan"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keterangan</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} placeholder="Catatan bebas." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <KolomTurunan form={form} />

        {adaTanggalBelumLengkap ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            Ada kolom tanggal yang belum lengkap. Lengkapi atau kosongkan dulu:
            kolom tanggal yang separuh terisi dibaca browser sebagai kosong, dan
            kalau disimpan begitu isinya benar-benar hilang.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={form.formState.isSubmitting}
            onClick={() =>
              router.push(employee ? `/karyawan/${employee.id}` : "/karyawan")
            }
          >
            {UI.batal}
          </Button>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || adaTanggalBelumLengkap}
          >
            {form.formState.isSubmitting
              ? "Menyimpan…"
              : mode === "tambah"
                ? `${UI.simpan} ${TERMS.karyawan}`
                : UI.simpan}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Potongan yang dipakai berulang
 * ──────────────────────────────────────────────────────────────────────────── */

type PickerFieldProps = {
  control: Control<EmployeeFormValues>;
  /** Hanya kolom FK yang boleh dipasangi picker. */
  name: Extract<
    EmployeeFieldName,
    | "org_unit_id"
    | "jabatan_id"
    | "gender_id"
    | "work_contract_id"
    | "person_grade_id"
    | "job_grade_id"
    | "legal_entity_id"
    | "klasifikasi_rekrutmen_id"
    | "teknik_non_teknik_id"
    | "bod_range_id"
    | "band_jabatan_id"
    | "kategori_penempatan_id"
    | "kategori_fungsi_id"
  >;
  label: string;
  options: readonly EntityOption[];
  /** Halaman tempat nilai baru dibuat (ADR-002). */
  tujuanBaru: string;
  labelHalamanBaru: string;
  description?: string;
};

/**
 * Satu kolom referensi: dipilih dari daftar, tidak pernah diketik (ADR-002).
 *
 * "Tambah baru" membuka halaman referensinya di tab baru, bukan di tab ini.
 * Kalau ia menavigasi tab ini, seluruh isian yang belum disimpan hilang —
 * dan yang paling sering menemukan Jabatan belum ada justru orang yang sedang
 * mengisi form panjang ini. Setelah nilai barunya dibuat, tombol "Muat ulang
 * daftar pilihan" di atas menyegarkan daftarnya tanpa mengosongkan form.
 */
function PickerField({
  control,
  name,
  label,
  options,
  tujuanBaru,
  labelHalamanBaru,
  description,
}: PickerFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <EntityPicker
              options={pilihanYangBolehDipilih(options, field.value)}
              value={field.value}
              onChange={field.onChange}
              placeholder={`Pilih ${label}…`}
              searchPlaceholder={`${UI.cari} ${label}…`}
              emptyMessage={`Tidak ada ${label} yang cocok. Tambahkan dulu di halaman ${labelHalamanBaru}.`}
              createNewLabel={`Tambah di halaman ${labelHalamanBaru} (tab baru)…`}
              onCreateNew={() => window.open(tujuanBaru, "_blank", "noopener")}
              aria-label={label}
              invalid={Boolean(fieldState.error)}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type TanggalFieldProps = {
  control: Control<EmployeeFormValues>;
  name: Extract<
    EmployeeFieldName,
    | "original_start_date"
    | "tanggal_diangkat"
    | "tanggal_promosi_pg"
    | "tanggal_promosi_jg"
  >;
  label: string;
  description?: string;
  onBadInput: (name: EmployeeFieldName, belumLengkap: boolean) => void;
};

/**
 * Satu kolom tanggal, yang mengaku kalau isinya belum lengkap.
 *
 * `<input type="date">` dipilih daripada teks bebas karena ia menjamin format
 * `YYYY-MM-DD` yang diminta kolom `date` dan API-CONTRACT. Harganya satu:
 * isian yang belum lengkap dilaporkan sebagai `""`, tidak bisa dibedakan dari
 * kolom yang memang dikosongkan — masalah yang sama persis dengan
 * `<input type="number">` dan `1e`. `validity.badInput` membedakannya, jadi
 * setiap perubahan melaporkannya ke form induk, yang menolak menyimpan selama
 * masih ada yang menyala.
 */
function TanggalField({
  control,
  name,
  label,
  description,
  onBadInput,
}: TanggalFieldProps) {
  const [belumLengkap, setBelumLengkap] = React.useState(false);

  const periksa = (input: HTMLInputElement) => {
    const bad = input.validity?.badInput ?? false;
    setBelumLengkap(bad);
    onBadInput(name, bad);
  };

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type="date"
              value={field.value}
              aria-invalid={belumLengkap || undefined}
              onChange={(event) => {
                periksa(event.currentTarget);
                field.onChange(event.currentTarget.value);
              }}
              onBlur={(event) => {
                periksa(event.currentTarget);
                field.onBlur();
              }}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          {belumLengkap ? (
            <p className="text-sm font-medium text-destructive">
              Tanggal belum lengkap. Lengkapi atau kosongkan — kalau dibiarkan
              seperti ini, yang tersimpan adalah kosong.
            </p>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Pratinjau kolom turunan (PRD #6) — dibaca, tidak pernah diisi.
 *
 * Tidak ada satu pun dari angka ini yang disimpan: `v_employees` menghitungnya
 * di SQL, `lib/derived/` menghitung hal yang sama di TypeScript (dan diuji
 * agar keduanya sepakat sampai ke harinya). Yang ditampilkan di sini dihitung
 * dari tanggal yang sedang diisi, supaya keliru ketik tahun langsung terlihat
 * sebelum disimpan.
 *
 * Baru dihitung setelah komponen terpasang di browser: hasilnya bergantung
 * pada "hari ini", dan server (UTC) bisa berada di tanggal yang berbeda dengan
 * browser penggunanya (WIB) selama tujuh jam setiap hari — cukup untuk membuat
 * render server dan render klien berbeda.
 */
function KolomTurunan({ form }: { form: UseFormReturn<EmployeeFormValues> }) {
  const [siap, setSiap] = React.useState(false);
  React.useEffect(() => setSiap(true), []);

  const originalStartDate = form.watch("original_start_date");
  const tanggalDiangkat = form.watch("tanggal_diangkat");
  const tanggalPromosiPg = form.watch("tanggal_promosi_pg");
  const tanggalPromosiJg = form.watch("tanggal_promosi_jg");

  const baris = React.useMemo(() => {
    // Sebelum terpasang di browser semuanya "—": hasilnya bergantung pada
    // tanggal hari ini, dan tanggal hari ini di server belum tentu sama dengan
    // di browser penggunanya.
    if (!siap) {
      return [
        { label: "Masa kerja", nilai: KOSONG },
        { label: "Masa sejak diangkat", nilai: KOSONG },
        { label: "Masa sejak promosi PG", nilai: KOSONG },
        { label: "Masa sejak promosi JG", nilai: KOSONG },
      ];
    }
    return [
      {
        label: "Masa kerja",
        nilai: formatMasa(computeMasaKerja(originalStartDate || null)),
      },
      {
        label: "Masa sejak diangkat",
        nilai: formatMasa(computeMasaSejakDiangkat(tanggalDiangkat || null)),
      },
      {
        label: "Masa sejak promosi PG",
        nilai: formatMasa(computeMasaPg(tanggalPromosiPg || null)),
      },
      {
        label: "Masa sejak promosi JG",
        nilai: formatMasa(computeMasaJg(tanggalPromosiJg || null)),
      },
    ];
  }, [siap, originalStartDate, tanggalDiangkat, tanggalPromosiPg, tanggalPromosiJg]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kolom turunan</CardTitle>
        <CardDescription>
          Dihitung otomatis dari tanggal di atas dan <strong>tidak disimpan</strong>,
          jadi tidak ada yang bisa diedit di sini (PRD #6). Usia ikut dihitung,
          tapi hanya untuk admin — tanggal lahir ada di{" "}
          {TERMS.dataPribadiSensitif}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2">
          {baris.map((item) => (
            <div key={item.label} className="rounded-md border bg-muted/30 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-sm font-medium">{item.nilai}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default EmployeeForm;
