"use server";

/**
 * Server Actions untuk Jabatan (PRD #8) — tambah, ganti nama, dan
 * nonaktifkan/aktifkan.
 *
 * Bentuknya mengikuti `lib/actions/_reference.ts` langkah demi langkah:
 * validasi zod → `requireAdmin()` → baca baris sekarang → tulis di dalam
 * `withBatch()` → `revalidatePath()` → kembalikan `ActionResult`, tidak pernah
 * melempar.
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
 * Merge (PRD #10) TIDAK ada di sini: satu operasi banyak baris sudah punya
 * rumahnya sendiri di `lib/actions/merge.ts:mergeJabatan`, dan menuliskannya
 * ulang dalam TypeScript justru memecahnya menjadi beberapa Batch.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  countEmployeesByJabatan,
  getJabatanById,
  getJabatanByKode,
} from "@/lib/db/jabatan";
import { DbError } from "@/lib/db/shared";
import { batchKeterangan, withBatch } from "@/lib/revisions/batch";
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

    const { result } = await withBatch(
      client,
      {
        jenis: "create",
        keterangan: batchKeterangan("Tambah Jabatan", null, `${kode} — ${nama}`),
      },
      async ({ client: tx }) => {
        const { data, error } = await tx
          .from("jabatan")
          .insert({ kode, nama, status })
          .select("id, kode, nama, status")
          .single();

        if (error) throw new DbError("Gagal menambah Jabatan", error);
        return data;
      },
    );

    revalidatePath("/jabatan");
    revalidatePath("/karyawan");

    return actionOk(result);
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
    // bersih dari Batch kosong.
    if (current.nama === nama) return actionOk(ringkas(current));

    const { result } = await withBatch(
      client,
      {
        jenis: "rename",
        keterangan: batchKeterangan("Ganti nama Jabatan", current.nama, nama),
      },
      async ({ client: tx }) => {
        const { data, error } = await tx
          .from("jabatan")
          .update({ nama })
          .eq("id", id)
          .select("id, kode, nama, status")
          .single();

        if (error) throw new DbError("Gagal mengganti nama Jabatan", error);
        return data;
      },
    );

    revalidatePath("/jabatan");
    revalidatePath("/karyawan");

    return actionOk(result);
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

    const { result } = await withBatch(
      client,
      {
        // Daftar `BATCH_JENIS` tidak punya "activate", dan memberi label
        // `deactivate` pada pengaktifan kembali akan membuat Log Perubahan
        // membaca "Nonaktifkan" untuk perubahan yang justru sebaliknya.
        jenis: status === "nonaktif" ? "deactivate" : "edit",
        keterangan: batchKeterangan(
          status === "nonaktif" ? "Nonaktifkan Jabatan" : "Aktifkan Jabatan",
          null,
          `${current.kode} — ${current.nama}`,
        ),
      },
      async ({ client: tx }) => {
        const { data, error } = await tx
          .from("jabatan")
          .update({ status })
          .eq("id", id)
          .select("id, kode, nama, status")
          .single();

        if (error) throw new DbError("Gagal mengubah status Jabatan", error);
        return data;
      },
    );

    revalidatePath("/jabatan");
    revalidatePath("/karyawan");

    return actionOk(result);
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
 * Terjemahkan pelanggaran UNIQUE dari Postgres menjadi pesan yang bisa dibaca.
 *
 * Dua admin yang menyimpan kode yang sama dalam sekejap akan lolos dari
 * pengecekan di atas dan ditangkap oleh constraint; tanpa ini, staf HC membaca
 * "duplicate key value violates unique constraint jabatan_kode_key".
 */
function asActionError(error: unknown): unknown {
  if (error instanceof DbError && error.code === "23505") {
    return new ActionError(
      "KONFLIK",
      "Kode Jabatan itu sudah dipakai. Muat ulang halaman lalu coba lagi.",
      { kode: "Kode Jabatan sudah dipakai." },
    );
  }
  return error;
}
