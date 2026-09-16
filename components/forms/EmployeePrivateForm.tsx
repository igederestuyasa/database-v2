"use client";

/**
 * Data Pribadi Sensitif (PRD #22) — admin saja.
 *
 * Empat kolom yang tinggal di tabelnya sendiri, `employee_private`: agama,
 * tanggal dan tempat lahir, status pernikahan. Semuanya boleh kosong, hanya
 * admin yang boleh membaca maupun menulisnya (RLS), dan tidak satu pun pernah
 * keluar lewat `/api/v1` — `v_employees_api` memang tidak memuatnya
 * (ARCHITECTURE.md §3).
 *
 * **Kenapa ini form yang terpisah, bukan satu Simpan bersama data di atas.**
 * Tabelnya lain, jadi statement-nya lain, jadi Batch-nya lain (ADR-006). Satu
 * tombol Simpan yang menulis ke dua tabel akan mengirim dua permintaan
 * PostgREST, yaitu dua transaksi dan dua Batch juga — hanya dengan tampilan
 * seolah-olah satu tindakan, sehingga "kembalikan Batch ini" di Log Perubahan
 * cuma membatalkan separuhnya. Dipisah begini, yang terlihat di layar sama
 * dengan yang tercatat di log.
 *
 * Ketiga kolom teks memang teks bebas, bukan Lookup: agama dan status
 * pernikahan ditulis sebagaimana tertera di dokumen kependudukan, dan
 * `employeePrivateSchema` yang beku memperlakukannya begitu. Ini bukan
 * pelanggaran ADR-002 — yang wajib dipilih dari daftar adalah kolom referensi
 * di `employees`, yang memang punya tabel daftarnya.
 */
import * as React from "react";

import {
  KELAS_ISIAN,
  BidangLabel,
  BidangBantuan,
  BidangPesan,
} from "@/components/hc/Bidang";
import Tombol from "@/components/hc/Tombol";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";

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
  FormField,
  FormItem,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { updateEmployeePrivate } from "@/lib/actions/employees";
import { computeUsia, formatUsia, KOSONG } from "@/lib/derived";
import { TERMS, UI } from "@/lib/i18n/terms";
import { formatZodErrors } from "@/lib/validation/common";
import { employeePrivateSchema } from "@/lib/validation/employee";

export type EmployeePrivateFormValues = {
  date_of_birth: string;
  place_of_birth: string;
  religion: string;
  marital_status: string;
};

const FIELD_NAMES = [
  "date_of_birth",
  "place_of_birth",
  "religion",
  "marital_status",
] as const satisfies readonly (keyof EmployeePrivateFormValues)[];

type PrivateFieldName = (typeof FIELD_NAMES)[number];

function isFieldName(name: string): name is PrivateFieldName {
  return (FIELD_NAMES as readonly string[]).includes(name);
}

/** Schema beku yang sama dengan Server Action-nya (ARCHITECTURE.md §1). */
const resolver: Resolver<EmployeePrivateFormValues> = async (values) => {
  const parsed = employeePrivateSchema.safeParse(values);
  if (parsed.success) return { values, errors: {} };

  const { fieldErrors } = formatZodErrors(parsed.error);
  const errors: FieldErrors<EmployeePrivateFormValues> = {};
  for (const [name, message] of Object.entries(fieldErrors)) {
    if (isFieldName(name)) errors[name] = { type: "validation", message };
  }
  return { values: {}, errors };
};

export type EmployeePrivateFormProps = {
  employeeId: string;
  /**
   * Baris `employee_private` yang sekarang, atau `null` kalau belum ada.
   *
   * Baris kosongnya dibuat otomatis oleh trigger saat Karyawan ditambahkan,
   * jadi `null` di sini praktis hanya berarti "belum pernah diisi".
   */
  privateData: {
    date_of_birth: string | null;
    place_of_birth: string | null;
    religion: string | null;
    marital_status: string | null;
  } | null;
};

export function EmployeePrivateForm({
  employeeId,
  privateData,
}: EmployeePrivateFormProps) {
  const router = useRouter();

  const form = useForm<EmployeePrivateFormValues>({
    resolver,
    defaultValues: {
      date_of_birth: privateData?.date_of_birth ?? "",
      place_of_birth: privateData?.place_of_birth ?? "",
      religion: privateData?.religion ?? "",
      marital_status: privateData?.marital_status ?? "",
    },
  });

  /**
   * Tanggal lahir yang diketik separuh.
   *
   * Browser melaporkannya sebagai `value === ""`, persis sama dengan kolom
   * yang memang dikosongkan; hanya `validity.badInput` yang membedakannya.
   *
   * Dua penyimpanan untuk satu fakta, dan keduanya perlu: Chromium tidak
   * memancarkan event `input`/`change` sama sekali selama tanggalnya belum
   * lengkap, jadi satu-satunya kabar datang saat blur — dan blur itu terjadi
   * pada `mousedown` tombol Simpan, sesaat sebelum `click`-nya. State melayani
   * yang terlihat; ref-lah yang dibaca saat memutuskan, supaya penjaga di
   * dalam `submit` tidak membaca nilai dari render sebelum blur tadi.
   */
  const [tanggalBelumLengkap, setTanggalBelumLengkap] = React.useState(false);
  const tanggalBelumLengkapRef = React.useRef(false);

  const catatBadInput = React.useCallback((input: HTMLInputElement) => {
    const bad = input.validity?.badInput ?? false;
    tanggalBelumLengkapRef.current = bad;
    setTanggalBelumLengkap(bad);
  }, []);

  /**
   * Usia adalah kolom turunan (PRD #6): dihitung, tidak pernah disimpan.
   *
   * Baru dihitung setelah komponen terpasang di browser, karena hasilnya
   * bergantung pada "hari ini" — dan tanggal hari ini di server (UTC) berbeda
   * dengan di browser penggunanya (WIB) selama tujuh jam setiap hari, cukup
   * untuk membuat render server dan render klien tidak cocok.
   */
  const [siap, setSiap] = React.useState(false);
  React.useEffect(() => setSiap(true), []);

  const tanggalLahir = form.watch("date_of_birth");
  const usia = siap ? formatUsia(computeUsia(tanggalLahir || null)) : KOSONG;

  const submit = form.handleSubmit(async (values) => {
    // Ref, bukan state — lihat catatan di atas.
    if (tanggalBelumLengkapRef.current) {
      toast.error(
        "Tanggal lahir belum lengkap. Lengkapi atau kosongkan dulu — kalau dibiarkan, isinya tersimpan sebagai kosong.",
      );
      return;
    }

    const result = await updateEmployeePrivate({ id: employeeId, ...values });

    if (!result.ok) {
      for (const [name, message] of Object.entries(result.error.fieldErrors ?? {})) {
        if (isFieldName(name)) form.setError(name, { type: "server", message });
      }
      toast.error(result.error.message);
      return;
    }

    toast.success(`${TERMS.dataPribadiSensitif} disimpan.`);
    form.reset({
      date_of_birth: result.data.date_of_birth ?? "",
      place_of_birth: result.data.place_of_birth ?? "",
      religion: result.data.religion ?? "",
      marital_status: result.data.marital_status ?? "",
    });
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TERMS.dataPribadiSensitif}</CardTitle>
        <CardDescription>
          Hanya admin yang bisa melihat dan mengubah bagian ini, dan isinya
          tidak pernah keluar lewat API (PRD #22). Boleh dikosongkan.
          Disimpan terpisah dari data di atas, jadi di Log Perubahan ia muncul
          sebagai perubahan tersendiri — itu memang bentuknya, bukan kesalahan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <BidangLabel>Tanggal Lahir</BidangLabel>
                    <FormControl>
                      <Input className={KELAS_ISIAN}
                        {...field}
                        type="date"
                        aria-invalid={tanggalBelumLengkap || undefined}
                        onChange={(event) => {
                          catatBadInput(event.currentTarget);
                          field.onChange(event.currentTarget.value);
                        }}
                        onBlur={(event) => {
                          // Satu-satunya kabar untuk tanggal yang belum
                          // lengkap: `change` tidak pernah terpancar untuknya.
                          catatBadInput(event.currentTarget);
                          field.onBlur();
                        }}
                      />
                    </FormControl>
                    <BidangBantuan>Usia dihitung dari sini: {usia}.</BidangBantuan>
                    {tanggalBelumLengkap ? (
                      <p className="text-sm font-medium text-destructive">
                        Tanggal belum lengkap. Lengkapi atau kosongkan — kalau
                        dibiarkan seperti ini, yang tersimpan adalah kosong.
                      </p>
                    ) : null}
                    <BidangPesan />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="place_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <BidangLabel>Tempat Lahir</BidangLabel>
                    <FormControl>
                      <Input className={KELAS_ISIAN} {...field} autoComplete="off" placeholder="mis. Surabaya" />
                    </FormControl>
                    <BidangPesan />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="religion"
                render={({ field }) => (
                  <FormItem>
                    <BidangLabel>Agama</BidangLabel>
                    <FormControl>
                      <Input className={KELAS_ISIAN} {...field} autoComplete="off" />
                    </FormControl>
                    <BidangBantuan>
                      Ditulis apa adanya sesuai dokumen, bukan dipilih dari daftar.
                    </BidangBantuan>
                    <BidangPesan />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="marital_status"
                render={({ field }) => (
                  <FormItem>
                    <BidangLabel>Status Pernikahan</BidangLabel>
                    <FormControl>
                      <Input className={KELAS_ISIAN} {...field} autoComplete="off" />
                    </FormControl>
                    <BidangPesan />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Tombol
                type="submit"
                disabled={form.formState.isSubmitting || tanggalBelumLengkap}
              >
                {form.formState.isSubmitting
                  ? "Menyimpan…"
                  : `${UI.simpan} ${TERMS.dataPribadiSensitif}`}
              </Tombol>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default EmployeePrivateForm;
