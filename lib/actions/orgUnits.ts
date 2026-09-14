"use server";

/**
 * Server Actions untuk Unit Organisasi (PRD #7).
 *
 * Shape copied from `lib/actions/_reference.ts`, step for step: validate with
 * the shared zod schema → `requireAdmin()` → read the current row → write ONE
 * statement directly → map database errors to something staf HC can read →
 * `revalidatePath()` → return an `ActionResult`, never throw.
 *
 * Nothing here opens a Batch. Over PostgREST each call is its own transaction,
 * so a Batch opened from TypeScript is already gone when the UPDATE lands and
 * would sit in the Log Perubahan containing nothing; the `log_revision`
 * trigger makes the Batch that actually holds the Revisi (ADR-006). Every
 * action below is deliberately ONE statement, which is what keeps that true —
 * adding a second one would split the action across two Batch entries and make
 * "kembalikan Batch ini" undo half of it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS FILE EXISTS TO KEEP (ADR-002, PRD #7)
 * ────────────────────────────────────────────────────────────────────────────
 * "mengganti nama sebuah unit otomatis berlaku untuk semua karyawan di
 * bawahnya" — and it does so **by reference**. `employees.org_unit_id` is a
 * uuid FK; the nama lives in exactly one place, `org_units.nama`, and
 * `v_employees` joins it back out. So a rename here is ONE `update org_units`
 * of ONE row. Nothing in this file writes to `employees`, and nothing in this
 * file should ever start to: an UPDATE that touched 300 Karyawan rows would
 * produce 300 Revisi for a change that changed no Karyawan data, and would be
 * exactly the find-replace-over-hundreds-of-rows that ADR-002 replaced.
 *
 * Merge is the one operation that *does* move Karyawan rows, and it is not
 * here: it is three UPDATEs across two tables, so it lives in the
 * `merge_org_unit` Postgres function and reaches the UI through
 * `mergeOrgUnit()` in `lib/actions/merge.ts` (ADR-006).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  collectDescendantIds,
  countEmployeesByOrgUnit,
  getOrgUnitById,
  getOrgUnitByKode,
  listAllOrgUnits,
} from "@/lib/db/orgUnits";
import {
  DbError,
  IncompleteReadError,
  requireComplete,
  type DbClient,
} from "@/lib/db/shared";
import { UI } from "@/lib/i18n/terms";
import type { OrgUnit, TablesUpdate } from "@/lib/types/db";
import { uuidField } from "@/lib/validation/common";
import {
  orgUnitCreateSchema,
  orgUnitMoveSchema,
  orgUnitRenameSchema,
  orgUnitUpdateSchema,
  type OrgUnitType,
} from "@/lib/validation/orgUnit";

import {
  actionInvalid,
  actionOk,
  ActionError,
  requireAdmin,
  toActionFailure,
  type ActionFailure,
  type ActionResult,
} from "./_guard";

/* ────────────────────────────────────────────────────────────────────────────
 * Input shapes
 *
 * Deliberately NOT `z.infer<typeof orgUnitCreateSchema>`: every field in the
 * frozen schemas is wrapped in `z.preprocess`, so the inferred *input* is
 * `unknown` and the inferred *output* makes defaulted fields required. These
 * describe what a form actually sends; the schema is still the only thing that
 * validates it.
 * ──────────────────────────────────────────────────────────────────────────── */

export type CreateOrgUnitInput = {
  kode: string;
  nama: string;
  tipe: OrgUnitType;
  /** NULL is only *meant* for `direktorat` — see the note in `OrgUnitForm`. */
  parent_id?: string | null;
};

export type UpdateOrgUnitInput = {
  id: string;
  nama?: string;
  tipe?: OrgUnitType;
  parent_id?: string | null;
};

export type RenameOrgUnitInput = { id: string; nama: string };

export type MoveOrgUnitInput = { id: string; parent_id?: string | null };

export type OrgUnitIdInput = { id: string };

/** What every action in this file hands back. */
export type OrgUnitActionData = {
  id: string;
  kode: string;
  nama: string;
  tipe: string;
  parent_id: string | null;
  status: string;
};

const orgUnitIdSchema = z.object({ id: uuidField("Unit Organisasi") });

/** The columns every write reads back — all real `org_units` columns. */
const RETURNING = "id, kode, nama, tipe, parent_id, status";

/** Only ever `org_units` columns; the type is what keeps it that way. */
type OrgUnitPatch = TablesUpdate<"org_units">;

/* ────────────────────────────────────────────────────────────────────────────
 * Shared plumbing
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every page whose rendering depends on a Unit Organisasi nama or hierarchy.
 *
 * `/karyawan` is in the list precisely *because* no Karyawan row is touched:
 * the new nama reaches those pages through `v_employees`, so their cache is
 * the only thing that needs invalidating.
 */
function revalidateOrgUnitPages(): void {
  revalidatePath("/struktur");
  revalidatePath("/karyawan");
  revalidatePath("/bereskan");
  revalidatePath("/log");
}

function toActionData(unit: OrgUnit): OrgUnitActionData {
  return {
    id: unit.id,
    kode: unit.kode,
    nama: unit.nama,
    tipe: unit.tipe,
    parent_id: unit.parent_id,
    status: unit.status,
  };
}

/**
 * Translate a PostgREST failure into an `ActionError` with an Indonesian
 * message; hand anything else back untouched.
 *
 * Step 4 of the reference action: a toast must never read "duplicate key value
 * violates unique constraint org_units_kode_key". What this does not
 * recognise is returned as-is, so `toActionFailure()` logs it server-side and
 * shows the generic message.
 */
function readableError(error: unknown, context: { kode?: string }): unknown {
  if (error instanceof IncompleteReadError) {
    // Nothing failed — the read came back short and the guard below it would
    // have been decided on half the hierarchy. Refusing is the only honest
    // answer, and it must not read as "coba lagi".
    // Deliberately does NOT name db-max-rows as the fix: the read is capped by
    // whichever ceiling is lower, and past MAX_TREE_ROWS the client's own limit
    // is the one biting — raising db-max-rows would change nothing. Naming the
    // wrong remedy is worse than naming none.
    return new ActionError(
      "GAGAL",
      `${error.message} Hubungi admin HC Core — batas baca Unit Organisasi perlu dinaikkan atau dibuat berhalaman sebelum hierarki bisa diubah.`,
    );
  }
  if (!(error instanceof DbError)) return error;

  switch (error.code) {
    case "23505":
      return new ActionError(
        "KONFLIK",
        context.kode
          ? `Kode Unit Organisasi "${context.kode}" sudah dipakai unit lain. Kode harus unik.`
          : "Kode Unit Organisasi sudah dipakai unit lain. Kode harus unik.",
        { kode: "Kode ini sudah dipakai." },
      );
    case "23503":
      return new ActionError(
        "KONFLIK",
        "Induk yang dipilih sudah tidak ada. Muat ulang halaman, lalu pilih induk lain.",
        { parent_id: "Induk tidak ditemukan." },
      );
    case "23514":
      // `org_units_prevent_cycle` raises 23514 with an Indonesian message; so
      // do the `tipe` and `status` CHECK constraints.
      return new ActionError(
        "KONFLIK",
        /siklus|induk dirinya|terlalu dalam/i.test(error.message)
          ? "Induk yang dipilih membuat siklus pada hierarki Unit Organisasi. Pilih induk lain."
          : "Nilai yang dikirim ditolak aturan basis data. Periksa tipe dan status Unit Organisasi.",
      );
    case "42501":
      // `with check (is_admin())` on INSERT really does raise
      // insufficient_privilege. The Server Action checked the role too — both,
      // not either (CLAUDE.md) — so reaching here means the role changed
      // mid-request.
      return new ActionError("BUKAN_ADMIN", UI.hanyaAdmin);
    case "PGRST116":
      // An UPDATE refused by RLS does NOT raise 42501. `org_units_update` is
      // written `using (public.is_admin())`, and a USING clause *filters*: for
      // a non-admin the UPDATE simply matches zero rows, and `.single()` then
      // makes PostgREST answer PGRST116. Without this case the refusal would
      // reach staf HC as the generic "coba lagi", which explains nothing.
      // (The row itself cannot have been deleted — there is no DELETE
      // anywhere, ADR-003 — so the remaining cause is a concurrent edit.)
      return new ActionError(
        "BUKAN_ADMIN",
        `${UI.hanyaAdmin} Kalau Anda memang admin, Unit Organisasi ini baru saja diubah orang lain — muat ulang halaman lalu coba lagi.`,
      );
    default:
      return error;
  }
}

/**
 * The single `catch` body every action below shares, so the six of them cannot
 * drift apart in how they report a failure.
 */
function failure(error: unknown, context: { kode?: string } = {}): ActionFailure {
  return toActionFailure(readableError(error, context));
}

/** Load the row this action is about, or fail readably. */
async function loadOrgUnit(client: DbClient, id: string): Promise<OrgUnit> {
  const current = await getOrgUnitById(client, id);
  if (!current) {
    throw new ActionError("TIDAK_DITEMUKAN", "Unit Organisasi tidak ditemukan.");
  }
  return current;
}

/**
 * Refuse a new induk that would build a cycle, before the round trip.
 *
 * `org_units_prevent_cycle` refuses it in the database too, and that is the
 * real guarantee — this runs on a snapshot another admin may already have
 * changed. Doing it here as well buys a message that names the units instead
 * of a constraint.
 */
async function guardParent(
  client: DbClient,
  unit: Pick<OrgUnit, "id" | "nama">,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;

  if (parentId === unit.id) {
    throw new ActionError(
      "KONFLIK",
      "Unit Organisasi tidak boleh menjadi induk dirinya sendiri.",
      { parent_id: "Tidak boleh memilih unit ini sendiri." },
    );
  }

  const parent = await getOrgUnitById(client, parentId);
  if (!parent) {
    throw new ActionError(
      "TIDAK_DITEMUKAN",
      "Induk yang dipilih tidak ditemukan. Muat ulang halaman, lalu pilih lagi.",
      { parent_id: "Induk tidak ditemukan." },
    );
  }

  // Read every unit — including nonaktif ones, which are still real parents in
  // the hierarchy — and check the subtree with the cycle-safe helper from the
  // read layer rather than walking parents by hand.
  // `requireComplete`, not `.rows`: deciding "this induk is not below that
  // unit" from a half-read hierarchy can wave through exactly the cycle this
  // guard exists to refuse. The database trigger still refuses it, but the
  // admin would get a constraint message instead of a sentence.
  const read = await listAllOrgUnits(client, { status: "semua" });
  const descendants = collectDescendantIds(
    requireComplete(read, "Unit Organisasi"),
    unit.id,
  );
  if (descendants.includes(parentId)) {
    throw new ActionError(
      "KONFLIK",
      `"${parent.nama}" berada di bawah "${unit.nama}", jadi tidak bisa menjadi induknya. Pilih induk lain.`,
      { parent_id: "Induk ini ada di bawah unit yang sedang diubah." },
    );
  }
}

/**
 * ONE row, ONE statement — the whole write path of this file.
 *
 * No Batch call wraps it: the `log_revision` trigger opens the Batch that
 * holds the Revisi (ADR-006). `patch` only ever carries `org_units` columns,
 * and there is no `employees` write anywhere — that is the ADR-002 invariant
 * spelled out at the top of the file.
 */
async function writeOrgUnit(
  client: DbClient,
  id: string,
  patch: OrgUnitPatch,
): Promise<OrgUnitActionData> {
  const { data, error } = await client
    .from("org_units")
    .update(patch)
    .eq("id", id)
    .select(RETURNING)
    .single();

  if (error) throw new DbError("Gagal menyimpan Unit Organisasi", error);
  return data;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

/** Tambah Unit Organisasi (PRD #7). */
export async function createOrgUnit(
  input: CreateOrgUnitInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitCreateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { kode, nama, tipe, parent_id: parentId, status } = parsed.data;

  try {
    const { client } = await requireAdmin();

    // A friendlier duplicate message than the UNIQUE constraint's — which is
    // still there, and still wins if two admins race.
    const existing = await getOrgUnitByKode(client, kode);
    if (existing) {
      throw new ActionError(
        "KONFLIK",
        `Kode "${kode}" sudah dipakai Unit Organisasi "${existing.nama}". Pakai kode lain.`,
        { kode: "Kode ini sudah dipakai." },
      );
    }

    if (parentId) {
      const parent = await getOrgUnitById(client, parentId);
      if (!parent) {
        throw new ActionError(
          "TIDAK_DITEMUKAN",
          "Induk yang dipilih tidak ditemukan. Muat ulang halaman, lalu pilih lagi.",
          { parent_id: "Induk tidak ditemukan." },
        );
      }
    }

    // One INSERT. The trigger records it as a Revisi with `action = 'insert'`,
    // in a Batch it opens itself.
    const { data, error } = await client
      .from("org_units")
      .insert({ kode, nama, tipe, parent_id: parentId, status })
      .select(RETURNING)
      .single();

    if (error) throw new DbError("Gagal menambah Unit Organisasi", error);

    revalidateOrgUnitPages();
    return actionOk(data);
  } catch (error) {
    return failure(error, { kode });
  }
}

/**
 * Ubah Unit Organisasi (PRD #7) — nama, tipe dan/atau induk.
 *
 * When `nama` is the only thing that moved, the Batch is recorded as `rename`
 * so the Log Perubahan reads "Ganti nama Unit Organisasi: …" instead of a
 * generic edit. Either way it is one UPDATE of one `org_units` row.
 */
export async function updateOrgUnit(
  input: UpdateOrgUnitInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitUpdateSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama, tipe } = parsed.data;
  // `parent_id` is nullable, so "sent as null" and "not sent" have to be told
  // apart on the raw input: the schema turns both into `null`.
  const parentTouched = input.parent_id !== undefined;
  const parentId = parsed.data.parent_id ?? null;

  try {
    const { client } = await requireAdmin();
    const current = await loadOrgUnit(client, id);

    const patch: OrgUnitPatch = {};
    if (nama !== undefined && nama !== current.nama) patch.nama = nama;
    if (tipe !== undefined && tipe !== current.tipe) patch.tipe = tipe;
    if (parentTouched && parentId !== current.parent_id) patch.parent_id = parentId;

    // Nothing moved. `log_revision` skips an update that only touches
    // `updated_at` anyway, so returning early just keeps the Log Perubahan
    // free of empty Batch entries.
    if (Object.keys(patch).length === 0) return actionOk(toActionData(current));

    if ("parent_id" in patch) await guardParent(client, current, parentId);

    const result = await writeOrgUnit(client, id, patch);

    revalidateOrgUnitPages();
    return actionOk(result);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Ganti nama saja (PRD #7) — the case the whole data model is built around.
 *
 * One UPDATE, one Revisi, zero Karyawan rows touched. Also the entry point for
 * "Perlu Dibereskan" (PRD #12), which renames without leaving the page.
 */
export async function renameOrgUnit(
  input: RenameOrgUnitInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitRenameSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id, nama } = parsed.data;

  try {
    const { client } = await requireAdmin();
    const current = await loadOrgUnit(client, id);

    if (current.nama === nama) return actionOk(toActionData(current));

    const result = await writeOrgUnit(client, id, { nama });

    revalidateOrgUnitPages();
    return actionOk(result);
  } catch (error) {
    return failure(error);
  }
}

/** Pindahkan Unit Organisasi ke induk lain. `parent_id: null` menjadikannya akar. */
export async function moveOrgUnit(
  input: MoveOrgUnitInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitMoveSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;
  const parentId = parsed.data.parent_id ?? null;

  try {
    const { client } = await requireAdmin();
    const current = await loadOrgUnit(client, id);

    if (current.parent_id === parentId) return actionOk(toActionData(current));

    await guardParent(client, current, parentId);

    const result = await writeOrgUnit(client, id, { parent_id: parentId });

    revalidateOrgUnitPages();
    return actionOk(result);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Nonaktifkan Unit Organisasi — there is no DELETE anywhere (ADR-003).
 *
 * Refused while the unit still holds aktif Karyawan or aktif turunan, because
 * `status` is not a cascade: deactivating a Divisi would otherwise leave its
 * Bagian and its Karyawan pointing at a unit that no longer appears in any
 * picker, with nothing to say where they went. The message names the count and
 * the way out (pindahkan, atau Merge).
 */
export async function deactivateOrgUnit(
  input: OrgUnitIdInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitIdSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;

  try {
    const { client } = await requireAdmin();
    const current = await loadOrgUnit(client, id);

    if (current.status === "nonaktif") return actionOk(toActionData(current));

    // A short read here would under-count the aktif turunan and let a Divisi
    // be deactivated out from under its Bagian, so an incomplete answer is
    // refused rather than acted on.
    const activeChildren = requireComplete(
      await listAllOrgUnits(client, { status: "aktif", parentId: id }),
      "Unit Organisasi turunan",
    );
    if (activeChildren.length > 0) {
      const contoh = activeChildren
        .slice(0, 3)
        .map((child) => `"${child.nama}"`)
        .join(", ");
      const sisa = activeChildren.length > 3 ? ", dan lainnya" : "";
      throw new ActionError(
        "KONFLIK",
        `"${current.nama}" masih punya ${activeChildren.length} Unit Organisasi turunan yang aktif (${contoh}${sisa}). Nonaktifkan atau pindahkan turunannya lebih dulu.`,
      );
    }

    const karyawanAktif = await countEmployeesByOrgUnit(client, id, {
      status: "aktif",
    });
    if (karyawanAktif > 0) {
      throw new ActionError(
        "KONFLIK",
        `"${current.nama}" masih menjadi penempatan ${karyawanAktif} Karyawan aktif. Pindahkan Karyawan tersebut ke unit lain, atau pakai Merge supaya semuanya ikut pindah sekaligus.`,
      );
    }

    const result = await writeOrgUnit(client, id, { status: "nonaktif" });

    revalidateOrgUnitPages();
    return actionOk(result);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Aktifkan kembali Unit Organisasi yang nonaktif.
 *
 * Refused for a unit that was merged away: reactivating it would put the
 * duplicate back into every picker while its Karyawan stay on the target,
 * which is how the varian nama come back. Kembalikan Batch Merge-nya di Log
 * Perubahan instead.
 */
export async function activateOrgUnit(
  input: OrgUnitIdInput,
): Promise<ActionResult<OrgUnitActionData>> {
  const parsed = orgUnitIdSchema.safeParse(input);
  if (!parsed.success) return actionInvalid(parsed.error);
  const { id } = parsed.data;

  try {
    const { client } = await requireAdmin();
    const current = await loadOrgUnit(client, id);

    if (current.merged_into_id) {
      throw new ActionError(
        "KONFLIK",
        `"${current.nama}" sudah di-Merge ke Unit Organisasi lain. Kembalikan Batch Merge-nya di Log Perubahan kalau unit ini memang masih dipakai.`,
      );
    }

    if (current.status === "aktif") return actionOk(toActionData(current));

    const result = await writeOrgUnit(client, id, { status: "aktif" });

    revalidateOrgUnitPages();
    return actionOk(result);
  } catch (error) {
    return failure(error);
  }
}
