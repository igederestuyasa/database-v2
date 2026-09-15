"use server";

/**
 * Server Actions untuk Karyawan (PRD #3, #4, #5, dan sisi tulis #22).
 *
 * Bentuknya mengikuti enam langkah `lib/actions/_reference.ts`: validasi zod
 * dengan schema yang sama seperti form → `requireAdmin()` → baca baris
 * sekarang → tulis **satu** statement langsung → `revalidatePath()` →
 * kembalikan `ActionResult`, tidak pernah melempar.
 *
 * Tiga hal yang membentuk seluruh file ini:
 *
 *   * **Satu tindakan, satu statement, tanpa Batch yang dibuka dari sini**
 *     (ADR-006). Setiap action di bawah menulis persis satu baris, jadi
 *     trigger `log_revision` yang membuat Batch-nya — dan Batch itulah yang
 *     memuat Revisi-nya. Konsekuensinya di `/log`: semuanya muncul sebagai
 *     Batch `edit` berketerangan umum, karena `jenis` `create`/`deactivate`
 *     hanya pernah ditulis fungsi RPC dan tidak ada satu pun untuk Karyawan.
 *     Yang membedakan "ditambahkan" dari "dinonaktifkan" bukan judul Batch-nya
 *     melainkan `revisions.action` dan kolom `status` di `before`/`after`.
 *
 *   * **Data Pribadi Sensitif adalah tabel lain, jadi Batch lain** (PRD #22).
 *     `updateEmployeePrivate()` menulis `employee_private`, dan itu memang
 *     tidak bisa digabungkan dengan tulisan ke `employees` tanpa melanggar
 *     ADR-006 — dua tabel berarti dua statement, dan dua statement lewat
 *     PostgREST berarti dua transaksi. Formnya pun dipisah supaya yang terjadi
 *     di `/log` sesuai dengan yang dilakukan admin: dua penyimpanan, dua Batch.
 *
 *   * **Tidak ada DELETE.** Karyawan yang keluar ditandai `status =
 *     'nonaktif'` beserta `tanggal_keluar` (PRD #5), dan bisa diaktifkan
 *     kembali. Barisnya tetap ada selamanya, sehingga Revisi lama dan
 *     Konsumen yang menyimpan id-nya tetap bisa diselesaikan.
 *
 * Kolom turunan (usia, masa kerja, masa sejak promosi PG/JG) tidak pernah
 * muncul di file ini: kolomnya memang tidak ada di tabel `employees` — semua
 * dihitung `v_employees` dan `lib/derived/` (PRD #6).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getEmployeePrivate,
  getEmployeeRowById,
  isNipTaken,
  isPersonnelNumberTaken,
} from "@/lib/db/employees";
import { DbError, type DbClient } from "@/lib/db/shared";
import type { Employee, EmployeePrivate } from "@/lib/types/db";
import { uuidField } from "@/lib/validation/common";
import {
  employeeCreateSchema,
  employeeDeactivateSchema,
  employeePrivateSchema,
  employeeReactivateSchema,
  employeeUpdateSchema,
  type EmployeeCreateInput,
  type EmployeeDeactivateInput,
  type EmployeeReactivateInput,
  type EmployeeUpdateInput,
} from "@/lib/validation/employee";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionResult,
} from "./_guard";

/** Baris Karyawan seadanya yang dikembalikan ke UI setelah sebuah tulisan. */
export type EmployeeRingkas = {
  id: string;
  personnel_number: string;
  nip: string | null;
  full_name: string;
  status: string;
  tanggal_keluar: string | null;
};

/** Data Pribadi Sensitif seadanya, tanpa `created_at`/`updated_at`. */
export type EmployeePrivateRingkas = {
  employee_id: string;
  date_of_birth: string | null;
  place_of_birth: string | null;
  religion: string | null;
  marital_status: string | null;
};

const RETURNING =
  "id, personnel_number, nip, full_name, status, tanggal_keluar";

const RETURNING_PRIVATE =
  "employee_id, date_of_birth, place_of_birth, religion, marital_status";

/**
 * Kolom `employees` yang boleh digeser `updateEmployee()`, urut migration.
 *
 * **`status` dan `tanggal_keluar` sengaja TIDAK di sini, keduanya.** Keduanya
 * satu pasang: PRD #5 adalah "menandai nonaktif **beserta tanggal keluar**",
 * dan pasangan itu hanya bisa dijaga kalau satu pintu menulis keduanya
 * sekaligus. Kalau salah satunya boleh lewat sini, sebuah edit biasa bisa
 * menghasilkan Karyawan aktif yang memegang tanggal keluar (atau nonaktif
 * tanpa tanggal) — persis keadaan "beda cerita" yang tidak bisa dibedakan
 * dari data seed yang kotor, dan tidak ada CHECK di database yang
 * menahannya. Pintunya `deactivateEmployee()` / `reactivateEmployee()`;
 * `updateEmployee()` menolak keduanya secara terbuka, bukan mengabaikannya
 * diam-diam.
 */
const EDITABLE_COLUMNS = [
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
  // Dua kolom terpisah, selamanya: header Excel-nya kembar, dan menggabungkan
  // keduanya menghilangkan data (CLAUDE.md).
  "keterangan_rangkap_1",
  "keterangan_rangkap_2",
  "keterangan",
  "jurusan",
  "original_start_date",
  "tanggal_diangkat",
  "tanggal_promosi_pg",
  "tanggal_promosi_jg",
  // Sama seperti keterangan_rangkap: dua nomor surat yang berbeda.
  "nomor_surat_pg",
  "nomor_surat_jg",
] as const satisfies readonly (keyof Employee)[];

type EditableColumn = (typeof EDITABLE_COLUMNS)[number];

/**
 * Apa yang boleh masuk ke `UPDATE employees SET …`.
 *
 * `status` dan `tanggal_keluar` ikut di tipe ini karena memang ada yang
 * menulisnya — tetapi hanya `deactivateEmployee()` dan `reactivateEmployee()`,
 * yang selalu mengisi keduanya bersamaan. `buildEmployeePatch()`, yang melayani
 * form ubah, tidak pernah menyentuh keduanya.
 */
type EmployeePatch = Partial<
  Pick<Employee, EditableColumn | "status" | "tanggal_keluar">
>;

/** Kolom `employee_private` yang boleh digeser (PRD #22). Semua nullable. */
const PRIVATE_COLUMNS = [
  "date_of_birth",
  "place_of_birth",
  "religion",
  "marital_status",
] as const satisfies readonly (keyof EmployeePrivate)[];

type PrivateColumn = (typeof PRIVATE_COLUMNS)[number];
type EmployeePrivatePatch = Partial<Pick<EmployeePrivate, PrivateColumn>>;

/**
 * Data Pribadi Sensitif + id Karyawan yang memilikinya.
 *
 * `employeePrivateSchema` beku dan sengaja tidak memuat `id` — ia
 * menggambarkan isi satu baris `employee_private`, bukan sebuah permintaan.
 * Yang ditambahkan di sini hanya alamat barisnya.
 */
const employeePrivateUpdateSchema = employeePrivateSchema.extend({
  id: uuidField("Karyawan"),
});

export type EmployeePrivateUpdateInput = z.infer<
  typeof employeePrivateUpdateSchema
>;

/**
 * Setiap halaman yang ikut basi ketika satu Karyawan berubah.
 *
 * `/struktur` masuk daftar karena pohon unit menampilkan jumlah Karyawan aktif
 * per unit — memindahkan satu orang menggeser dua angka di sana. `/bereskan`
 * karena "Karyawan tanpa Unit Organisasi atau Jabatan" adalah Temuan (PRD
 * #11): mengisi unit yang kosong membereskan Temuan, mengosongkannya membuat
 * Temuan baru. `/log` karena setiap tulisan di sini menambah satu Batch.
 */
function revalidateEmployeePages(id?: string): void {
  revalidatePath("/karyawan");
  if (id) {
    revalidatePath(`/karyawan/${id}`);
    revalidatePath(`/karyawan/${id}/edit`);
  }
  revalidatePath("/struktur");
  revalidatePath("/bereskan");
  revalidatePath("/log");
}

function ringkas(row: {
  id: string;
  personnel_number: string;
  nip: string | null;
  full_name: string;
  status: string;
  tanggal_keluar: string | null;
}): EmployeeRingkas {
  return {
    id: row.id,
    personnel_number: row.personnel_number,
    nip: row.nip,
    full_name: row.full_name,
    status: row.status,
    tanggal_keluar: row.tanggal_keluar,
  };
}

function ringkasPrivate(row: {
  employee_id: string;
  date_of_birth: string | null;
  place_of_birth: string | null;
  religion: string | null;
  marital_status: string | null;
}): EmployeePrivateRingkas {
  return {
    employee_id: row.employee_id,
    date_of_birth: row.date_of_birth,
    place_of_birth: row.place_of_birth,
    religion: row.religion,
    marital_status: row.marital_status,
  };
}

/**
 * Kolom mana yang benar-benar bergerak.
 *
 * Dua keputusan yang tidak boleh ditukar:
 *
 *   * **Yang menentukan "dikirim atau tidak" adalah input mentah, bukan hasil
 *     zod.** Di `employeeUpdateSchema` setiap kolom opsional berakhir di
 *     `.default(null)`, jadi hasil parse tidak bisa membedakan "kolom ini
 *     tidak dikirim" dari "kosongkan kolom ini". Membaca `input[kolom] ===
 *     undefined` lebih dulu adalah satu-satunya cara sebuah form parsial tidak
 *     menghapus sebelas Lookup yang tidak ia tampilkan. Pola yang sama dipakai
 *     `lib/actions/orgUnits.ts` untuk `parent_id`.
 *   * **Yang ditulis adalah hasil zod, bukan input mentah.** Nilai itu sudah
 *     dipangkas spasinya dan `""`-nya sudah menjadi `null`, sehingga "Divisi
 *     QHSSE " tidak pernah masuk sebagai nama yang berbeda.
 *
 * Kolom yang nilainya sama dengan sekarang dibuang: `log_revision` memang
 * mengabaikan update yang hanya menggeser `updated_at`, tapi patch yang
 * ramping juga membuat `before`/`after` sebuah Revisi hanya memuat yang
 * benar-benar berubah.
 */
function buildEmployeePatch(
  input: EmployeeUpdateInput,
  parsed: EmployeeUpdateInput,
  current: Employee,
): EmployeePatch {
  const patch: EmployeePatch = {};

  for (const column of EDITABLE_COLUMNS) {
    if (input[column] === undefined) continue;

    const next = parsed[column] ?? null;
    if (next === (current[column] ?? null)) continue;

    // Setiap kolom di EDITABLE_COLUMNS bertipe `string | null` di ketiga sisi
    // (input, hasil parse, baris sekarang); satu cast di sini menggantikan 28
    // cabang yang mengatakan hal yang sama.
    (patch as Record<EditableColumn, string | null>)[column] = next;
  }

  return patch;
}

/**
 * `updateEmployee()` tidak menggeser pasangan status ↔ tanggal keluar.
 *
 * Ditolak, bukan didiamkan: sebuah Server Action adalah pintu yang bisa
 * dipanggil siapa pun yang sudah admin, dan mengabaikan kolom yang dikirim
 * seseorang tanpa mengatakan apa-apa akan terbaca sebagai "tersimpan". Nilai
 * yang sama dengan yang sekarang tetap lolos — form yang mengirim seluruh
 * barisnya apa adanya tidak boleh ikut tertolak.
 */
function tolakPerubahanStatus(
  input: EmployeeUpdateInput,
  parsed: EmployeeUpdateInput,
  current: Employee,
): void {
  if (
    input.status !== undefined &&
    parsed.status !== undefined &&
    parsed.status !== current.status
  ) {
    throw new ActionError(
      "VALIDASI",
      "Status Karyawan tidak diubah lewat form ubah. Pakai Nonaktifkan (beserta tanggal keluar) atau Aktifkan kembali.",
      { status: "Diatur lewat Nonaktifkan / Aktifkan kembali." },
    );
  }

  if (
    input.tanggal_keluar !== undefined &&
    (parsed.tanggal_keluar ?? null) !== (current.tanggal_keluar ?? null)
  ) {
    throw new ActionError(
      "VALIDASI",
      "Tanggal keluar tidak diubah lewat form ubah. Pakai Nonaktifkan, yang selalu mengisi status dan tanggal keluar sekaligus.",
      { tanggal_keluar: "Diatur lewat Nonaktifkan / Aktifkan kembali." },
    );
  }
}

/**
 * Status dan tanggal keluar harus menceritakan hal yang sama.
 *
 * Dipakai `createEmployee()`, yang schema-nya memang memperbolehkan keduanya
 * diisi bebas. Karyawan nonaktif tanpa tanggal keluar tidak bisa dibedakan
 * dari data seed yang belum dibereskan (PRD #5), dan Karyawan aktif yang
 * memegang tanggal keluar membuat setiap daftar aktif terbaca salah. Tidak ada
 * CHECK di database yang menahan keduanya, jadi di sinilah tempatnya.
 */
function tolakPasanganStatus(
  status: string,
  tanggalKeluar: string | null,
): void {
  if (status === "nonaktif" && !tanggalKeluar) {
    throw new ActionError(
      "VALIDASI",
      "Karyawan nonaktif harus punya tanggal keluar (PRD #5).",
      { tanggal_keluar: "Wajib diisi untuk Karyawan nonaktif." },
    );
  }
  if (status !== "nonaktif" && tanggalKeluar) {
    throw new ActionError(
      "VALIDASI",
      "Karyawan yang aktif tidak punya tanggal keluar. Kosongkan tanggalnya, atau tandai Karyawan ini nonaktif.",
      { tanggal_keluar: "Hanya untuk Karyawan nonaktif." },
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Tambah Karyawan (PRD #3).
 *
 * Satu INSERT. Trigger `employees_autocreate_private` membuat baris
 * `employee_private` kosong untuk orang ini di transaksi yang sama, jadi Data
 * Pribadi Sensitif tidak perlu — dan tidak boleh — di-insert dari sini.
 */
export async function createEmployee(
  input: EmployeeCreateInput,
): Promise<ActionResult<EmployeeRingkas>> {
  const parsed = employeeCreateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const values = parsed.data;

  try {
    const { client } = await requireAdmin();

    tolakPasanganStatus(values.status, values.tanggal_keluar);
    await guardKunciBisnis(client, values.personnel_number, values.nip, null);

    const { data, error } = await client
      .from("employees")
      .insert(values)
      .select(RETURNING)
      .single();

    if (error) throw new DbError("Gagal menambah Karyawan", error);

    revalidateEmployeePages(data.id);
    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Ubah Karyawan (PRD #4).
 *
 * Kolom yang tidak dikirim dibiarkan apa adanya, kolom yang dikirim `null`
 * dikosongkan — lihat `buildEmployeePatch()`. `status` dan `tanggal_keluar`
 * tidak bisa digeser dari sini sama sekali: keduanya satu pasang, dan
 * pintunya `deactivateEmployee()` / `reactivateEmployee()`.
 */
export async function updateEmployee(
  input: EmployeeUpdateInput,
): Promise<ActionResult<EmployeeRingkas>> {
  const parsed = employeeUpdateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getEmployeeRowById(client, id);
    if (!current) {
      throw new ActionError(
        "TIDAK_DITEMUKAN",
        "Karyawan tidak ditemukan. Mungkin barisnya baru saja berubah — muat ulang halaman.",
      );
    }

    tolakPerubahanStatus(input, parsed.data, current);

    const patch = buildEmployeePatch(input, parsed.data, current);

    // Tidak ada yang bergerak: berhenti sebelum menulis, supaya Log Perubahan
    // tidak berisi Batch yang tidak mencatat apa pun.
    if (Object.keys(patch).length === 0) return actionOk(ringkas(current));

    if (patch.personnel_number !== undefined || patch.nip !== undefined) {
      await guardKunciBisnis(
        client,
        patch.personnel_number ?? current.personnel_number,
        patch.nip !== undefined ? patch.nip : current.nip,
        id,
      );
    }

    // SATU statement. Tidak ada Batch yang dibuka di sekitarnya (ADR-006).
    const { data, error } = await client
      .from("employees")
      .update(patch)
      .eq("id", id)
      .select(RETURNING)
      .single();

    if (error) throw new DbError("Gagal menyimpan Karyawan", error);

    revalidateEmployeePages(id);
    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Nonaktifkan Karyawan beserta tanggal keluar (PRD #5).
 *
 * Tidak pernah DELETE (ARCHITECTURE.md §6). Boleh dijalankan ulang pada
 * Karyawan yang sudah nonaktif — itulah cara memperbaiki tanggal keluar yang
 * salah ketik, tanpa perlu mengaktifkannya kembali dulu.
 */
export async function deactivateEmployee(
  input: EmployeeDeactivateInput,
): Promise<ActionResult<EmployeeRingkas>> {
  const parsed = employeeDeactivateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, tanggal_keluar: tanggalKeluar } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getEmployeeRowById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Karyawan tidak ditemukan.");
    }

    const patch: EmployeePatch = {};
    if (current.status !== "nonaktif") patch.status = "nonaktif";
    if (current.tanggal_keluar !== tanggalKeluar) {
      patch.tanggal_keluar = tanggalKeluar;
    }
    // `keterangan` hanya ikut kalau dialognya memang mengirimnya; kalau tidak,
    // keterangan yang sudah ada tidak boleh terhapus sebagai efek samping
    // penonaktifan.
    if (input.keterangan !== undefined) {
      const keterangan = parsed.data.keterangan ?? null;
      if (keterangan !== (current.keterangan ?? null)) {
        patch.keterangan = keterangan;
      }
    }

    if (Object.keys(patch).length === 0) return actionOk(ringkas(current));

    const { data, error } = await client
      .from("employees")
      .update(patch)
      .eq("id", id)
      .select(RETURNING)
      .single();

    if (error) throw new DbError("Gagal menonaktifkan Karyawan", error);

    revalidateEmployeePages(id);
    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Aktifkan kembali Karyawan (kebalikan PRD #5).
 *
 * `tanggal_keluar` ikut dikosongkan: seseorang yang aktif tidak punya tanggal
 * keluar, dan meninggalkannya terisi membuat daftar Karyawan aktif berisi
 * orang yang tampak sudah pergi.
 */
export async function reactivateEmployee(
  input: EmployeeReactivateInput,
): Promise<ActionResult<EmployeeRingkas>> {
  const parsed = employeeReactivateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getEmployeeRowById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Karyawan tidak ditemukan.");
    }

    const patch: EmployeePatch = {};
    if (current.status !== "aktif") patch.status = "aktif";
    if (current.tanggal_keluar !== null) patch.tanggal_keluar = null;
    if (input.keterangan !== undefined) {
      const keterangan = parsed.data.keterangan ?? null;
      if (keterangan !== (current.keterangan ?? null)) {
        patch.keterangan = keterangan;
      }
    }

    if (Object.keys(patch).length === 0) return actionOk(ringkas(current));

    const { data, error } = await client
      .from("employees")
      .update(patch)
      .eq("id", id)
      .select(RETURNING)
      .single();

    if (error) throw new DbError("Gagal mengaktifkan Karyawan", error);

    revalidateEmployeePages(id);
    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Simpan Data Pribadi Sensitif (PRD #22) — admin saja.
 *
 * Tabel lain, statement lain, jadi **Batch lain** — dan itu memang yang
 * seharusnya terjadi (ADR-006). Menggabungkannya dengan tulisan ke `employees`
 * berarti dua statement lewat PostgREST, yang artinya dua transaksi dan dua
 * Batch juga, hanya dengan tampilan seolah-olah satu.
 *
 * Barisnya sudah ada untuk setiap Karyawan (dibuat trigger
 * `employees_autocreate_private` saat Karyawan ditambahkan), jadi jalur
 * normalnya UPDATE. Baris yang hilang — misalnya Karyawan yang dibuat sebelum
 * trigger itu ada — tetap bisa diisi lewat INSERT, dan keduanya tetap satu
 * statement.
 *
 * RLS `employee_private` admin-only berlaku untuk baca maupun tulis, jadi
 * seorang viewer tidak bisa sampai ke sini lewat jalan lain.
 */
export async function updateEmployeePrivate(
  input: EmployeePrivateUpdateInput,
): Promise<ActionResult<EmployeePrivateRingkas>> {
  const parsed = employeePrivateUpdateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const karyawan = await getEmployeeRowById(client, id);
    if (!karyawan) {
      throw new ActionError("TIDAK_DITEMUKAN", "Karyawan tidak ditemukan.");
    }

    const current = await getEmployeePrivate(client, id);

    const patch: EmployeePrivatePatch = {};
    for (const column of PRIVATE_COLUMNS) {
      if (input[column] === undefined) continue;
      const next = parsed.data[column] ?? null;
      // `current?.` dan bukan `current &&`: baris yang belum ada juga berisi
      // empat kolom kosong, jadi form kosong yang disimpan tanpa diisi apa pun
      // harus berakhir dengan patch kosong — bukan INSERT empat NULL yang
      // meninggalkan satu Revisi yang tidak mencatat apa pun.
      if (next === (current?.[column] ?? null)) continue;
      patch[column] = next;
    }

    if (Object.keys(patch).length === 0) {
      return actionOk(
        ringkasPrivate(
          current ?? {
            employee_id: id,
            date_of_birth: null,
            place_of_birth: null,
            religion: null,
            marital_status: null,
          },
        ),
      );
    }

    const { data, error } = current
      ? await client
          .from("employee_private")
          .update(patch)
          .eq("employee_id", id)
          .select(RETURNING_PRIVATE)
          .single()
      : await client
          .from("employee_private")
          .insert({ employee_id: id, ...patch })
          .select(RETURNING_PRIVATE)
          .single();

    if (error) throw new DbError("Gagal menyimpan Data Pribadi Sensitif", error);

    revalidateEmployeePages(id);
    return actionOk(ringkasPrivate(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Penjaga & terjemahan error
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Personnel Number dan NIP dua-duanya UNIQUE — dicek di sini supaya pesannya
 * menyebut kolom mana yang bentrok.
 *
 * Ini kenyamanan, bukan jaminan: dua admin yang menyimpan Personnel Number
 * yang sama dalam sekejap sama-sama lolos pengecekan ini, dan yang kedua
 * ditangkap UNIQUE di database (lihat `asActionError`). Karena itu keduanya
 * ada, bukan salah satu.
 */
async function guardKunciBisnis(
  client: DbClient,
  personnelNumber: string,
  nip: string | null,
  exceptId: string | null,
): Promise<void> {
  const [personnelTaken, nipTaken] = await Promise.all([
    isPersonnelNumberTaken(client, personnelNumber, exceptId ?? undefined),
    nip ? isNipTaken(client, nip, exceptId ?? undefined) : Promise.resolve(false),
  ]);

  if (personnelTaken) {
    throw new ActionError(
      "KONFLIK",
      `Personnel Number "${personnelNumber}" sudah dipakai Karyawan lain. Personnel Number adalah kunci bisnis dan harus unik.`,
      { personnel_number: "Personnel Number ini sudah dipakai." },
    );
  }

  if (nipTaken && nip) {
    throw new ActionError(
      "KONFLIK",
      `NIP "${nip}" sudah dipakai Karyawan lain.`,
      { nip: "NIP ini sudah dipakai." },
    );
  }
}

/**
 * Terjemahkan penolakan database menjadi kalimat yang bisa dibaca staf HC.
 *
 * Empat yang bisa sampai ke sini:
 *
 *   * `23505` — UNIQUE `personnel_number` atau `nip`. Kolomnya dibaca dari
 *     nama constraint di pesan Postgres, supaya kesalahan menempel pada field
 *     yang benar di form dan bukan sekadar muncul sebagai toast.
 *   * `23503` — FK ke Unit Organisasi / Jabatan / Lookup yang barisnya sudah
 *     tidak ada.
 *   * `23514` — trigger `employees_validate_lookups`: sebuah `*_id` menunjuk
 *     Lookup dari tipe yang salah. Di UI ini seharusnya mustahil (setiap
 *     picker hanya diberi opsi satu tipe), jadi kalau muncul, yang salah
 *     adalah datanya, bukan pemakainya.
 *   * `PGRST116` / `42501` — **penolakan RLS**, dan bentuknya menipu. Policy
 *     `employees_update` ditulis `using (is_admin())`, jadi UPDATE dari yang
 *     bukan admin tidak melempar `insufficient_privilege`; ia cocok dengan NOL
 *     baris, lalu `.single()` mengeluh "tidak ada baris". Barisnya jelas ada —
 *     baru saja dibaca — jadi nol baris berarti tulisannya yang ditolak.
 *     Tanpa terjemahan ini, tulisan yang ditolak terlihat seperti tersimpan.
 */
function asActionError(error: unknown): unknown {
  if (!(error instanceof DbError)) return error;

  if (error.code === "23505") {
    const detail = `${error.message} ${error.details ?? ""}`;
    if (detail.includes("personnel_number")) {
      return new ActionError(
        "KONFLIK",
        "Personnel Number itu baru saja dipakai Karyawan lain. Muat ulang halaman, lalu pakai Personnel Number lain.",
        { personnel_number: "Personnel Number ini sudah dipakai." },
      );
    }
    if (detail.includes("nip")) {
      return new ActionError(
        "KONFLIK",
        "NIP itu baru saja dipakai Karyawan lain. Muat ulang halaman, lalu pakai NIP lain.",
        { nip: "NIP ini sudah dipakai." },
      );
    }
    return new ActionError(
      "KONFLIK",
      "Nilai yang harus unik itu sudah dipakai baris lain. Muat ulang halaman, lalu coba lagi.",
    );
  }

  if (error.code === "23503") {
    return new ActionError(
      "KONFLIK",
      "Unit Organisasi, Jabatan, atau pilihan yang dirujuk sudah tidak ada. Muat ulang halaman, lalu pilih ulang dari daftar.",
    );
  }

  if (error.code === "23514") {
    return new ActionError(
      "KONFLIK",
      "Salah satu pilihan berasal dari daftar yang tidak sesuai kolomnya, dan ditolak database. Muat ulang halaman, lalu pilih ulang dari daftar yang tersedia.",
    );
  }

  if (error.code === "PGRST116" || error.code === "42501") {
    return new ActionError(
      "BUKAN_ADMIN",
      "Perubahan ditolak database: akun Anda tidak berhak mengubah data Karyawan. Muat ulang halaman, lalu hubungi admin HC Core kalau masih ditolak.",
    );
  }

  return error;
}
