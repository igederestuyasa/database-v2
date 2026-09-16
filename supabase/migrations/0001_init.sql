-- ============================================================================
-- HC Core — 0001_init.sql
-- Skema lengkap: tabel, view, trigger, RLS, dan RPC.
--
-- One of exactly TWO migration files (the other is 0002_batch_operations.sql,
-- the Postgres functions behind Merge/Revert — ADR-006). Every table, view,
-- trigger, policy and grant HC Core needs lives here. See ARCHITECTURE.md §3
-- and §5. The directory is frozen at two: change these files in place.
--
-- Portability: plain PostgreSQL 15+. The only Supabase-specific dependency is
-- the `auth` schema (`auth.users`, `auth.uid()`) and the three Supabase roles
-- (`anon`, `authenticated`, `service_role`). For local verification those are
-- stubbed by `db/local/00-shim.sql` — that shim is NOT part of this migration
-- and must never be applied to production.
--
-- Hard rules enforced here (CLAUDE.md, ADR-003):
--   * Every INSERT/UPDATE on a LOGGED TABLE is written to `revisions` by
--     trigger, never by application code. There are SEVEN logged tables:
--       employees, employee_private, org_units, jabatan, lookups, api_keys,
--       profiles
--   * No DELETE on the SIX data tables — enforced by BEFORE DELETE triggers
--     AND by never granting DELETE. Deactivate with status = 'nonaktif'.
--       employees, employee_private, org_units, jabatan, lookups, api_keys
--   * The two lists differ by exactly one table, on purpose: `profiles` is
--     logged (a role change is the single most audit-worthy event in an HR
--     system, PRD #13) but is NOT delete-guarded, because it hangs off
--     `auth.users` with ON DELETE CASCADE and Supabase Auth owns that
--     lifecycle. Do not "fix" this by making the lists match.
--   * `revisions` is append-only; `batches` may only ever have
--     `reverted_by_batch_id` filled in.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------

-- The file is written to be re-runnable (`create ... if not exists`,
-- `drop trigger if exists`), which emits a wall of "does not exist, skipping"
-- notices on a fresh database. Warnings and errors still come through.
set client_min_messages = warning;

-- gen_random_uuid() is in core Postgres from v13 on; pgcrypto is kept for
-- older servers and for digest() used when hashing API keys server-side.
create extension if not exists pgcrypto;

-- Trigram index on full_name is optional (ARCHITECTURE.md §3). Skip silently
-- when the contrib package is unavailable.
do $ext$
begin
  begin
    create extension if not exists pg_trgm;
  exception
    when others then
      raise notice 'pg_trgm tidak tersedia; index trigram pada full_name dilewati';
  end;
end
$ext$;

create schema if not exists public;
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. Helper functions (identity & role)
-- ----------------------------------------------------------------------------

-- auth.uid() wrapped so the schema still loads on a Postgres without Supabase
-- Auth mounted. Returns NULL for service-role / script contexts.
create or replace function public.current_actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  return auth.uid();
exception
  -- Only tolerate "Supabase Auth is not mounted on this server" — that is what
  -- keeps the schema portable to a plain Postgres. A malformed JWT must raise,
  -- so callers fail closed instead of being mistaken for an anonymous script.
  when undefined_function or invalid_schema_name then
    return null;
end;
$fn$;

comment on function public.current_actor_id() is
  'ID pengguna yang sedang login (auth.uid()), atau NULL untuk konteks service-role/script.';

-- NOTE: `current_app_role()` and `is_admin()` read `public.profiles`, so they
-- are defined in section 3b, after the tables exist. They are SECURITY
-- DEFINER, and the planner never inlines a SECURITY DEFINER function (nor one
-- with a `set search_path`), so every RLS policy calls them as
-- `(select public.is_admin())` — a scalar subquery the planner turns into an
-- InitPlan evaluated once per query, instead of once per row. See section 9.

-- ----------------------------------------------------------------------------
-- 2. Generic triggers
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- Machine-enforced version of the "no DELETE" rule in CLAUDE.md. Statement
-- level, so even a DELETE that matches zero rows is rejected loudly.
create or replace function public.prevent_delete()
returns trigger
language plpgsql
as $fn$
begin
  raise exception
    'DELETE tidak diizinkan pada tabel %.%. Nonaktifkan barisnya dengan status = ''nonaktif'' (CLAUDE.md, ADR-003).',
    tg_table_schema, tg_table_name
    using errcode = '42501';
end;
$fn$;

-- `revisions` is append-only: no UPDATE, no DELETE, ever.
create or replace function public.prevent_revision_mutation()
returns trigger
language plpgsql
as $fn$
begin
  raise exception
    'Tabel revisions bersifat append-only; % ditolak (CLAUDE.md, ADR-003).',
    tg_op
    using errcode = '42501';
end;
$fn$;

-- `batches` may only ever have reverted_by_batch_id filled in.
create or replace function public.guard_batch_update()
returns trigger
language plpgsql
as $fn$
begin
  if to_jsonb(old) - 'reverted_by_batch_id' <> to_jsonb(new) - 'reverted_by_batch_id' then
    raise exception
      'Batch hanya boleh diubah pada kolom reverted_by_batch_id (CLAUDE.md, ADR-003).'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. Tables
-- ----------------------------------------------------------------------------

-- 3.1 batches — sekumpulan Revisi dari satu tindakan (CONTEXT.md: Batch)
create table if not exists public.batches (
  id                    uuid primary key default gen_random_uuid(),
  jenis                 text not null
                          check (jenis in ('edit','create','deactivate','merge','rename','seed','revert')),
  keterangan            text,
  actor_id              uuid references auth.users (id),
  reverted_by_batch_id  uuid references public.batches (id),
  created_at            timestamptz not null default now()
);

comment on table public.batches is
  'Batch: sekumpulan Revisi yang terjadi karena satu tindakan (satu simpan, satu merge, satu seed, satu revert). Satuan yang bisa di-revert utuh.';

create index if not exists batches_created_at_idx on public.batches (created_at desc);
create index if not exists batches_jenis_idx on public.batches (jenis);
-- `/log?status=belum|sudah` filters on this FK (lib/db/revisions.ts:listBatches),
-- and Postgres does not index a foreign key on its own.
create index if not exists batches_reverted_by_idx on public.batches (reverted_by_batch_id);

-- 3.2 revisions — satu baris per perubahan satu baris tabel (CONTEXT.md: Revisi)
create table if not exists public.revisions (
  id          bigserial primary key,
  batch_id    uuid not null references public.batches (id),
  table_name  text not null,
  row_id      uuid not null,
  action      text not null check (action in ('insert','update')),
  before      jsonb,
  after       jsonb not null,
  actor_id    uuid,
  created_at  timestamptz not null default now(),
  constraint revisions_before_null_on_insert
    check ((action = 'insert' and before is null) or (action = 'update' and before is not null))
);

comment on table public.revisions is
  'Revisi: satu versi tersimpan dari satu baris tabel (before/after/pelaku/waktu/batch). Diisi HANYA oleh trigger log_revision, append-only.';

create index if not exists revisions_row_idx on public.revisions (table_name, row_id, id desc);
create index if not exists revisions_batch_idx on public.revisions (batch_id);

-- 3.3 org_units — Unit Organisasi (hierarki satu tabel, ADR-002)
create table if not exists public.org_units (
  id              uuid primary key default gen_random_uuid(),
  kode            text not null unique,
  nama            text not null,
  tipe            text not null
                    check (tipe in ('direktorat','divisi','departemen','bagian','sub_bagian','proyek')),
  -- parent_id NULL is only *meant* for `direktorat`, but is deliberately not a
  -- constraint: dirty seed data must be able to land, and orphans are surfaced
  -- on the "Perlu Dibereskan" page instead (ARCHITECTURE.md §3).
  parent_id       uuid references public.org_units (id),
  status          text not null default 'aktif' check (status in ('aktif','nonaktif')),
  merged_into_id  uuid references public.org_units (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.org_units is
  'Unit Organisasi: satu simpul hierarki HK (direktorat, divisi, departemen, bagian, sub bagian, proyek). Kode tetap, nama boleh berubah.';

create index if not exists org_units_parent_idx on public.org_units (parent_id);
create index if not exists org_units_tipe_idx on public.org_units (tipe);
create index if not exists org_units_status_idx on public.org_units (status);
create index if not exists org_units_nama_lower_idx on public.org_units (lower(nama));

-- 3.4 jabatan — Jabatan (nama pekerjaan, bukan kursi — ADR-002)
create table if not exists public.jabatan (
  id              uuid primary key default gen_random_uuid(),
  kode            text not null unique,
  nama            text not null,
  status          text not null default 'aktif' check (status in ('aktif','nonaktif')),
  merged_into_id  uuid references public.jabatan (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.jabatan is
  'Jabatan: nama pekerjaan yang bisa dipegang banyak Karyawan sekaligus. Bukan Formasi/kursi (ADR-002).';

create index if not exists jabatan_status_idx on public.jabatan (status);
create index if not exists jabatan_nama_lower_idx on public.jabatan (lower(nama));

-- 3.5 lookups — daftar pilihan berkode
-- CATATAN: daftar `tipe` di CHECK ini WAJIB sama persis dengan
-- lib/validation/lookupTypes.ts (CLAUDE.md). scripts/verify-schema.sql
-- membandingkan keduanya.
create table if not exists public.lookups (
  id              uuid primary key default gen_random_uuid(),
  tipe            text not null check (tipe in (
                    'gender',
                    'work_contract',
                    'person_grade',
                    'job_grade',
                    'legal_entity',
                    'klasifikasi_rekrutmen',
                    'teknik_non_teknik',
                    'bod_range',
                    'band_jabatan',
                    'kategori_penempatan',
                    'kategori_fungsi'
                  )),
  kode            text not null,
  label           text not null,
  urutan          integer,
  status          text not null default 'aktif' check (status in ('aktif','nonaktif')),
  merged_into_id  uuid references public.lookups (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint lookups_tipe_kode_key unique (tipe, kode)
);

comment on table public.lookups is
  'Lookup: satu nilai pilihan berkode di dalam satu tipe daftar (mis. job_grade -> "Pratama III - 13"). Halaman UI-nya bernama Master Data.';

create index if not exists lookups_tipe_idx on public.lookups (tipe);
create index if not exists lookups_status_idx on public.lookups (status);
create index if not exists lookups_label_lower_idx on public.lookups (lower(label));

-- 3.6 employees — Karyawan
create table if not exists public.employees (
  id                        uuid primary key default gen_random_uuid(),
  personnel_number          text not null unique,
  nip                       text unique,
  full_name                 text not null,

  org_unit_id               uuid references public.org_units (id),
  jabatan_id                uuid references public.jabatan (id),

  -- Reference columns are always FK uuids into `lookups` (CLAUDE.md). The
  -- matching `lookups.tipe` is enforced by trigger, not by CHECK, because a
  -- CHECK cannot read another table.
  gender_id                 uuid references public.lookups (id),
  work_contract_id          uuid references public.lookups (id),
  person_grade_id           uuid references public.lookups (id),
  job_grade_id              uuid references public.lookups (id),
  legal_entity_id           uuid references public.lookups (id),
  klasifikasi_rekrutmen_id  uuid references public.lookups (id),
  teknik_non_teknik_id      uuid references public.lookups (id),
  bod_range_id              uuid references public.lookups (id),
  band_jabatan_id           uuid references public.lookups (id),
  kategori_penempatan_id    uuid references public.lookups (id),
  kategori_fungsi_id        uuid references public.lookups (id),

  -- Free text straight from the source Excel. `keterangan_rangkap_1` and
  -- `_2` come from two duplicate headers — never merge them (CLAUDE.md).
  keterangan_pj_plt         text,
  keterangan_rangkap_1      text,
  keterangan_rangkap_2      text,
  keterangan                text,
  jurusan                   text,

  original_start_date       date,
  tanggal_diangkat          date,
  tanggal_promosi_pg        date,
  tanggal_promosi_jg        date,
  tanggal_keluar            date,

  nomor_surat_pg            text,
  nomor_surat_jg            text,

  status                    text not null default 'aktif' check (status in ('aktif','nonaktif')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.employees is
  'Karyawan: satu orang pegawai HK. Business key = personnel_number. Tidak pernah dihapus; keluar = status ''nonaktif'' + tanggal_keluar.';

create index if not exists employees_status_idx on public.employees (status);
create index if not exists employees_org_unit_idx on public.employees (org_unit_id);
create index if not exists employees_jabatan_idx on public.employees (jabatan_id);
create index if not exists employees_full_name_lower_idx on public.employees (lower(full_name));
create index if not exists employees_updated_at_idx on public.employees (updated_at desc);

do $trgm$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists employees_full_name_trgm_idx
               on public.employees using gin (full_name gin_trgm_ops)';
  end if;
end
$trgm$;

-- 3.7 employee_private — Data Pribadi Sensitif (PRD #22)
create table if not exists public.employee_private (
  employee_id     uuid primary key references public.employees (id),
  date_of_birth   date,
  place_of_birth  text,
  religion        text,
  marital_status  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.employee_private is
  'Data Pribadi Sensitif: agama, tanggal & tempat lahir, status pernikahan. Satu baris per Karyawan (dibuat otomatis, boleh kosong). Hanya admin. TIDAK PERNAH keluar lewat API.';

-- 3.8 api_keys — Konsumen (ADR-004)
create table if not exists public.api_keys (
  id              uuid primary key default gen_random_uuid(),
  nama_konsumen   text not null,
  key_prefix      text,
  key_hash        text unique,
  allowed_fields  text[] not null default '{}'::text[],
  status          text not null default 'aktif' check (status in ('aktif','nonaktif')),
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.api_keys is
  'API Key: kredensial satu Konsumen. Menyimpan SHA-256 key (key_hash) dan whitelist kolom v_employees_api (allowed_fields).';

create index if not exists api_keys_status_idx on public.api_keys (status);

-- 3.9 profiles — Pengguna aplikasi
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'viewer' check (role in ('admin','viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Pengguna UI: admin (boleh mengubah apa pun + melihat Data Pribadi Sensitif) atau viewer (hanya baca). Dibuat otomatis saat user pertama kali login.';

-- ----------------------------------------------------------------------------
-- 3b. Role helpers (need public.profiles to exist)
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER so that RLS policies on `profiles` cannot recurse into
-- themselves when they ask "is the caller an admin?".
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select p.role
  from public.profiles p
  where p.id = public.current_actor_id();
$fn$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce(public.current_app_role() = 'admin', false);
$fn$;

comment on function public.is_admin() is
  'TRUE kalau pengguna yang login punya profiles.role = ''admin''. Dipakai semua policy RLS tulis.';

-- ----------------------------------------------------------------------------
-- 4. Batch helpers (RPC) — dipakai fungsi merge/revert di 0002_batch_operations.sql
--    dan skrip seed lewat koneksi langsung (lib/revisions/seedBatch.ts).
--    TIDAK dipanggil dari Server Action: lihat ADR-006.
-- ----------------------------------------------------------------------------

create or replace function public.current_batch_id()
returns uuid
language plpgsql
stable
set search_path = public, pg_catalog
as $fn$
declare
  v_raw text;
begin
  v_raw := nullif(current_setting('app.batch_id', true), '');
  if v_raw is null then
    return null;
  end if;
  return v_raw::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$fn$;

-- Opens a Batch and points `app.batch_id` at it so that every subsequent
-- INSERT/UPDATE in the same scope is logged under it (ADR-003).
--
-- p_local = true (DEFAULT) -> the setting lives until the end of the current
--     TRANSACTION. This is the only safe mode over a pooled connection, so it
--     is the default: run the whole batch inside one statement or one RPC
--     (merge, revert, seed).
-- p_local = false -> the setting lives for the rest of the SESSION. Opt into
--     this ONLY when the caller owns the connection for the whole batch (a
--     seed script on a direct connection), and always call end_batch() in a
--     `finally`. Otherwise a pooled connection carries `app.batch_id` into the
--     next request and folds an unrelated user's writes into this batch —
--     which then makes "revert this batch" undo their work too.
create or replace function public.begin_batch(
  p_jenis       text,
  p_keterangan  text default null,
  p_local       boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id     uuid;
  v_actor  uuid;
begin
  if p_jenis is null
     or p_jenis not in ('edit','create','deactivate','merge','rename','seed','revert') then
    raise exception 'Jenis batch tidak dikenal: %', coalesce(p_jenis, '(null)')
      using errcode = '22023';
  end if;

  v_actor := public.current_actor_id();

  -- Gate on the presence of a JWT, not on the actor resolving: a malformed or
  -- unrecognised token must be refused, not mistaken for a trusted script.
  -- No JWT at all means service-role or a seed script on a direct connection,
  -- which is allowed — EXECUTE is granted only to `authenticated` and
  -- `service_role`, never to `anon`.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not public.is_admin() then
    raise exception 'Hanya admin yang boleh memulai batch perubahan'
      using errcode = '42501';
  end if;

  insert into public.batches (jenis, keterangan, actor_id)
  values (p_jenis, p_keterangan, v_actor)
  returning id into v_id;

  perform set_config('app.batch_id', v_id::text, p_local);
  return v_id;
end;
$fn$;

comment on function public.begin_batch(text, text, boolean) is
  'Membuka Batch baru dan mengarahkan app.batch_id ke sana. Hanya berguna di dalam satu transaksi: fungsi merge/revert di 0002, atau skrip seed. Lihat ADR-003 & ADR-006.';

create or replace function public.end_batch()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  -- Clear both scopes: a transaction-local value shadows the session one, so
  -- clearing only the session would leave a stale batch id in effect.
  perform set_config('app.batch_id', '', true);
  perform set_config('app.batch_id', '', false);
end;
$fn$;

comment on function public.end_batch() is
  'Melepas app.batch_id (scope transaksi maupun sesi). WAJIB dipanggil setelah begin_batch(p_local => false) agar koneksi pooled tidak membawa batch id ke request berikutnya.';

-- ----------------------------------------------------------------------------
-- 5. log_revision — the heart of the system (ADR-003)
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER: the trigger owns the write to `revisions`/`batches`, so a
-- viewer cannot forge or suppress a log entry, and no RLS policy is needed on
-- the insert path.
create or replace function public.log_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_batch_id  uuid;
  v_actor     uuid;
  v_before    jsonb;
  v_after     jsonb;
  v_row_id    uuid;
  v_action    text;
begin
  v_after := to_jsonb(new);

  if tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    -- Housekeeping-only writes are not Revisi. `updated_at` always moves and
    -- `api_keys.last_used_at` is touched on every consumer request; logging
    -- those would bury real changes under noise. Any other column change is
    -- always logged. (Documented in ADR-005.)
    if (v_before - 'updated_at' - 'last_used_at')
       = (v_after - 'updated_at' - 'last_used_at') then
      return null;
    end if;
    v_action := 'update';
  else
    v_before := null;
    v_action := 'insert';
  end if;

  v_actor := public.current_actor_id();

  -- Reuse the batch the caller opened, if it still exists.
  v_batch_id := public.current_batch_id();
  if v_batch_id is not null
     and not exists (select 1 from public.batches b where b.id = v_batch_id) then
    v_batch_id := null;
  end if;

  -- No batch set? Make one. This is what guarantees that *no* change can
  -- escape the log, however it was written (ADR-003).
  --
  -- Since ADR-006 this is not the exceptional path but the NORMAL one: an
  -- ordinary Server Action writes its single statement without opening a Batch,
  -- and this is the Batch that ends up holding its Revisi and showing on
  -- `/log`. The keterangan is therefore read by staf HC, not by a developer
  -- debugging a missing batch id — so it says something plain instead of
  -- naming this trigger. The Revisi rows carry the detail (which table, which
  -- row, which columns moved).
  if v_batch_id is null then
    insert into public.batches (jenis, keterangan, actor_id)
    values ('edit', 'Perubahan data', v_actor)
    returning id into v_batch_id;
    -- transaction-local: the rest of this statement/transaction joins the
    -- same batch, but nothing leaks into the next request on this connection.
    perform set_config('app.batch_id', v_batch_id::text, true);
  end if;

  -- Every data table is keyed by `id`, except employee_private (employee_id).
  v_row_id := coalesce(v_after ->> 'id', v_after ->> 'employee_id')::uuid;

  insert into public.revisions (batch_id, table_name, row_id, action, before, after, actor_id)
  values (v_batch_id, tg_table_name, v_row_id, v_action, v_before, v_after, v_actor);

  return null;
end;
$fn$;

comment on function public.log_revision() is
  'Trigger AFTER INSERT OR UPDATE pada semua tabel data. Menulis satu baris revisions per baris yang berubah, membuat batch ''edit'' otomatis kalau app.batch_id kosong (ADR-003).';

-- ----------------------------------------------------------------------------
-- 6. Domain-specific triggers
-- ----------------------------------------------------------------------------

-- 6.1 org_units: no cycles (ARCHITECTURE.md §3)
create or replace function public.org_units_prevent_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_parent  uuid;
  v_depth   integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception
      'Unit Organisasi "%" tidak boleh menjadi induk dirinya sendiri.', new.nama
      using errcode = '23514';
  end if;

  v_parent := new.parent_id;
  while v_parent is not null loop
    if v_parent = new.id then
      raise exception
        'Induk baru untuk Unit Organisasi "%" membuat siklus pada hierarki.', new.nama
        using errcode = '23514';
    end if;

    v_depth := v_depth + 1;
    if v_depth > 64 then
      raise exception
        'Hierarki Unit Organisasi terlalu dalam (>64) atau sudah mengandung siklus.'
        using errcode = '23514';
    end if;

    select o.parent_id into v_parent from public.org_units o where o.id = v_parent;
  end loop;

  return new;
end;
$fn$;

-- 6.2 employees: each *_id must point at a lookup of the matching tipe
create or replace function public.assert_lookup_tipe(
  p_id     uuid,
  p_tipe   text,
  p_kolom  text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if p_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.lookups l where l.id = p_id and l.tipe = p_tipe
  ) then
    raise exception
      'Kolom % harus merujuk Lookup bertipe "%" (id % tidak cocok).', p_kolom, p_tipe, p_id
      using errcode = '23514';
  end if;
end;
$fn$;

create or replace function public.employees_validate_lookups()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  perform public.assert_lookup_tipe(new.gender_id,                'gender',                'gender_id');
  perform public.assert_lookup_tipe(new.work_contract_id,         'work_contract',         'work_contract_id');
  perform public.assert_lookup_tipe(new.person_grade_id,          'person_grade',          'person_grade_id');
  perform public.assert_lookup_tipe(new.job_grade_id,             'job_grade',             'job_grade_id');
  perform public.assert_lookup_tipe(new.legal_entity_id,          'legal_entity',          'legal_entity_id');
  perform public.assert_lookup_tipe(new.klasifikasi_rekrutmen_id, 'klasifikasi_rekrutmen', 'klasifikasi_rekrutmen_id');
  perform public.assert_lookup_tipe(new.teknik_non_teknik_id,     'teknik_non_teknik',     'teknik_non_teknik_id');
  perform public.assert_lookup_tipe(new.bod_range_id,             'bod_range',             'bod_range_id');
  perform public.assert_lookup_tipe(new.band_jabatan_id,          'band_jabatan',          'band_jabatan_id');
  perform public.assert_lookup_tipe(new.kategori_penempatan_id,   'kategori_penempatan',   'kategori_penempatan_id');
  perform public.assert_lookup_tipe(new.kategori_fungsi_id,       'kategori_fungsi',       'kategori_fungsi_id');
  return new;
end;
$fn$;

-- 6.3 employees: auto-create the empty employee_private row (PRD #22)
create or replace function public.employees_autocreate_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  insert into public.employee_private (employee_id)
  values (new.id)
  on conflict (employee_id) do nothing;
  return null;
end;
$fn$;

-- 6.4 auth.users: create the profile, restricted to the office email domain
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_domain text;
begin
  -- Precedence: the `app.allowed_email_domain` setting when one is present,
  -- otherwise the literal below. The setting can be installed with
  --   alter database <db> set app.allowed_email_domain = '...';
  -- on a self-managed Postgres (db/local/00-shim.sql does it for the local
  -- harness), but NOT on Supabase: its `postgres` role is not a superuser,
  -- and since PostgreSQL 15 only a superuser may store a custom `app.*`
  -- parameter that way, so the statement fails there with 42501. On Supabase
  -- the literal IS the configuration — change it here, and keep it identical
  -- to DEFAULT_ALLOWED_EMAIL_DOMAIN in lib/auth/domain.ts (a test checks
  -- that) and to ALLOWED_EMAIL_DOMAIN in the app environment.
  v_domain := lower(coalesce(
    nullif(current_setting('app.allowed_email_domain', true), ''),
    'hutamakarya.com'
  ));

  if new.email is null or lower(split_part(new.email, '@', 2)) <> v_domain then
    raise exception
      'Pendaftaran ditolak: % bukan email kantor (@%).', coalesce(new.email, '(kosong)'), v_domain
      using errcode = '42501';
  end if;

  -- Everyone starts as viewer. Promote the first admin manually:
  --   update public.profiles set role = 'admin' where email = '...';
  insert into public.profiles (id, email, role)
  values (new.id, lower(new.email), 'viewer')
  on conflict (id) do nothing;

  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 7. Trigger wiring
-- ----------------------------------------------------------------------------

-- updated_at on every table that has the column
drop trigger if exists set_updated_at on public.employees;
create trigger set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.employee_private;
create trigger set_updated_at before update on public.employee_private
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.org_units;
create trigger set_updated_at before update on public.org_units
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.jabatan;
create trigger set_updated_at before update on public.jabatan
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.lookups;
create trigger set_updated_at before update on public.lookups
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.api_keys;
create trigger set_updated_at before update on public.api_keys
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- log_revision on ALL SEVEN logged tables (ADR-003).
-- Trigger names are chosen so that `log_revision` sorts before
-- `zz_autocreate_private`: the employees Revisi gets the lower revisions.id,
-- which is the order revertBatch() wants to see.
drop trigger if exists log_revision on public.employees;
create trigger log_revision after insert or update on public.employees
  for each row execute function public.log_revision();

drop trigger if exists log_revision on public.employee_private;
create trigger log_revision after insert or update on public.employee_private
  for each row execute function public.log_revision();

drop trigger if exists log_revision on public.org_units;
create trigger log_revision after insert or update on public.org_units
  for each row execute function public.log_revision();

drop trigger if exists log_revision on public.jabatan;
create trigger log_revision after insert or update on public.jabatan
  for each row execute function public.log_revision();

drop trigger if exists log_revision on public.lookups;
create trigger log_revision after insert or update on public.lookups
  for each row execute function public.log_revision();

drop trigger if exists log_revision on public.api_keys;
create trigger log_revision after insert or update on public.api_keys
  for each row execute function public.log_revision();

-- `profiles` is logged too: promoting an account from viewer to admin is the
-- change most worth auditing in this system, and PRD #13 says "setiap
-- perubahan pada tabel mana pun". Unlike the six data tables it gets NO
-- delete guard — see the header comment.
drop trigger if exists log_revision on public.profiles;
create trigger log_revision after insert or update on public.profiles
  for each row execute function public.log_revision();

-- no DELETE on the six data tables (profiles deliberately excluded)
drop trigger if exists no_delete on public.employees;
create trigger no_delete before delete on public.employees
  for each statement execute function public.prevent_delete();

drop trigger if exists no_delete on public.employee_private;
create trigger no_delete before delete on public.employee_private
  for each statement execute function public.prevent_delete();

drop trigger if exists no_delete on public.org_units;
create trigger no_delete before delete on public.org_units
  for each statement execute function public.prevent_delete();

drop trigger if exists no_delete on public.jabatan;
create trigger no_delete before delete on public.jabatan
  for each statement execute function public.prevent_delete();

drop trigger if exists no_delete on public.lookups;
create trigger no_delete before delete on public.lookups
  for each statement execute function public.prevent_delete();

drop trigger if exists no_delete on public.api_keys;
create trigger no_delete before delete on public.api_keys
  for each statement execute function public.prevent_delete();

-- revisions append-only; batches only ever gets reverted_by_batch_id filled
drop trigger if exists no_mutation on public.revisions;
create trigger no_mutation before update or delete on public.revisions
  for each statement execute function public.prevent_revision_mutation();

drop trigger if exists no_delete on public.batches;
create trigger no_delete before delete on public.batches
  for each statement execute function public.prevent_delete();

drop trigger if exists guard_update on public.batches;
create trigger guard_update before update on public.batches
  for each row execute function public.guard_batch_update();

-- domain triggers
drop trigger if exists org_units_no_cycle on public.org_units;
create trigger org_units_no_cycle before insert or update on public.org_units
  for each row execute function public.org_units_prevent_cycle();

drop trigger if exists employees_validate_lookups on public.employees;
create trigger employees_validate_lookups before insert or update on public.employees
  for each row execute function public.employees_validate_lookups();

drop trigger if exists zz_autocreate_private on public.employees;
create trigger zz_autocreate_private after insert on public.employees
  for each row execute function public.employees_autocreate_private();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 8. Views — all security_invoker so the base-table RLS still bites
-- ----------------------------------------------------------------------------

-- 8.1 v_employees — Karyawan + rantai Unit Organisasi + label Lookup + turunan
create or replace view public.v_employees
with (security_invoker = true) as
with recursive ancestry as (
  select
    u.id   as leaf_id,
    u.id   as node_id,
    u.nama as node_nama,
    u.tipe as node_tipe,
    u.parent_id,
    0      as lvl
  from public.org_units u
  union all
  select
    a.leaf_id,
    p.id,
    p.nama,
    p.tipe,
    p.parent_id,
    a.lvl + 1
  from ancestry a
  join public.org_units p on p.id = a.parent_id
  where a.lvl < 64
),
chain as (
  select
    leaf_id,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'direktorat'))[1] as direktorat_nama,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'divisi'))[1]     as divisi_nama,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'departemen'))[1] as departemen_nama,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'bagian'))[1]     as bagian_nama,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'sub_bagian'))[1] as sub_bagian_nama,
    (array_agg(node_nama order by lvl) filter (where node_tipe = 'proyek'))[1]     as proyek_nama
  from ancestry
  group by leaf_id
)
select
  e.id,
  e.personnel_number,
  e.nip,
  e.full_name,
  e.status,

  e.org_unit_id,
  ou.kode  as org_unit_kode,
  ou.nama  as org_unit_nama,
  ou.tipe  as org_unit_tipe,
  c.direktorat_nama,
  c.divisi_nama,
  c.departemen_nama,
  c.bagian_nama,
  c.sub_bagian_nama,
  c.proyek_nama,

  e.jabatan_id,
  j.kode as jabatan_kode,
  j.nama as jabatan_nama,

  e.gender_id,                 lg.kode  as gender_kode,                 lg.label  as gender_label,
  e.work_contract_id,          lwc.kode as work_contract_kode,          lwc.label as work_contract_label,
  e.person_grade_id,           lpg.kode as person_grade_kode,           lpg.label as person_grade_label,
  e.job_grade_id,              ljg.kode as job_grade_kode,              ljg.label as job_grade_label,
  e.legal_entity_id,           lle.kode as legal_entity_kode,           lle.label as legal_entity_label,
  e.klasifikasi_rekrutmen_id,  lkr.kode as klasifikasi_rekrutmen_kode,  lkr.label as klasifikasi_rekrutmen_label,
  e.teknik_non_teknik_id,      ltn.kode as teknik_non_teknik_kode,      ltn.label as teknik_non_teknik_label,
  e.bod_range_id,              lbr.kode as bod_range_kode,              lbr.label as bod_range_label,
  e.band_jabatan_id,           lbj.kode as band_jabatan_kode,           lbj.label as band_jabatan_label,
  e.kategori_penempatan_id,    lkp.kode as kategori_penempatan_kode,    lkp.label as kategori_penempatan_label,
  e.kategori_fungsi_id,        lkf.kode as kategori_fungsi_kode,        lkf.label as kategori_fungsi_label,

  e.keterangan_pj_plt,
  e.keterangan_rangkap_1,
  e.keterangan_rangkap_2,
  e.keterangan,
  e.jurusan,

  e.original_start_date,
  e.tanggal_diangkat,
  e.tanggal_promosi_pg,
  e.nomor_surat_pg,
  e.tanggal_promosi_jg,
  e.nomor_surat_jg,
  e.tanggal_keluar,

  -- Kolom turunan: dihitung, tidak pernah disimpan (CLAUDE.md).
  -- `*_tahun` = tahun penuh; `*_bulan` = sisa bulan setelah tahun penuh (0-11).
  (extract(year  from age(current_date, e.original_start_date)))::integer as masa_kerja_tahun,
  (extract(month from age(current_date, e.original_start_date)))::integer as masa_kerja_bulan,
  (extract(year  from age(current_date, e.tanggal_diangkat)))::integer    as masa_sejak_diangkat_tahun,
  (extract(month from age(current_date, e.tanggal_diangkat)))::integer    as masa_sejak_diangkat_bulan,
  (extract(year  from age(current_date, e.tanggal_promosi_pg)))::integer  as masa_pg_tahun,
  (extract(year  from age(current_date, e.tanggal_promosi_jg)))::integer  as masa_jg_tahun,

  e.created_at,
  e.updated_at
from public.employees e
left join public.org_units ou on ou.id = e.org_unit_id
left join chain c            on c.leaf_id = e.org_unit_id
left join public.jabatan j   on j.id = e.jabatan_id
left join public.lookups lg  on lg.id  = e.gender_id
left join public.lookups lwc on lwc.id = e.work_contract_id
left join public.lookups lpg on lpg.id = e.person_grade_id
left join public.lookups ljg on ljg.id = e.job_grade_id
left join public.lookups lle on lle.id = e.legal_entity_id
left join public.lookups lkr on lkr.id = e.klasifikasi_rekrutmen_id
left join public.lookups ltn on ltn.id = e.teknik_non_teknik_id
left join public.lookups lbr on lbr.id = e.bod_range_id
left join public.lookups lbj on lbj.id = e.band_jabatan_id
left join public.lookups lkp on lkp.id = e.kategori_penempatan_id
left join public.lookups lkf on lkf.id = e.kategori_fungsi_id;

comment on view public.v_employees is
  'Karyawan siap tampil: rantai Unit Organisasi ke atas, label semua Lookup, nama Jabatan, dan kolom turunan (masa kerja / masa PG / masa JG). Dipakai halaman daftar & detail.';

-- 8.2 v_employees_private — v_employees + Data Pribadi Sensitif + usia.
-- RLS pada employee_private (admin saja) tetap berlaku karena security_invoker.
-- JOIN-nya sengaja INNER: untuk viewer setiap baris employee_private tersaring
-- habis, sehingga view ini mengembalikan NOL baris, bukan baris dengan kolom
-- sensitif NULL. Halaman untuk viewer harus memakai v_employees.
create or replace view public.v_employees_private
with (security_invoker = true) as
select
  v.*,
  ep.date_of_birth,
  ep.place_of_birth,
  ep.religion,
  ep.marital_status,
  (extract(year from age(current_date, ep.date_of_birth)))::integer as usia
from public.v_employees v
join public.employee_private ep on ep.employee_id = v.id;

comment on view public.v_employees_private is
  'v_employees + Data Pribadi Sensitif + usia. Hanya admin (RLS employee_private). TIDAK PERNAH dibaca oleh lib/api/.';

-- 8.3 v_employees_api — subset yang boleh keluar lewat API.
-- Daftar kolom ini ADALAH semesta `api_keys.allowed_fields` dan harus sama
-- persis dengan API-CONTRACT.md §"Kolom v_employees_api yang bisa diminta".
-- tests/apiColumns.test.ts membandingkan keduanya.
create or replace view public.v_employees_api
with (security_invoker = true) as
select
  id,
  personnel_number,
  nip,
  full_name,
  status,
  tanggal_keluar,

  org_unit_id,
  org_unit_kode,
  org_unit_nama,
  org_unit_tipe,
  direktorat_nama,
  divisi_nama,
  departemen_nama,
  bagian_nama,
  sub_bagian_nama,
  proyek_nama,
  jabatan_id,
  jabatan_kode,
  jabatan_nama,
  keterangan_pj_plt,
  keterangan_rangkap_1,
  keterangan_rangkap_2,

  gender_kode,
  gender_label,
  work_contract_kode,
  work_contract_label,
  person_grade_kode,
  person_grade_label,
  job_grade_kode,
  job_grade_label,
  legal_entity_kode,
  legal_entity_label,
  klasifikasi_rekrutmen_kode,
  klasifikasi_rekrutmen_label,
  teknik_non_teknik_kode,
  teknik_non_teknik_label,
  bod_range_kode,
  bod_range_label,
  band_jabatan_kode,
  band_jabatan_label,
  kategori_penempatan_kode,
  kategori_penempatan_label,
  kategori_fungsi_kode,
  kategori_fungsi_label,

  original_start_date,
  tanggal_diangkat,
  tanggal_promosi_pg,
  nomor_surat_pg,
  tanggal_promosi_jg,
  nomor_surat_jg,

  masa_kerja_tahun,
  masa_kerja_bulan,
  masa_pg_tahun,
  masa_jg_tahun,

  jurusan,
  keterangan,
  updated_at
from public.v_employees;

comment on view public.v_employees_api is
  'Subset v_employees yang boleh keluar lewat /api/v1. Tidak memuat satu pun kolom Data Pribadi Sensitif. Daftar kolomnya = semesta api_keys.allowed_fields (ADR-004).';

-- ----------------------------------------------------------------------------
-- 9. Row Level Security (ARCHITECTURE.md §5)
--
-- Every `is_admin()` / `current_actor_id()` below is written as
-- `(select public.is_admin())`, never bare. Both functions are SECURITY
-- DEFINER (they must be, to read `profiles` without recursing into its own
-- policy), and a SECURITY DEFINER function is never inlined by the planner —
-- so a bare call in a policy is evaluated ONCE PER ROW the policy touches,
-- each call doing its own `profiles` lookup. Wrapped in `(select …)` it is an
-- InitPlan: evaluated once per query, the result reused for every row.
-- Measured on the local harness over a seed Batch of 6.000 Revisi:
-- `select count(*) from revisions where batch_id = …` went from ~100 ms
-- (6.000 `is_admin()` calls) to ~4 ms. scripts/verify-schema.sql §20 fails
-- if any policy goes back to the bare form.
-- ----------------------------------------------------------------------------

alter table public.employees        enable row level security;
alter table public.employee_private enable row level security;
alter table public.org_units        enable row level security;
alter table public.jabatan          enable row level security;
alter table public.lookups          enable row level security;
alter table public.api_keys         enable row level security;
alter table public.batches          enable row level security;
alter table public.revisions        enable row level security;
alter table public.profiles         enable row level security;

-- 9.1 employees — semua yang login boleh baca; hanya admin boleh tulis
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated using (true);

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.2 employee_private — admin saja, baca maupun tulis (PRD #22)
drop policy if exists employee_private_select on public.employee_private;
create policy employee_private_select on public.employee_private
  for select to authenticated using ((select public.is_admin()));

drop policy if exists employee_private_insert on public.employee_private;
create policy employee_private_insert on public.employee_private
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists employee_private_update on public.employee_private;
create policy employee_private_update on public.employee_private
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.3 org_units
drop policy if exists org_units_select on public.org_units;
create policy org_units_select on public.org_units
  for select to authenticated using (true);

drop policy if exists org_units_insert on public.org_units;
create policy org_units_insert on public.org_units
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists org_units_update on public.org_units;
create policy org_units_update on public.org_units
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.4 jabatan
drop policy if exists jabatan_select on public.jabatan;
create policy jabatan_select on public.jabatan
  for select to authenticated using (true);

drop policy if exists jabatan_insert on public.jabatan;
create policy jabatan_insert on public.jabatan
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists jabatan_update on public.jabatan;
create policy jabatan_update on public.jabatan
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.5 lookups
drop policy if exists lookups_select on public.lookups;
create policy lookups_select on public.lookups
  for select to authenticated using (true);

drop policy if exists lookups_insert on public.lookups;
create policy lookups_insert on public.lookups
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists lookups_update on public.lookups;
create policy lookups_update on public.lookups
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.6 api_keys — admin saja (berisi key_hash; viewer tidak boleh melihatnya)
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select to authenticated using ((select public.is_admin()));

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 9.7 batches & revisions — semua yang login boleh baca log (matriks §5);
-- menulis hanya lewat trigger (SECURITY DEFINER) atau begin_batch().
drop policy if exists batches_select on public.batches;
create policy batches_select on public.batches
  for select to authenticated using (true);

drop policy if exists batches_insert on public.batches;
create policy batches_insert on public.batches
  for insert to authenticated with check ((select public.is_admin()));

-- Only `reverted_by_batch_id` can actually change (guard_batch_update trigger).
drop policy if exists batches_update on public.batches;
create policy batches_update on public.batches
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- `revisions.after` is a jsonb snapshot of the row that changed, so a blanket
-- read policy here would hand a viewer everything RLS denies them elsewhere.
--
-- The rule: a Revisi is readable by exactly the people who may read the row it
-- describes. Each branch below mirrors that table's own SELECT policy, so the
-- log can never become a back door around it.
--
--   employee_private -> admin only            (Data Pribadi Sensitif, PRD #22)
--   api_keys         -> admin only            (key_hash)
--   profiles         -> admin, or your own    (email + role are personnel data;
--                                              mirrors profiles_select, which
--                                              already limits a viewer to their
--                                              own row)
--   everything else  -> anyone logged in      (matriks §5: viewer boleh melihat
--                                              riwayat & log)
drop policy if exists revisions_select on public.revisions;
create policy revisions_select on public.revisions
  for select to authenticated
  using (
    case table_name
      when 'employee_private' then (select public.is_admin())
      when 'api_keys'         then (select public.is_admin())
      when 'profiles'         then (select public.is_admin())
                                   or row_id = (select public.current_actor_id())
      else true
    end
  );

-- 9.8 profiles — lihat profil sendiri; admin melihat & mengubah semua
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select public.current_actor_id()) or (select public.is_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ----------------------------------------------------------------------------
-- 10. Grants
--
-- DELETE is never granted on the six data tables. That is deliberate and is
-- asserted by scripts/verify-schema.sql.
-- ----------------------------------------------------------------------------

-- read
grant select on
  public.employees,
  public.employee_private,
  public.org_units,
  public.jabatan,
  public.lookups,
  public.api_keys,
  public.batches,
  public.revisions,
  public.profiles
to authenticated;

-- write (RLS narrows these to admin)
grant insert, update on
  public.employees,
  public.employee_private,
  public.org_units,
  public.jabatan,
  public.lookups,
  public.api_keys,
  public.batches,
  public.profiles
to authenticated;

-- service_role: used by app/api/v1/** and scripts/** only. Still no DELETE.
grant select, insert, update on
  public.employees,
  public.employee_private,
  public.org_units,
  public.jabatan,
  public.lookups,
  public.api_keys,
  public.batches,
  public.profiles
to service_role;

grant select on public.revisions to service_role;
grant usage, select on sequence public.revisions_id_seq to service_role;

grant select on public.v_employees, public.v_employees_private, public.v_employees_api
  to authenticated;

-- service_role bypasses RLS, so `security_invoker` protects nothing there.
-- v_employees_private is therefore NEVER granted to it: a route under
-- app/api/v1 that names that view must fail with "permission denied" rather
-- than quietly return Data Pribadi Sensitif to a Konsumen (ADR-004).
-- The seed script still writes the underlying employee_private table directly.
grant select on public.v_employees, public.v_employees_api to service_role;

revoke all on function public.begin_batch(text, text, boolean) from public;
revoke all on function public.end_batch() from public;
grant execute on function public.begin_batch(text, text, boolean) to authenticated, service_role;
grant execute on function public.end_batch() to authenticated, service_role;
grant execute on function public.current_batch_id() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.current_actor_id() to authenticated, service_role;
reset client_min_messages;
