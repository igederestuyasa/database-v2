/**
 * One Seed = one transaction = one Batch.
 *
 * ⚠️ SCRIPT-ONLY MODULE. It imports `pg`, a devDependency, so importing it from
 * anything under `app/` or `components/` would break `next build` — which is
 * the intended failure. `scripts/seed-from-excel.ts` is its only caller
 * (CLAUDE.md allows `scripts/**` the privileged paths).
 *
 * WHY THE SEED DOES NOT USE supabase-js
 * ---------------------------------------------------------------------------
 * `begin_batch()` sets `app.batch_id` with `set_config(..., p_local => true)`,
 * which lives until the end of the **transaction**. supabase-js talks to
 * PostgREST over HTTP, so each insert would be its own request and its own
 * transaction: ~1.475 Karyawan would land as ~1.475 automatic `edit` Batch
 * entries, and "kembalikan Seed ini" (ROADMAP Fase 1, PRD #16) would undo one
 * row. The other way out — `p_local => false` — leaks the batch id onto a
 * pooled connection and is refused by ADR-005 §9.
 *
 * A one-shot script does not have that problem: it owns its connection, so it
 * can open a real transaction and keep it open. `pg` is already a
 * devDependency (it drives `scripts/gen-types-from-pg.ts`), so this costs no
 * new dependency (ADR-005 §1, ADR-006).
 *
 * WHAT THIS BUYS THE SEED
 *   * one `batches` row of jenis `seed` for the entire import;
 *   * `app.batch_id` set **transaction-locally** — the safe scope, the one
 *     ADR-005 §9 keeps as the default, with nothing to leak afterwards;
 *   * all-or-nothing: a row that fails halfway rolls the whole Seed back
 *     instead of leaving half a company in the database;
 *   * a direct connection is the table owner, so RLS does not stand between a
 *     legitimate one-off import and the tables — and `begin_batch()` allows it
 *     because there is no JWT at all (ADR-005 §9).
 *
 * USAGE (from `scripts/seed-from-excel.ts`)
 *
 *     import { runSeedBatch } from "@/lib/revisions/seedBatch";
 *
 *     const { batchId } = await runSeedBatch(
 *       { keterangan: `Seed awal dari ${path.basename(file)}` },
 *       async ({ client }) => {
 *         for (const row of rows) {
 *           await client.query(
 *             "insert into public.employees (personnel_number, full_name) values ($1, $2)",
 *             [row.personnelNumber, row.fullName],
 *           );
 *         }
 *       },
 *     );
 *
 * Everything inside the callback is one Batch. Throw to roll the Seed back.
 */
import { Client } from "pg";

/**
 * Where the Seed connects.
 *
 * A **direct** Postgres connection string, not the PostgREST URL: on Supabase
 * that is the "Connection string / Direct connection" value, locally it is the
 * test database. Checked in order, first one wins.
 */
export const SEED_CONNECTION_ENV_VARS = [
  "HC_SEED_DB_URL",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "HC_LOCAL_DB_URL",
] as const;

export type SeedBatchOptions = {
  /** `batches.keterangan`, shown verbatim in the Log Perubahan. */
  keterangan?: string | null;
  /** Overrides the environment lookup. */
  connectionString?: string;
};

export type SeedBatchContext = {
  /** The connected client, inside the open transaction. */
  client: Client;
  /** `batches.id` — every write in this callback is logged under it. */
  batchId: string;
};

export type SeedBatchOutcome<T> = {
  batchId: string;
  result: T;
};

/** Thrown when the Seed Batch itself could not be opened or committed. */
export class SeedBatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "SeedBatchError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** The first connection string set in the environment, or `null`. */
export function resolveSeedConnectionString(): string | null {
  for (const name of SEED_CONNECTION_ENV_VARS) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * A `pg.Client` for the Seed — **not** connected yet.
 *
 * Throws with the list of environment variables it looked at, so a staf HC
 * running the Seed once gets told what to set rather than a driver error.
 */
export function createSeedClient(connectionString?: string): Client {
  const resolved = connectionString?.trim() || resolveSeedConnectionString();
  if (!resolved) {
    throw new SeedBatchError(
      `Koneksi database untuk Seed belum diatur. Isi salah satu environment variable: ${SEED_CONNECTION_ENV_VARS.join(", ")} (lihat .env.example).`,
    );
  }
  return new Client({ connectionString: resolved });
}

/**
 * Run `fn` inside ONE transaction and ONE Batch of jenis `seed`, on a client
 * the caller already connected.
 *
 * Commits when `fn` returns, rolls back when it throws — and the rollback
 * takes the `batches` row with it, so a failed Seed leaves no half-Batch in
 * the Log Perubahan.
 */
export async function withSeedBatch<T>(
  client: Client,
  options: SeedBatchOptions,
  fn: (ctx: SeedBatchContext) => Promise<T>,
): Promise<SeedBatchOutcome<T>> {
  await client.query("begin");

  let batchId: string;
  try {
    // p_local = true: the batch id lives exactly as long as this transaction,
    // which is exactly as long as the Seed. Nothing to leak, nothing to clear.
    const opened = await client.query<{ id: string }>(
      "select public.begin_batch('seed', $1, true) as id",
      [options.keterangan ?? null],
    );
    batchId = opened.rows[0]?.id;
    if (!batchId) throw new SeedBatchError("begin_batch tidak mengembalikan id Batch.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error instanceof SeedBatchError) throw error;
    throw new SeedBatchError("Gagal memulai Batch Seed.", { cause: error });
  }

  try {
    const result = await fn({ client, batchId });
    await client.query("commit");
    return { batchId, result };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

/**
 * `withSeedBatch()` plus the connection: connect, run, commit, disconnect.
 *
 * This is what `scripts/seed-from-excel.ts` should call.
 */
export async function runSeedBatch<T>(
  options: SeedBatchOptions,
  fn: (ctx: SeedBatchContext) => Promise<T>,
): Promise<SeedBatchOutcome<T>> {
  const client = createSeedClient(options.connectionString);
  await client.connect();
  try {
    return await withSeedBatch(client, options, fn);
  } finally {
    await client.end().catch(() => undefined);
  }
}
