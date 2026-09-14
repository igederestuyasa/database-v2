"use server";

/**
 * Server Actions untuk Jabatan (PRD #8) — tambah, ganti nama, dan
 * nonaktifkan/aktifkan.
 *
 * Bentuknya mengikuti enam langkah `lib/actions/_reference.ts`: validasi zod →
 * `requireAdmin()` → baca baris sekarang → tulis SATU statement langsung →
 * `revalidatePath()` → kembalikan `ActionResult`, tidak pernah melempar.
 *
 * Tidak ada Batch yang dibuka di sini, dan itu disengaja (ADR-006). Ketiga
 * tindakan di bawah masing-masing satu statement, jadi trigger `log_revision`
 * yang membuat Batch-nya — dan Batch itulah yang memuat Revisi-nya, satu baris
 * di Log Perubahan per tindakan. Konsekuensinya yang perlu diketahui saat
 * membaca `/log`: ketiganya muncul sebagai Batch `edit` berketerangan
 * "Perubahan data". `jenis` yang spesifik (`create`, `rename`, `deactivate`)
 * hanya pernah ditulis fungsi RPC di `0002_batch_operations.sql`, dan tidak ada
 * satu pun di antaranya untuk Jabatan. Yang membuat sebuah penonaktifan tetap
 * terbaca bukan judul Batch-nya, melainkan `revisions.before/after` yang
 * menunjukkan kolom `status` bergerak.
 *
 * Dua hal yang membentuk seluruh file ini:
 *
 *   * **Jabatan adalah nama pekerjaan, bukan kursi** (ADR-002, CONTEXT.md).
 *     Tidak ada kuota, tidak ada unit, tidak ada jumlah pemegang yang
 *     disimpan. Yang seperti itu namanya Formasi dan sengaja ditunda.
 *   * **Ganti nama merambat lewat referensi.** `employees.jabatan_id` adalah
 *     FK; namanya hanya hidup di tabel `jabatan`. Jadi `renameJabatan` hanya
 *     menyentuh SATU baris, dan setiap pemegangnya ikut berubah lewat
 *     `v_employees.jabatan_nama`. Kalau sebuah rename sampai menulis ke
 *     `employees`, itu tandanya salah.
 *
 * Merge (PRD #10) TIDAK ada di sini: memindahkan semua pemegang, menonaktifkan
 * asal, dan mencatat tujuannya adalah tiga statement, jadi tempatnya satu
 * fungsi Postgres — `merge_jabatan`, dipanggil lewat `lib/actions/merge.ts`.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  countEmployeesByJabatan,
  getJabatanById,
  getJabatanByKode,
} from "@/lib/db/jabatan";
import { DbError } from "@/lib/db/shared";
import { statusSchema, uuidField } from "@/lib/validation/common";
import {
  jabatanCreateSchema,
  jabatanRenameSchema,
  jabatanUpdateSchema,
  type JabatanCreateInput,
  type JabatanRenameInput,
} from "@/lib/validation/jabatan";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  requireUser,
  toActionFailure,
  type ActionResult,
} from "./_guard";

/** Baris Jabatan seadanya yang dikembalikan ke UI setelah sebuah tulisan. */
export type JabatanRingkas = {
  id: string;
  kode: string;
  nama: string;
  status: string;
};

/**
 * `jabatanUpdateSchema` memperbolehkan `kode`, `nama`, dan `status` sekaligus,
 * tetapi halaman Jabatan tidak pernah menulis `kode`: kode adalah bagian yang
 * stabil — Konsumen dan Revisi lama merujuknya, dan dua ejaan yang sebenarnya
 * satu Jabatan dibereskan lewat Merge, bukan dengan mengetik ulang kodenya.
 * Karena itu tulisan dipecah dua, masing-masing mengambil persis satu kolom
 * dari schema beku itu: nama lewat `jabatanRenameSchema`, status lewat schema
 * di bawah ini. Tidak ada jalan yang bisa menyelipkan `kode`.
 */
const jabatanStatusSchema = jabatanUpdateSchema
  .pick({ id: true, status: true })
  .extend({ status: statusSchema });

export type JabatanStatusInput = z.infer<typeof jabatanStatusSchema>;

const jabatanIdSchema = z.object({ id: uuidField("Jabatan") });

/**
 * Setiap halaman yang ikut basi ketika sebuah Jabatan berubah.
 *
 * `/karyawan` masuk daftar justru *karena* tidak ada baris `employees` yang
 * disentuh: nama barunya sampai ke sana lewat `v_employees`, jadi cache-nya
 * yang perlu dibatalkan (ADR-002).
 *
 * `/bereskan` dan `/log` juga, dan itu bukan hiasan: halaman "Perlu Dibereskan"
 * memanggil `renameJabatan()` langsung dari dialognya (PRD #12) dan Temuan
 * "nama mirip" di sana dihitung dari nama Jabatan — sebuah rename yang tidak
 * membatalkan cache-nya akan menampilkan Temuan yang sudah dibereskan. Daftar
 * ini sengaja sama dengan `revalidateOrgUnitPages()` di
 * `lib/actions/orgUnits.ts`: keduanya dipanggil dari dialog yang sama.
 */
function revalidateJabatanPages(): void {
  revalidatePath("/jabatan");
  revalidatePath("/karyawan");
  revalidatePath("/bereskan");
  revalidatePath("/log");
}

/**
 * Tambah Jabatan baru (PRD #8).
 *
 * `kode` wajib unik. Kalau kodenya sudah dipakai, jawabannya bukan "coba kode
 * lain" melainkan "Jabatan itu sudah ada" — termasuk kalau yang lama berstatus
 * nonaktif, yang tinggal diaktifkan kembali.
 */
export async function createJabatan(
  input: JabatanCreateInput,
): Promise<ActionResult<JabatanRingkas>> {
  const parsed = jabatanCreateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { kode, nama, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    // Dicek di sini supaya pesannya bisa menyebut Jabatan yang sudah ada;
    // UNIQUE di database tetap penjaga terakhirnya (lihat `asActionError`).
    const existing = await getJabatanByKode(client, kode);
    if (existing) {
      throw new ActionError(
        "KONFLIK",
        existing.status === "nonaktif"
          ? `Kode "${kode}" sudah dipakai Jabatan "${existing.nama}" yang berstatus nonaktif. Aktifkan kembali Jabatan itu daripada membuat yang baru.`
          : `Kode "${kode}" sudah dipakai Jabatan "${existing.nama}".`,
        { kode: "Kode Jabatan sudah dipakai." },
      );
    }

    const { data, error } = await client
      .from("jabatan")
      .insert({ kode, nama, status })
      .select("id, kode, nama, status")
      .single();

    if (error) throw new DbError("Gagal menambah Jabatan", error);

    revalidateJabatanPages();

    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Ganti nama Jabatan (PRD #8) — tulisan kecil yang menjadi contoh baku.
 *
 * Satu baris, satu Revisi. Semua pemegangnya ikut berganti nama tanpa satu pun
 * baris `employees` disentuh, karena nama itu memang tidak pernah disalin ke
 * sana (ADR-002).
 */
export async function renameJabatan(
  input: JabatanRenameInput,
): Promise<ActionResult<JabatanRingkas>> {
  const parsed = jabatanRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getJabatanById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Jabatan tidak ditemukan.");
    }

    // Tidak ada yang berubah. `log_revision` toh mengabaikan update yang hanya
    // menggeser `updated_at`, jadi berhenti di sini menjaga Log Perubahan
    // bersih dari baris yang tidak mencatat apa pun.
    if (current.nama === nama) return actionOk(ringkas(current));

    const { data, error } = await client
      .from("jabatan")
      .update({ nama })
      .eq("id", id)
      .select("id, kode, nama, status")
      .single();

    if (error) throw new DbError("Gagal mengganti nama Jabatan", error);

    revalidateJabatanPages();

    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Nonaktifkan atau aktifkan kembali sebuah Jabatan (PRD #8).
 *
 * Tidak ada DELETE di HC Core (ARCHITECTURE.md §6): baris Jabatan tetap ada
 * selamanya, sehingga Karyawan yang memegangnya, Revisi lama, dan Konsumen
 * yang menyimpan id-nya semuanya tetap bisa diselesaikan. Menonaktifkan
 * **tidak** memindahkan pemegangnya — itu pekerjaan Merge (PRD #10).
 *
 * Kedua arah adalah `UPDATE` satu kolom yang sama, jadi keduanya masuk Batch
 * `edit` otomatis; yang membedakannya di Log Perubahan adalah `status` di
 * `before`/`after` Revisi-nya.
 */
export async function setJabatanStatus(
  input: JabatanStatusInput,
): Promise<ActionResult<JabatanRingkas>> {
  const parsed = jabatanStatusSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    const current = await getJabatanById(client, id);
    if (!current) {
      throw new ActionError("TIDAK_DITEMUKAN", "Jabatan tidak ditemukan.");
    }
    if (current.status === status) return actionOk(ringkas(current));

    const { data, error } = await client
      .from("jabatan")
      .update({ status })
      .eq("id", id)
      .select("id, kode, nama, status")
      .single();

    if (error) throw new DbError("Gagal mengubah status Jabatan", error);

    revalidateJabatanPages();

    return actionOk(ringkas(data));
  } catch (error) {
    return toActionFailure(asActionError(error));
  }
}

/**
 * Berapa Karyawan memegang Jabatan ini.
 *
 * Bacaan, bukan tulisan — tapi tempatnya di sini karena dialog Nonaktifkan dan
 * Merge memintanya dari Client Component, dan angka itulah yang membuat kedua
 * tindakan tersebut bukan sekadar klik: "12 Karyawan memegang Jabatan ini".
 * Semua yang login boleh melihatnya, sama seperti daftar Jabatan itu sendiri.
 */
export async function countJabatanHolders(input: {
  id: string;
}): Promise<ActionResult<{ total: number; aktif: number }>> {
  const parsed = jabatanIdSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);

  try {
    const { client } = await requireUser();
    const [total, aktif] = await Promise.all([
      countEmployeesByJabatan(client, parsed.data.id, { status: "semua" }),
      countEmployeesByJabatan(client, parsed.data.id, { status: "aktif" }),
    ]);
    return actionOk({ total, aktif });
  } catch (error) {
    return toActionFailure(error);
  }
}

function ringkas(row: {
  id: string;
  kode: string;
  nama: string;
  status: string;
}): JabatanRingkas {
  return { id: row.id, kode: row.kode, nama: row.nama, status: row.status };
}

/**
 * Terjemahkan penolakan dari database menjadi pesan yang bisa dibaca staf HC.
 *
 * Tiga yang bisa sampai ke sini, dan ketiganya tidak boleh muncul sebagai
 * "Gagal menyimpan perubahan. Coba lagi.":
 *
 *   * `23505` — dua admin menyimpan kode yang sama dalam sekejap: yang kedua
 *     lolos pengecekan `getJabatanByKode` dan ditangkap UNIQUE. Tanpa ini staf
 *     HC membaca "duplicate key value violates unique constraint
 *     jabatan_kode_key".
 *   * `PGRST116` — **penolakan RLS pada UPDATE**, dan bentuknya menipu. Policy
 *     `jabatan_update` ditulis `using (is_admin())`, jadi tulisan dari yang
 *     bukan admin tidak melempar `insufficient_privilege`; ia hanya cocok
 *     dengan NOL baris, lalu `.single()` mengeluh "tidak ada baris". Di sini
 *     baris itu jelas ada — baru saja dibaca — jadi nol baris berarti
 *     tulisannya yang ditolak, bukan barisnya yang hilang.
 *   * `42501` — penolakan yang memang melempar: `with check` pada INSERT, dan
 *     `assert_admin()` di fungsi RPC.
 *
 * `requireAdmin()` di setiap action seharusnya sudah menyaring semuanya; ini
 * lapis keduanya (CLAUDE.md: "Cek role di Server Action **dan** RLS"), untuk
 * saat role berubah di tengah request atau sesi habis setelah guard lewat.
 */
function asActionError(error: unknown): unknown {
  if (!(error instanceof DbError)) return error;

  if (error.code === "23505") {
    return new ActionError(
      "KONFLIK",
      "Kode Jabatan itu sudah dipakai. Muat ulang halaman lalu coba lagi.",
      { kode: "Kode Jabatan sudah dipakai." },
    );
  }

  if (error.code === "PGRST116" || error.code === "42501") {
    return new ActionError(
      "BUKAN_ADMIN",
      "Perubahan ditolak database: akun Anda tidak berhak mengubah Jabatan. Muat ulang halaman, lalu hubungi admin HC Core kalau masih ditolak.",
    );
  }

  return error;
}
