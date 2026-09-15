import type { Metadata } from "next";
import Link from "next/link";

import { requirePageSession } from "@/lib/auth/session";
import { readProfileLabels } from "@/lib/db/labels";
import { countRevisionsInBatch, getBatchById, listBatches } from "@/lib/db/revisions";
import type { DbClient } from "@/lib/db/shared";
import { BATCH_TYPE_LABELS, NAV_LABELS, UI } from "@/lib/i18n/terms";
import type { ReferenceLabels } from "@/lib/revisions/references";
import { BATCH_JENIS, type BatchJenis } from "@/lib/revisions/tables";

import BatchList, { type BatchRow } from "./_components/BatchList";

// Live data only — never prerendered at build time. See ADR-005.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Log Perubahan" };

/**
 * Log Perubahan — every Batch, newest first (PRD #16).
 *
 * A Batch is one action: one simpan, one Merge, one Seed, one Revert
 * (CONTEXT.md). Since ADR-006 that is literally true — nothing opens a Batch
 * from TypeScript any more, so an ordinary edit produces exactly one row here
 * and that row really holds its Revisi.
 *
 * Reading the log needs only a login; reverting a Batch needs admin
 * (ARCHITECTURE.md §5). `canRevert` below decides whether the button is drawn;
 * the Server Action and `assert_admin()` inside `revert_batch` decide whether
 * it works.
 *
 * Filters live in the URL rather than in component state, so a filtered log can
 * be linked to and refreshed, and so this page needs no client JavaScript to
 * produce one.
 */
const PER_PAGE = 20;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?jenis=merge&jenis=seed` is a mistake, not a feature: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parseJenis(value: string | undefined): BatchJenis | undefined {
  return (BATCH_JENIS as readonly string[]).includes(value ?? "")
    ? (value as BatchJenis)
    : undefined;
}

const STATUS_OPTIONS = [
  { value: "semua", label: "Semua Batch" },
  { value: "belum", label: "Belum dikembalikan" },
  { value: "sudah", label: "Sudah dikembalikan" },
] as const;

function parseReverted(value: string | undefined): boolean | undefined {
  if (value === "sudah") return true;
  if (value === "belum") return false;
  return undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBatchId(value: string | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined;
}

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Anyone logged in may read the log; nobody else gets to see who changed
  // what. `middleware.ts` is the boundary and this is the second lock. A
  // momentary database hiccup on `profiles` is not "please sign in" — it
  // throws through to `error.tsx` rather than bouncing an admin to /login.
  const { client, user } = await requirePageSession("/log");

  const page = parsePage(one(params.page));
  const jenis = parseJenis(one(params.jenis));
  const search = one(params.q)?.trim() || undefined;
  const statusValue = one(params.status) ?? "semua";
  const reverted = parseReverted(statusValue);
  // `/log?batch=<id>` — the link another page hands an admin right after a
  // Merge, so that "undo this" lands on the Batch that undoes it.
  const batchId = parseBatchId(one(params.batch));

  // One Batch by id, or a page of them. `listBatches` cannot filter by id, and
  // a deep link must resolve even when the Batch is pages deep by now.
  const sorotan = batchId ? await getBatchById(client, batchId) : null;
  const batches = sorotan
    ? { rows: [sorotan], page: 1, perPage: 1, total: 1, pageCount: 1 }
    : await listBatches(client, {
        page,
        perPage: PER_PAGE,
        jenis,
        search,
        reverted,
      });

  // How many Revisi each Batch holds, as far as RLS lets this reader see.
  // An exact `count`, not the length of a read: PostgREST caps a plain read at
  // `db-max-rows` (1000 by default), so a Seed Batch counted by reading it
  // would quietly report 1000 (ADR-006, and `loadBatchRevisions` says the same
  // about what it renders).
  const counts = await Promise.all(
    batches.rows.map((batch) => countRevisionsInBatch(client, batch.id)),
  );

  const rows: BatchRow[] = batches.rows.map((batch, index) => ({
    ...batch,
    revisionCount: counts[index] ?? 0,
  }));

  // Resolve pelaku once, on the server, so the first paint already says who.
  // Read directly through `lib/db` with the session client this page already
  // holds — going through the `resolveRevisionLabels` Server Action from here
  // would verify the session a second time for nothing.
  const actorIds = [
    ...new Set(
      rows
        .map((batch) => batch.actor_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const initialLabels = await bacaLabelPelaku(client, actorIds);

  function hrefFor(nextPage: number): string {
    const query = new URLSearchParams();
    if (jenis) query.set("jenis", jenis);
    if (search) query.set("q", search);
    if (statusValue !== "semua") query.set("status", statusValue);
    if (nextPage > 1) query.set("page", String(nextPage));
    const suffix = query.toString();
    return suffix ? `/log?${suffix}` : "/log";
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{NAV_LABELS.log}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Setiap tindakan tercatat sebagai satu Batch berisi Revisi — sebelum,
          sesudah, siapa, dan kapan. Admin bisa mengembalikan satu Batch utuh;
          hasilnya jadi Batch baru, dan tidak ada yang dihapus dari log.
        </p>
      </header>

      {batchId ? (
        <p className="rounded-lg border bg-muted/30 p-3 text-sm">
          {sorotan
            ? "Menampilkan satu Batch yang ditautkan dari halaman lain."
            : "Batch yang ditautkan tidak ditemukan, atau tidak boleh Anda baca."}{" "}
          <Link href="/log" className="underline underline-offset-2">
            Lihat semua Batch
          </Link>
        </p>
      ) : null}

      <form
        method="get"
        action="/log"
        className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Cari keterangan
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="mis. Merge Jabatan"
            className={`${SELECT_CLASS} w-56`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="jenis"
            className="text-xs font-medium text-muted-foreground"
          >
            Jenis Batch
          </label>
          <select
            id="jenis"
            name="jenis"
            defaultValue={jenis ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">Semua jenis</option>
            {BATCH_JENIS.map((value) => (
              <option key={value} value={value}>
                {BATCH_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="status"
            className="text-xs font-medium text-muted-foreground"
          >
            Status Revert
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusValue}
            className={SELECT_CLASS}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          {UI.filter}
        </button>

        {jenis || search || statusValue !== "semua" ? (
          <Link
            href="/log"
            className="h-9 rounded-md border border-input px-4 text-sm leading-9 hover:bg-accent"
          >
            Bersihkan
          </Link>
        ) : null}
      </form>

      <BatchList
        batches={rows}
        canRevert={user.role === "admin"}
        initialLabels={initialLabels}
        expandedBatchId={sorotan?.id}
      />

      {batchId ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {batches.total} Batch · Halaman {batches.page} dari {batches.pageCount}
          </span>
          <div className="flex gap-2">
            <PagerLink
              href={hrefFor(batches.page - 1)}
              disabled={batches.page <= 1}
              label="Sebelumnya"
            />
            <PagerLink
              href={hrefFor(batches.page + 1)}
              disabled={batches.page >= batches.pageCount}
              label="Berikutnya"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Emails of the Batch actors, or `{}` when that read failed.
 *
 * A name is a nicety on this page and the list is the point: a hiccup on
 * `profiles` must not replace the whole Log Perubahan with `error.tsx`. RLS
 * shortening the answer (a viewer cannot read colleagues' profiles) is not a
 * failure at all — `actorLabel()` falls back to a short id.
 */
async function bacaLabelPelaku(
  client: DbClient,
  ids: readonly string[],
): Promise<ReferenceLabels> {
  if (ids.length === 0) return {};
  try {
    return await readProfileLabels(client, ids);
  } catch (error) {
    console.error("[log] gagal memuat nama pelaku", error);
    return {};
  }
}

function PagerLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="rounded-md border border-input px-3 py-1.5 text-sm opacity-50"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
    >
      {label}
    </Link>
  );
}
