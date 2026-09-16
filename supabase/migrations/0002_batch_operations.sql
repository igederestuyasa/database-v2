-- ============================================================================
-- HC Core — 0002_batch_operations.sql
-- Satu tindakan = satu transaksi = satu Batch.
--
-- WHY THIS FILE EXISTS (ADR-006, read it before changing anything here)
-- ---------------------------------------------------------------------------
-- `begin_batch()` sets `app.batch_id` with `set_config(..., p_local => true)`,
-- which is scoped to the current TRANSACTION. supabase-js talks to PostgREST
-- over HTTP, so every write is its own request and therefore its own
-- transaction: by the time an UPDATE arrives, `app.batch_id` is already gone
-- and `log_revision` opens its own automatic `edit` Batch. A Merge (three
-- UPDATEs across two tables) produced three Batch entries; a Seed of ~1.475
-- Karyawan would have produced ~1.475.
--
-- That breaks the promise made in CONTEXT.md ("Batch: sekumpulan Revisi yang
-- terjadi karena satu tindakan"), PRD #16 ("membalikkan satu batch utuh"),
-- ADR-003 ("satuan yang bisa dibalikkan utuh") and ROADMAP Fase 3.
--
-- The fix is NOT `p_local => false`: a session-scoped setting rides a pooled
-- connection into the next request and folds another admin's writes into this
-- Batch. ADR-005 §9 closed that hole deliberately and it stays closed.
--
-- The fix is this file: every multi-statement unit of work becomes ONE
-- Postgres function. One RPC call is one transaction, one `app.batch_id`, one
-- Batch. Multi-row work belongs in SQL from now on (ADR-006).
--
-- SECURITY MODEL
-- ---------------------------------------------------------------------------
-- Every function here is SECURITY INVOKER (the default): it runs as the
-- calling user, so RLS on every table it touches still applies, exactly as it
-- would if the same UPDATE had arrived over PostgREST. On top of that each
-- entry point calls `assert_admin()` first, which raises 42501 for a logged-in
-- non-admin. Both, not either (CLAUDE.md: "Cek role di Server Action **dan**
-- RLS — keduanya"). SECURITY DEFINER was rejected: it would hand every caller
-- the owner's rights for the whole body, and one editing mistake later turns
-- into a privilege-escalation bug that RLS can no longer catch.
--
-- The exceptions are the functions 0001 already made SECURITY DEFINER and that
-- these call — `begin_batch()`, `is_admin()`, the `log_revision` trigger.
--
-- HARD RULES THIS FILE KEEPS (CLAUDE.md, ADR-003)
--   * No DELETE on any data table, ever — reverting an `insert` writes
--     `status = 'nonaktif'`, and `apply_revert_operation()` refuses to write
--     anything else for that kind of operation.
--   * `revisions` is never written by these functions; the `log_revision`
--     trigger does it, as always.
--   * `batches` is only ever written through `begin_batch()` plus the single
--     `reverted_by_batch_id` column.
--   * No dynamic SQL built from caller-supplied identifiers. `merge_lookup`
--     uses eleven static UPDATEs chosen by `CASE`. `apply_revert_operation`
--     does use EXECUTE, but every identifier in it comes from a hard-coded
--     allow-list or from `information_schema` — the caller's jsonb keys only
--     FILTER that catalog list, they are never interpolated.
-- ============================================================================

set client_min_messages = warning;

-- ----------------------------------------------------------------------------
-- 1. Shared admin gate
-- ----------------------------------------------------------------------------

-- The database half of `requireAdmin()`.
--
-- Gates on the PRESENCE of a JWT rather than on `auth.uid()` resolving, the
-- same way `begin_batch()` does (ADR-005 §9): a malformed or unrecognised
-- token must be refused, not mistaken for a trusted script. No JWT at all
-- means service-role or a seed script on a direct connection, which is
-- allowed — EXECUTE is granted only to `authenticated` and `service_role`,
-- never to `anon`.
create or replace function public.assert_admin(p_aksi text)
returns void
language plpgsql
stable
set search_path = public, pg_catalog
as $fn$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not public.is_admin() then
    raise exception 'Hanya admin yang boleh %.', coalesce(p_aksi, 'melakukan ini')
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.assert_admin(text) is
  'Menolak pemanggil yang login tapi bukan admin (42501). Pasangan database dari requireAdmin() di lib/actions/_guard.ts.';

-- ----------------------------------------------------------------------------
-- 2. Merge (PRD #10, ARCHITECTURE.md §4B)
--
-- Semua dalam SATU Batch jenis 'merge':
--   1. pindahkan semua Karyawan dari asal ke tujuan;
--   2. khusus Unit Organisasi, pindahkan anak-anak asal ke tujuan;
--   3. nonaktifkan asal dan catat tujuannya di merged_into_id.
--
-- Tidak pernah DELETE: baris asal tetap ada, nonaktif, menunjuk tujuannya,
-- sehingga Konsumen yang memegang id-nya tetap bisa me-resolve dan seluruh
-- tindakan bisa dikembalikan utuh (ADR-003).
-- ----------------------------------------------------------------------------

create or replace function public.merge_org_unit(
  p_source      uuid,
  p_target      uuid,
  p_keterangan  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_source     public.org_units%rowtype;
  v_target     public.org_units%rowtype;
  v_prev       text;
  v_batch_id   uuid;
  v_employees  integer;
  v_children   integer;
  v_n          integer;
  v_ancestor   uuid;
  v_depth      integer := 0;
begin
  perform public.assert_admin('menggabungkan Unit Organisasi');

  if p_source is null or p_target is null then
    raise exception 'Unit Organisasi asal dan tujuan wajib dipilih.'
      using errcode = '22023';
  end if;
  if p_source = p_target then
    raise exception 'Unit Organisasi tidak bisa digabungkan ke dirinya sendiri.'
      using errcode = '22023';
  end if;

  -- Kunci kedua baris SEBELUM dibaca, dalam urutan id yang tetap. Tanpa ini,
  -- dua admin yang menggabungkan asal yang sama pada saat bersamaan sama-sama
  -- lolos gerbang "sudah pernah digabungkan": yang kedua memindahkan nol baris
  -- (baris Karyawan sudah pindah ke tujuan yang lain) tapi tetap menulis
  -- merged_into_id ke tujuan yang salah, sehingga Konsumen yang mengikuti
  -- merged_into_id diarahkan ke unit yang keliru dan revert tidak lagi bisa
  -- mengembalikan keadaan persis. Urutan id yang tetap membuat dua Merge yang
  -- saling menyilang gagal-deadlock, bukan saling menunggu.
  perform 1 from public.org_units
   where id in (p_source, p_target)
   order by id
     for update;

  select * into v_source from public.org_units where id = p_source;
  if not found then
    raise exception 'Unit Organisasi asal tidak ditemukan.' using errcode = 'P0002';
  end if;

  select * into v_target from public.org_units where id = p_target;
  if not found then
    raise exception 'Unit Organisasi tujuan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_source.merged_into_id is not null then
    raise exception 'Unit Organisasi "%" sudah pernah digabungkan.', v_source.nama
      using errcode = '55000';
  end if;
  if v_target.merged_into_id is not null then
    raise exception
      'Unit Organisasi tujuan "%" sendiri sudah digabungkan; pilih tujuan akhirnya.',
      v_target.nama
      using errcode = '55000';
  end if;

  -- Tujuan tidak boleh berada di bawah asal: langkah 2 akan memindahkan
  -- anak-anak asal ke tujuan, dan itu membuat siklus. Trigger
  -- org_units_prevent_cycle akan menolaknya di tengah jalan; lebih baik
  -- ditolak di awal dengan pesan yang bisa dibaca staf HC.
  v_ancestor := v_target.parent_id;
  while v_ancestor is not null loop
    if v_ancestor = p_source then
      raise exception
        'Unit Organisasi tujuan "%" berada di bawah "%"; penggabungan akan membuat siklus.',
        v_target.nama, v_source.nama
        using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 64 then
      raise exception 'Hierarki Unit Organisasi terlalu dalam (>64) atau sudah mengandung siklus.'
        using errcode = '23514';
    end if;
    select o.parent_id into v_ancestor from public.org_units o where o.id = v_ancestor;
  end loop;

  -- Simpan Batch yang mungkin sedang terbuka (mis. script seed yang memanggil
  -- ini di dalam transaksinya sendiri) dan kembalikan di akhir, alih-alih
  -- memanggil end_batch() yang akan menghapus Batch milik pemanggil.
  v_prev := nullif(current_setting('app.batch_id', true), '');

  v_batch_id := public.begin_batch(
    'merge',
    coalesce(
      nullif(btrim(p_keterangan), ''),
      format('Merge Unit Organisasi: "%s" → "%s"', v_source.nama, v_target.nama)
    ),
    true
  );

  update public.employees set org_unit_id = p_target where org_unit_id = p_source;
  get diagnostics v_employees = row_count;

  update public.org_units
     set parent_id = p_target
   where parent_id = p_source
     and id <> p_source;
  get diagnostics v_children = row_count;

  update public.org_units
     set status = 'nonaktif',
         merged_into_id = p_target
   where id = p_source;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- RLS menolak diam-diam (0 baris) alih-alih melempar error. Jangan biarkan
    -- Merge "berhasil" tanpa menonaktifkan asalnya.
    raise exception 'Gagal menonaktifkan Unit Organisasi asal (% baris terpengaruh).', v_n
      using errcode = '42501';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',        v_batch_id,
    'source_id',       p_source,
    'target_id',       p_target,
    'moved_employees', v_employees,
    'moved_children',  v_children
  );
end;
$fn$;

comment on function public.merge_org_unit(uuid, uuid, text) is
  'Merge dua Unit Organisasi dalam satu Batch jenis "merge": Karyawan pindah, anak unit di-reparent, asal jadi nonaktif + merged_into_id (PRD #10).';

create or replace function public.merge_jabatan(
  p_source      uuid,
  p_target      uuid,
  p_keterangan  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_source     public.jabatan%rowtype;
  v_target     public.jabatan%rowtype;
  v_prev       text;
  v_batch_id   uuid;
  v_employees  integer;
  v_n          integer;
begin
  perform public.assert_admin('menggabungkan Jabatan');

  if p_source is null or p_target is null then
    raise exception 'Jabatan asal dan tujuan wajib dipilih.' using errcode = '22023';
  end if;
  if p_source = p_target then
    raise exception 'Jabatan tidak bisa digabungkan ke dirinya sendiri.'
      using errcode = '22023';
  end if;

  -- Kunci kedua baris SEBELUM dibaca, dalam urutan id yang tetap. Tanpa ini,
  -- dua admin yang menggabungkan asal yang sama pada saat bersamaan sama-sama
  -- lolos gerbang "sudah pernah digabungkan": yang kedua memindahkan nol baris
  -- (baris Karyawan sudah pindah ke tujuan yang lain) tapi tetap menulis
  -- merged_into_id ke tujuan yang salah, sehingga Konsumen yang mengikuti
  -- merged_into_id diarahkan ke unit yang keliru dan revert tidak lagi bisa
  -- mengembalikan keadaan persis. Urutan id yang tetap membuat dua Merge yang
  -- saling menyilang gagal-deadlock, bukan saling menunggu.
  perform 1 from public.jabatan
   where id in (p_source, p_target)
   order by id
     for update;

  select * into v_source from public.jabatan where id = p_source;
  if not found then
    raise exception 'Jabatan asal tidak ditemukan.' using errcode = 'P0002';
  end if;

  select * into v_target from public.jabatan where id = p_target;
  if not found then
    raise exception 'Jabatan tujuan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_source.merged_into_id is not null then
    raise exception 'Jabatan "%" sudah pernah digabungkan.', v_source.nama
      using errcode = '55000';
  end if;
  if v_target.merged_into_id is not null then
    raise exception 'Jabatan tujuan "%" sendiri sudah digabungkan; pilih tujuan akhirnya.',
      v_target.nama
      using errcode = '55000';
  end if;

  v_prev := nullif(current_setting('app.batch_id', true), '');

  v_batch_id := public.begin_batch(
    'merge',
    coalesce(
      nullif(btrim(p_keterangan), ''),
      format('Merge Jabatan: "%s" → "%s"', v_source.nama, v_target.nama)
    ),
    true
  );

  update public.employees set jabatan_id = p_target where jabatan_id = p_source;
  get diagnostics v_employees = row_count;

  update public.jabatan
     set status = 'nonaktif',
         merged_into_id = p_target
   where id = p_source;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Gagal menonaktifkan Jabatan asal (% baris terpengaruh).', v_n
      using errcode = '42501';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',        v_batch_id,
    'source_id',       p_source,
    'target_id',       p_target,
    'moved_employees', v_employees,
    'moved_children',  0
  );
end;
$fn$;

comment on function public.merge_jabatan(uuid, uuid, text) is
  'Merge dua Jabatan dalam satu Batch jenis "merge": semua pemegang pindah, asal jadi nonaktif + merged_into_id (PRD #10).';

-- Merge Lookup harus memindahkan kolom `employees.<tipe>_id` yang cocok dengan
-- `lookups.tipe`. Kolomnya dipilih lewat CASE atas sebelas UPDATE STATIS —
-- bukan SQL dinamis — sehingga tidak ada identifier dari pemanggil yang pernah
-- di-interpolasi, dan daftar ini tidak bisa melenceng dari CHECK constraint
-- `lookups.tipe` tanpa ketahuan: `else` di bawah menolak tipe yang belum
-- ditangani, alih-alih diam-diam membuat Karyawan yatim.
-- Daftar yang sama hidup di lib/validation/lookupTypes.ts
-- (LOOKUP_TYPE_TO_EMPLOYEE_COLUMN) dan di trigger employees_validate_lookups.
create or replace function public.merge_lookup(
  p_source      uuid,
  p_target      uuid,
  p_keterangan  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_source     public.lookups%rowtype;
  v_target     public.lookups%rowtype;
  v_prev       text;
  v_batch_id   uuid;
  v_employees  integer;
  v_n          integer;
begin
  perform public.assert_admin('menggabungkan Lookup');

  if p_source is null or p_target is null then
    raise exception 'Lookup asal dan tujuan wajib dipilih.' using errcode = '22023';
  end if;
  if p_source = p_target then
    raise exception 'Lookup tidak bisa digabungkan ke dirinya sendiri.'
      using errcode = '22023';
  end if;

  -- Kunci kedua baris SEBELUM dibaca, dalam urutan id yang tetap. Tanpa ini,
  -- dua admin yang menggabungkan asal yang sama pada saat bersamaan sama-sama
  -- lolos gerbang "sudah pernah digabungkan": yang kedua memindahkan nol baris
  -- (baris Karyawan sudah pindah ke tujuan yang lain) tapi tetap menulis
  -- merged_into_id ke tujuan yang salah, sehingga Konsumen yang mengikuti
  -- merged_into_id diarahkan ke unit yang keliru dan revert tidak lagi bisa
  -- mengembalikan keadaan persis. Urutan id yang tetap membuat dua Merge yang
  -- saling menyilang gagal-deadlock, bukan saling menunggu.
  perform 1 from public.lookups
   where id in (p_source, p_target)
   order by id
     for update;

  select * into v_source from public.lookups where id = p_source;
  if not found then
    raise exception 'Lookup asal tidak ditemukan.' using errcode = 'P0002';
  end if;

  select * into v_target from public.lookups where id = p_target;
  if not found then
    raise exception 'Lookup tujuan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_source.tipe <> v_target.tipe then
    raise exception
      'Lookup asal bertipe "%" dan tujuan bertipe "%"; merge lintas tipe akan membuat Karyawan menunjuk Lookup yang salah.',
      v_source.tipe, v_target.tipe
      using errcode = '22023';
  end if;

  if v_source.merged_into_id is not null then
    raise exception 'Lookup "%" sudah pernah digabungkan.', v_source.label
      using errcode = '55000';
  end if;
  if v_target.merged_into_id is not null then
    raise exception 'Lookup tujuan "%" sendiri sudah digabungkan; pilih tujuan akhirnya.',
      v_target.label
      using errcode = '55000';
  end if;

  v_prev := nullif(current_setting('app.batch_id', true), '');

  v_batch_id := public.begin_batch(
    'merge',
    coalesce(
      nullif(btrim(p_keterangan), ''),
      format('Merge Lookup %s: "%s" → "%s"', v_source.tipe, v_source.label, v_target.label)
    ),
    true
  );

  case v_source.tipe
    when 'gender' then
      update public.employees set gender_id = p_target where gender_id = p_source;
    when 'work_contract' then
      update public.employees set work_contract_id = p_target where work_contract_id = p_source;
    when 'person_grade' then
      update public.employees set person_grade_id = p_target where person_grade_id = p_source;
    when 'job_grade' then
      update public.employees set job_grade_id = p_target where job_grade_id = p_source;
    when 'legal_entity' then
      update public.employees set legal_entity_id = p_target where legal_entity_id = p_source;
    when 'klasifikasi_rekrutmen' then
      update public.employees set klasifikasi_rekrutmen_id = p_target where klasifikasi_rekrutmen_id = p_source;
    when 'teknik_non_teknik' then
      update public.employees set teknik_non_teknik_id = p_target where teknik_non_teknik_id = p_source;
    when 'bod_range' then
      update public.employees set bod_range_id = p_target where bod_range_id = p_source;
    when 'band_jabatan' then
      update public.employees set band_jabatan_id = p_target where band_jabatan_id = p_source;
    when 'kategori_penempatan' then
      update public.employees set kategori_penempatan_id = p_target where kategori_penempatan_id = p_source;
    when 'kategori_fungsi' then
      update public.employees set kategori_fungsi_id = p_target where kategori_fungsi_id = p_source;
    else
      raise exception
        'Tipe Lookup "%" belum punya kolom Karyawan di merge_lookup(); tambahkan cabangnya sebelum memakai tipe ini.',
        v_source.tipe
        using errcode = '22023';
  end case;
  get diagnostics v_employees = row_count;

  update public.lookups
     set status = 'nonaktif',
         merged_into_id = p_target
   where id = p_source;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Gagal menonaktifkan Lookup asal (% baris terpengaruh).', v_n
      using errcode = '42501';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',        v_batch_id,
    'source_id',       p_source,
    'target_id',       p_target,
    'moved_employees', v_employees,
    'moved_children',  0
  );
end;
$fn$;

comment on function public.merge_lookup(uuid, uuid, text) is
  'Merge dua Lookup setipe dalam satu Batch jenis "merge": kolom employees.<tipe>_id pindah, asal jadi nonaktif + merged_into_id (PRD #10).';

-- ----------------------------------------------------------------------------
-- 3. Revert (PRD #15, #16, ARCHITECTURE.md §4C)
--
-- Revert tidak pernah menghapus atau mengubah log. Ia melakukan tulisan baru,
-- yang dicatat trigger log_revision sebagai Revisi baru di dalam Batch jenis
-- 'revert'. Revert sebuah `insert` menonaktifkan barisnya, tidak pernah
-- menghapusnya (ADR-003).
-- ----------------------------------------------------------------------------

-- Satu langkah revert. Internal: entry point-nya apply_revert() dan
-- revert_batch(), yang membuka Batch-nya.
--
-- Bentuk p_op adalah `RevertOperation` dari lib/revisions/revert.ts, apa
-- adanya (kunci camelCase):
--   { revisionId, table, pkColumn, rowId, kind: 'restore'|'deactivate', values }
--
-- Keamanan EXECUTE di bawah: `table` dicocokkan ke daftar tujuh tabel ter-log
-- yang ditulis tangan di sini, `pkColumn` harus persis kolom kunci tabel itu,
-- dan daftar kolomnya diambil dari information_schema — kunci jsonb dari
-- pemanggil hanya MENYARING daftar katalog itu, tidak pernah ikut di-format
-- sebagai identifier.
create or replace function public.apply_revert_operation(p_op jsonb)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_table       text;
  v_kind        text;
  v_pk          text;
  v_expected_pk text;
  v_row_id      uuid;
  v_values      jsonb;
  v_cols        text[];
  v_sql         text;
  v_n           integer;
begin
  if p_op is null or jsonb_typeof(p_op) <> 'object' then
    raise exception 'Langkah revert tidak berbentuk objek.' using errcode = '22023';
  end if;

  v_table  := p_op ->> 'table';
  v_kind   := p_op ->> 'kind';
  v_pk     := p_op ->> 'pkColumn';
  v_values := p_op -> 'values';

  if v_table is null
     or v_table not in ('employees','employee_private','org_units','jabatan','lookups','api_keys','profiles') then
    raise exception
      'Tabel "%" bukan salah satu tujuh tabel ter-log; Revisi-nya tidak bisa dikembalikan.',
      coalesce(v_table, '(kosong)')
      using errcode = '22023';
  end if;

  -- Sama persis dengan PK_COLUMN_BY_TABLE di lib/revisions/tables.ts dan
  -- dengan coalesce(after->>'id', after->>'employee_id') di log_revision().
  v_expected_pk := case when v_table = 'employee_private' then 'employee_id' else 'id' end;
  if v_pk is distinct from v_expected_pk then
    raise exception 'Kolom kunci "%" tidak berlaku untuk tabel % (harus "%").',
      coalesce(v_pk, '(kosong)'), v_table, v_expected_pk
      using errcode = '22023';
  end if;

  begin
    v_row_id := (p_op ->> 'rowId')::uuid;
  exception
    when invalid_text_representation then
      v_row_id := null;
  end;
  if v_row_id is null then
    raise exception 'Langkah revert tidak menyebut baris yang jelas (rowId).'
      using errcode = '22023';
  end if;

  if v_kind is null or v_kind not in ('restore', 'deactivate') then
    raise exception 'Jenis langkah revert "%" tidak dikenal (hanya restore dan deactivate).',
      coalesce(v_kind, '(kosong)')
      using errcode = '22023';
  end if;

  if v_values is null or jsonb_typeof(v_values) <> 'object' then
    raise exception 'Langkah revert tidak membawa nilai yang bisa ditulis.'
      using errcode = '22023';
  end if;

  -- Membalikkan sebuah `insert` TIDAK PERNAH menghapus baris (ADR-003):
  -- satu-satunya tulisan yang boleh keluar dari langkah 'deactivate' adalah
  -- status = 'nonaktif'. Dipaksa di database, bukan cuma di TypeScript.
  if v_kind = 'deactivate' then
    if v_values is distinct from jsonb_build_object('status', 'nonaktif') then
      raise exception
        'Langkah revert "deactivate" hanya boleh menulis status = ''nonaktif'' (dapat %).',
        v_values::text
        using errcode = '22023';
    end if;
    if v_table not in ('employees','org_units','jabatan','lookups','api_keys') then
      raise exception 'Tabel % tidak punya kolom status, jadi barisnya tidak bisa dinonaktifkan.',
        v_table
        using errcode = '22023';
    end if;
  end if;

  -- Kolom yang boleh ditulis: yang masih ada di katalog, bukan kunci, bukan
  -- created_at/updated_at, dan disebut oleh `values`. Kolom yang sudah tidak
  -- dikenal skema sekarang diabaikan, bukan menggagalkan revert (ADR-003).
  select array_agg(c.column_name order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = v_table
     and c.column_name <> v_pk
     and c.column_name not in ('created_at', 'updated_at')
     and v_values ? c.column_name;

  if v_cols is null or cardinality(v_cols) = 0 then
    return 0;
  end if;

  v_sql := format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $2',
    v_table,
    (
      select string_agg(format('%I = r.%I', c.name, c.name), ', ' order by c.ord)
      from unnest(v_cols) with ordinality as c(name, ord)
    ),
    v_table,
    v_pk
  );

  execute v_sql using v_values, v_row_id;
  get diagnostics v_n = row_count;

  -- Keenam tabel data tidak pernah kehilangan baris (trigger no_delete), jadi
  -- 0 baris di sini berarti barisnya memang tidak pernah ada — atau RLS
  -- menolak diam-diam. Keduanya harus berisik, bukan dilaporkan sebagai
  -- "revert berhasil".
  if v_n = 0
     and v_table in ('employees','employee_private','org_units','jabatan','lookups','api_keys') then
    raise exception 'Baris % pada tabel % tidak bisa dikembalikan (0 baris terpengaruh).',
      v_row_id, v_table
      using errcode = 'P0002';
  end if;

  return v_n;
end;
$fn$;

comment on function public.apply_revert_operation(jsonb) is
  'Internal: menerapkan satu RevertOperation (lib/revisions/revert.ts). Hanya UPDATE, tidak pernah DELETE. Dipakai apply_revert() dan revert_batch().';

-- Pesan Indonesia untuk Revisi yang tidak bisa dikembalikan.
-- Cerminan SKIP_MESSAGES di lib/revisions/revert.ts — ubah keduanya bersamaan.
create or replace function public.revert_skip_entry(
  p_revision_id  bigint,
  p_table_name   text,
  p_row_id       uuid,
  p_reason       text
)
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select jsonb_build_object(
    'revisionId', p_revision_id,
    'tableName',  p_table_name,
    'rowId',      p_row_id,
    'reason',     p_reason,
    'keterangan', case p_reason
      when 'tabel_tidak_dikenal' then
        'Tabel ini tidak termasuk tujuh tabel ter-log, jadi Revisi-nya tidak bisa dikembalikan.'
      when 'aksi_tidak_dikenal' then
        'Aksi Revisi tidak dikenal (hanya insert dan update yang ada).'
      when 'before_kosong' then
        'Revisi update ini tidak menyimpan keadaan sebelumnya.'
      when 'tanpa_kolom_status' then
        'Baris ini dibuat oleh Revisi tersebut dan tabelnya tidak punya kolom status, sehingga tidak bisa dinonaktifkan. Hapus permanen tidak pernah dilakukan.'
      when 'tidak_ada_kolom_dipulihkan' then
        'Tidak ada kolom yang masih dikenal skema saat ini untuk dipulihkan.'
      else
        'Revisi ini tidak bisa dikembalikan.'
    end
  );
$fn$;

comment on function public.revert_skip_entry(bigint, text, uuid, text) is
  'Internal: satu entri RevertSkipped (lib/revisions/revert.ts) dalam bentuk jsonb.';

-- Rencana revert untuk SELURUH Batch — versi SQL dari planRevert() di
-- lib/revisions/revert.ts, dengan aturan yang sama persis dan bentuk keluaran
-- yang sama (`RevertPlan`, kunci camelCase).
--
-- Urutannya `revisions.id` MENURUN: satu baris yang tersentuh dua kali
-- berakhir di `before` yang paling tua, dan revert sebuah merge otomatis
-- mengaktifkan kembali unit asalnya sebelum anak-anaknya dikembalikan
-- kepadanya.
create or replace function public.revert_plan_for_batch(p_batch_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $fn$
declare
  v_rev        record;
  v_ops        jsonb := '[]'::jsonb;
  v_skipped    jsonb := '[]'::jsonb;
  v_pk         text;
  v_values     jsonb;
begin
  for v_rev in
    select r.id, r.table_name, r.row_id, r.action, r.before
      from public.revisions r
     where r.batch_id = p_batch_id
     order by r.id desc
  loop
    if v_rev.table_name not in
       ('employees','employee_private','org_units','jabatan','lookups','api_keys','profiles') then
      v_skipped := v_skipped || public.revert_skip_entry(
        v_rev.id, v_rev.table_name, v_rev.row_id, 'tabel_tidak_dikenal');
      continue;
    end if;

    if v_rev.action not in ('insert', 'update') then
      v_skipped := v_skipped || public.revert_skip_entry(
        v_rev.id, v_rev.table_name, v_rev.row_id, 'aksi_tidak_dikenal');
      continue;
    end if;

    v_pk := case when v_rev.table_name = 'employee_private' then 'employee_id' else 'id' end;

    if v_rev.action = 'insert' then
      if v_rev.table_name not in ('employees','org_units','jabatan','lookups','api_keys') then
        v_skipped := v_skipped || public.revert_skip_entry(
          v_rev.id, v_rev.table_name, v_rev.row_id, 'tanpa_kolom_status');
        continue;
      end if;
      v_ops := v_ops || jsonb_build_object(
        'revisionId', v_rev.id,
        'table',      v_rev.table_name,
        'pkColumn',   v_pk,
        'rowId',      v_rev.row_id,
        'kind',       'deactivate',
        'values',     jsonb_build_object('status', 'nonaktif')
      );
      continue;
    end if;

    if v_rev.before is null or jsonb_typeof(v_rev.before) <> 'object' then
      v_skipped := v_skipped || public.revert_skip_entry(
        v_rev.id, v_rev.table_name, v_rev.row_id, 'before_kosong');
      continue;
    end if;

    select coalesce(jsonb_object_agg(c.column_name, v_rev.before -> c.column_name), '{}'::jsonb)
      into v_values
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = v_rev.table_name
       and c.column_name <> v_pk
       and c.column_name not in ('created_at', 'updated_at')
       and v_rev.before ? c.column_name;

    if v_values = '{}'::jsonb then
      v_skipped := v_skipped || public.revert_skip_entry(
        v_rev.id, v_rev.table_name, v_rev.row_id, 'tidak_ada_kolom_dipulihkan');
      continue;
    end if;

    v_ops := v_ops || jsonb_build_object(
      'revisionId', v_rev.id,
      'table',      v_rev.table_name,
      'pkColumn',   v_pk,
      'rowId',      v_rev.row_id,
      'kind',       'restore',
      'values',     v_values
    );
  end loop;

  return jsonb_build_object(
    'jenis',      'revert',
    'keterangan', format('Kembalikan seluruh Batch %s', p_batch_id),
    'operations', v_ops,
    'skipped',    v_skipped
  );
end;
$fn$;

comment on function public.revert_plan_for_batch(uuid) is
  'Rencana revert satu Batch (bentuk RevertPlan, urut revisions.id menurun). Versi SQL dari planRevert() di lib/revisions/revert.ts.';

-- Menerapkan sebuah RevertPlan yang dibuat planRevert() di TypeScript —
-- jalur untuk "kembalikan satu Revisi" (PRD #15).
--
-- Satu panggilan = satu transaksi = satu Batch jenis 'revert'. Batch yang
-- sedang dibalikkan TIDAK ditandai di sini: `RevertPlan` sengaja tidak memuat
-- id Batch, dan menandai `reverted_by_batch_id` adalah urusan revert_batch().
create or replace function public.apply_revert(p_plan jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_ops      jsonb;
  v_op       jsonb;
  v_prev     text;
  v_batch_id uuid;
  v_applied  integer := 0;
begin
  perform public.assert_admin('mengembalikan Revisi');

  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Rencana revert tidak berbentuk objek.' using errcode = '22023';
  end if;
  if p_plan ->> 'jenis' is distinct from 'revert' then
    raise exception 'Rencana revert harus berjenis "revert" (dapat "%").',
      coalesce(p_plan ->> 'jenis', '(kosong)')
      using errcode = '22023';
  end if;

  v_ops := p_plan -> 'operations';
  if v_ops is null or jsonb_typeof(v_ops) <> 'array' then
    raise exception 'Rencana revert tidak memuat daftar langkah (operations).'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_ops) = 0 then
    -- Membuka Batch untuk nol langkah hanya mengotori Log Perubahan.
    raise exception 'Tidak ada Revisi yang bisa dikembalikan.' using errcode = '22023';
  end if;

  v_prev := nullif(current_setting('app.batch_id', true), '');

  v_batch_id := public.begin_batch(
    'revert',
    coalesce(nullif(btrim(p_plan ->> 'keterangan'), ''), 'Kembalikan Revisi'),
    true
  );

  -- jsonb_array_elements mempertahankan urutan array, dan planRevert() sudah
  -- mengurutkannya menurun berdasarkan revisions.id.
  for v_op in select value from jsonb_array_elements(v_ops) loop
    v_applied := v_applied + public.apply_revert_operation(v_op);
  end loop;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'applied',  v_applied
  );
end;
$fn$;

comment on function public.apply_revert(jsonb) is
  'Menerapkan RevertPlan dari planRevert() (lib/revisions/revert.ts) dalam satu Batch jenis "revert". Tidak menandai reverted_by_batch_id — itu tugas revert_batch().';

-- Membalikkan SATU BATCH UTUH (PRD #16).
--
-- Semua Revisi Batch itu, urut id menurun, di dalam satu Batch 'revert' baru,
-- lalu `batches.reverted_by_batch_id` diisi. Batch yang sudah pernah
-- dibalikkan ditolak.
create or replace function public.revert_batch(
  p_batch_id    uuid,
  p_keterangan  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_batch       public.batches%rowtype;
  v_plan        jsonb;
  v_op          jsonb;
  v_prev        text;
  v_new_batch   uuid;
  v_applied     integer := 0;
  v_n           integer;
begin
  perform public.assert_admin('mengembalikan Batch');

  if p_batch_id is null then
    raise exception 'Batch yang akan dikembalikan wajib disebutkan.' using errcode = '22023';
  end if;

  -- FOR UPDATE: dua admin yang menekan "Kembalikan seluruh Batch" bersamaan
  -- harus menghasilkan satu revert dan satu penolakan, bukan dua revert.
  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_batch.reverted_by_batch_id is not null then
    raise exception 'Batch ini sudah pernah dikembalikan (oleh Batch %).',
      v_batch.reverted_by_batch_id
      using errcode = '55000';
  end if;

  v_plan := public.revert_plan_for_batch(p_batch_id);

  if jsonb_array_length(v_plan -> 'operations') = 0 then
    raise exception 'Tidak ada Revisi di Batch ini yang bisa dikembalikan.'
      using errcode = '22023';
  end if;

  v_prev := nullif(current_setting('app.batch_id', true), '');

  v_new_batch := public.begin_batch(
    'revert',
    coalesce(
      nullif(btrim(p_keterangan), ''),
      format(
        'Kembalikan seluruh Batch %s%s',
        v_batch.jenis,
        case when v_batch.keterangan is null then '' else ': ' || v_batch.keterangan end
      )
    ),
    true
  );

  for v_op in select value from jsonb_array_elements(v_plan -> 'operations') loop
    v_applied := v_applied + public.apply_revert_operation(v_op);
  end loop;

  -- Satu-satunya kolom `batches` yang pernah boleh ditulis (ADR-003).
  -- `batches` tidak dipasangi log_revision, jadi ini tidak jadi Revisi.
  update public.batches
     set reverted_by_batch_id = v_new_batch
   where id = p_batch_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Gagal menandai Batch % sebagai sudah dikembalikan (% baris).',
      p_batch_id, v_n
      using errcode = '42501';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',          v_new_batch,
    'reverted_batch_id', p_batch_id,
    'applied',           v_applied,
    'skipped',           v_plan -> 'skipped'
  );
end;
$fn$;

comment on function public.revert_batch(uuid, text) is
  'Membalikkan satu Batch utuh dalam satu Batch jenis "revert" baru, lalu mengisi batches.reverted_by_batch_id. Menolak Batch yang sudah pernah dibalikkan (PRD #16).';

-- ----------------------------------------------------------------------------
-- 4. Seed awal lewat web (PRD #23, ADR-008)
--
-- Satu payload jsonb (bentuknya: lib/seed/payload.ts, SeedPayload) menjadi
-- SATU Batch jenis 'seed'. Rujukan di payload adalah INDEX 0-based ke array
-- di payload itu sendiri (induk Unit Organisasi, unit/jabatan seorang
-- Karyawan, Lookup per tipe); fungsi ini memetakan index → id lewat tiga
-- array, dalam urutan yang dipaksa FK: lookups → jabatan → org_units (induk
-- selalu lebih dulu di array) → employees → UPDATE employee_private. Baris
-- employee_private dibuat trigger zz_autocreate_private saat employees
-- di-INSERT, jadi di sini hanya diisi, persis seperti skrip CLI.
--
-- Penjaga sekali-jalan sama dengan scripts/seed-from-excel.ts: menolak kalau
-- public.employees sudah berisi, kecuali p_force (dipakai test dan orang
-- teknis; halaman web tidak pernah mengirimnya). Dua admin yang menekan
-- "Jalankan" bersamaan diserialkan pg_advisory_xact_lock, sehingga yang kedua
-- membaca tabel yang sudah terisi dan ditolak.
--
-- Semua pemeriksaan bentuk payload dilakukan SEBELUM Batch dibuka: payload
-- cacat tidak boleh meninggalkan Batch kosong di Log Perubahan.
-- ----------------------------------------------------------------------------

create or replace function public.seed_from_payload(
  p_payload     jsonb,
  p_keterangan  text    default null,
  p_force       boolean default false
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_prev        text;
  v_batch_id    uuid;
  v_first_rev   bigint;
  v_existing    bigint;
  v_n           bigint;
  v_n_org       integer;
  v_n_jab       integer;
  v_n_lk        integer;
  v_n_emp       integer;
  v_lookups     integer := 0;
  v_jabatan     integer := 0;
  v_org_units   integer := 0;
  v_employees   integer := 0;
  v_private     integer := 0;
  v_revisions   bigint  := 0;
  v_lookup_ids  uuid[]  := '{}';
  v_jab_ids     uuid[]  := '{}';
  v_org_ids     uuid[]  := '{}';
  v_unit        jsonb;
  v_i           integer;
  v_parent      integer;
  v_parent_id   uuid;
  v_new_id      uuid;
begin
  perform public.assert_admin('menjalankan Seed');

  -- 1. Bentuk payload — sebelum apa pun ditulis atau dibuka.
  if p_payload is null
     or jsonb_typeof(p_payload -> 'org_units') is distinct from 'array'
     or jsonb_typeof(p_payload -> 'jabatan')   is distinct from 'array'
     or jsonb_typeof(p_payload -> 'lookups')   is distinct from 'array'
     or jsonb_typeof(p_payload -> 'employees') is distinct from 'array' then
    raise exception 'Payload Seed tidak berbentuk: butuh empat daftar org_units, jabatan, lookups, dan employees.'
      using errcode = '22023';
  end if;

  v_n_org := jsonb_array_length(p_payload -> 'org_units');
  v_n_jab := jsonb_array_length(p_payload -> 'jabatan');
  v_n_lk  := jsonb_array_length(p_payload -> 'lookups');
  v_n_emp := jsonb_array_length(p_payload -> 'employees');

  if v_n_emp = 0 then
    raise exception 'Payload Seed tidak memuat satu pun Karyawan.'
      using errcode = '22023';
  end if;

  -- Induk Unit Organisasi harus sudah muncul lebih dulu di array-nya.
  if exists (
    select 1
      from jsonb_array_elements(p_payload -> 'org_units') with ordinality as u(elem, ord)
     where u.elem ->> 'parent' is not null
       and (u.elem ->> 'parent')::integer >= (u.ord - 1)
  ) then
    raise exception 'Payload Seed rusak: ada Unit Organisasi yang menunjuk induk yang belum didefinisikan sebelumnya.'
      using errcode = '22023';
  end if;

  -- Setiap rujukan Karyawan harus jatuh di dalam daftarnya.
  if exists (
    select 1
      from jsonb_array_elements(p_payload -> 'employees') as e(elem)
     where coalesce((e.elem ->> 'org')::integer, -1) >= v_n_org
        or coalesce((e.elem ->> 'jab')::integer, -1) >= v_n_jab
        or exists (
             select 1
               from jsonb_each_text(coalesce(e.elem -> 'lk', '{}'::jsonb)) as k(tipe, idx)
              where k.idx::integer >= v_n_lk
           )
  ) then
    raise exception 'Payload Seed rusak: ada Karyawan yang menunjuk Unit Organisasi, Jabatan, atau Lookup di luar daftarnya.'
      using errcode = '22023';
  end if;

  -- 2. Sekali jalan. Kunci dulu supaya dua admin tidak lolos bersamaan.
  perform pg_advisory_xact_lock(hashtext('public.seed_from_payload'));
  select count(*) into v_existing from public.employees;
  if v_existing > 0 and not p_force then
    raise exception 'Tabel Karyawan sudah berisi % baris. Seed hanya dijalankan sekali (PRD §3). Kalau Seed sebelumnya salah, kembalikan Batch-nya dari halaman Log Perubahan.',
      v_existing
      using errcode = '55000';
  end if;

  -- 3. Satu Batch untuk semuanya. Simpan Batch pemanggil (kalau ada) dan
  --    kembalikan di akhir, seperti fungsi merge/revert di atas.
  v_prev := nullif(current_setting('app.batch_id', true), '');
  v_batch_id := public.begin_batch(
    'seed',
    coalesce(nullif(btrim(p_keterangan), ''), 'Seed awal lewat web'),
    true
  );
  select coalesce(max(r.id), 0) into v_first_rev from public.revisions r;

  -- 4. Lookup. Dipetakan balik lewat (tipe, kode), yang UNIQUE.
  insert into public.lookups (tipe, kode, label, urutan)
  select x.tipe, x.kode, x.label, x.urutan
    from jsonb_to_recordset(p_payload -> 'lookups')
         as x(tipe text, kode text, label text, urutan integer);
  get diagnostics v_lookups = row_count;
  if v_lookups <> v_n_lk then
    raise exception 'Gagal menulis Lookup (% dari % baris).', v_lookups, v_n_lk
      using errcode = '42501';
  end if;
  if v_n_lk > 0 then
    select array_agg(l.id order by e.ord) into v_lookup_ids
      from jsonb_array_elements(p_payload -> 'lookups') with ordinality as e(elem, ord)
      join public.lookups l
        on l.tipe = e.elem ->> 'tipe'
       and l.kode = e.elem ->> 'kode';
  end if;

  -- 5. Jabatan. Dipetakan balik lewat kode, yang UNIQUE.
  insert into public.jabatan (kode, nama)
  select x.kode, x.nama
    from jsonb_to_recordset(p_payload -> 'jabatan') as x(kode text, nama text);
  get diagnostics v_jabatan = row_count;
  if v_jabatan <> v_n_jab then
    raise exception 'Gagal menulis Jabatan (% dari % baris).', v_jabatan, v_n_jab
      using errcode = '42501';
  end if;
  if v_n_jab > 0 then
    select array_agg(j.id order by e.ord) into v_jab_ids
      from jsonb_array_elements(p_payload -> 'jabatan') with ordinality as e(elem, ord)
      join public.jabatan j on j.kode = e.elem ->> 'kode';
  end if;

  -- 6. Unit Organisasi, satu per satu, karena parent_id anak butuh id induk
  --    yang baru saja dibuat. Induk selalu lebih dulu (diperiksa di langkah 1).
  for v_i in 0 .. v_n_org - 1 loop
    v_unit := p_payload -> 'org_units' -> v_i;
    v_parent := (v_unit ->> 'parent')::integer;
    v_parent_id := case when v_parent is null then null else v_org_ids[v_parent + 1] end;
    insert into public.org_units (kode, nama, tipe, parent_id)
    values (v_unit ->> 'kode', v_unit ->> 'nama', v_unit ->> 'tipe', v_parent_id)
    returning id into v_new_id;
    v_org_ids := array_append(v_org_ids, v_new_id);
  end loop;
  v_org_units := coalesce(array_length(v_org_ids, 1), 0);

  -- 7. Karyawan, set-based. Kolom persis EMPLOYEE_COLUMNS di skrip CLI.
  insert into public.employees (
    personnel_number, nip, full_name, status,
    org_unit_id, jabatan_id,
    gender_id, work_contract_id, person_grade_id, job_grade_id, legal_entity_id,
    klasifikasi_rekrutmen_id, teknik_non_teknik_id, bod_range_id, band_jabatan_id,
    kategori_penempatan_id, kategori_fungsi_id,
    keterangan_pj_plt, keterangan_rangkap_1, keterangan_rangkap_2, keterangan, jurusan,
    nomor_surat_pg, nomor_surat_jg,
    original_start_date, tanggal_diangkat, tanggal_promosi_pg, tanggal_promosi_jg, tanggal_keluar
  )
  select
    e.elem ->> 'personnel_number',
    e.elem ->> 'nip',
    e.elem ->> 'full_name',
    coalesce(e.elem ->> 'status', 'aktif'),
    case when e.elem ->> 'org' is null then null else v_org_ids[(e.elem ->> 'org')::integer + 1] end,
    case when e.elem ->> 'jab' is null then null else v_jab_ids[(e.elem ->> 'jab')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'gender'                is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'gender')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'work_contract'         is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'work_contract')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'person_grade'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'person_grade')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'job_grade'             is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'job_grade')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'legal_entity'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'legal_entity')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'klasifikasi_rekrutmen' is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'klasifikasi_rekrutmen')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'teknik_non_teknik'     is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'teknik_non_teknik')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'bod_range'             is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'bod_range')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'band_jabatan'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'band_jabatan')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'kategori_penempatan'   is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'kategori_penempatan')::integer + 1] end,
    case when e.elem -> 'lk' ->> 'kategori_fungsi'       is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'kategori_fungsi')::integer + 1] end,
    e.elem -> 'text' ->> 'keterangan_pj_plt',
    e.elem -> 'text' ->> 'keterangan_rangkap_1',
    e.elem -> 'text' ->> 'keterangan_rangkap_2',
    e.elem -> 'text' ->> 'keterangan',
    e.elem -> 'text' ->> 'jurusan',
    e.elem -> 'text' ->> 'nomor_surat_pg',
    e.elem -> 'text' ->> 'nomor_surat_jg',
    (e.elem -> 'dates' ->> 'original_start_date')::date,
    (e.elem -> 'dates' ->> 'tanggal_diangkat')::date,
    (e.elem -> 'dates' ->> 'tanggal_promosi_pg')::date,
    (e.elem -> 'dates' ->> 'tanggal_promosi_jg')::date,
    (e.elem -> 'dates' ->> 'tanggal_keluar')::date
  from jsonb_array_elements(p_payload -> 'employees') with ordinality as e(elem, ord)
  order by e.ord;
  get diagnostics v_employees = row_count;
  if v_employees <> v_n_emp then
    raise exception 'Gagal menulis Karyawan (% dari % baris).', v_employees, v_n_emp
      using errcode = '42501';
  end if;

  -- 8. Data Pribadi Sensitif: UPDATE ke baris yang dibuat trigger, hanya untuk
  --    Karyawan yang punya isinya (PRD #22).
  update public.employee_private ep
     set date_of_birth  = (x.priv ->> 'date_of_birth')::date,
         place_of_birth = x.priv ->> 'place_of_birth',
         religion       = x.priv ->> 'religion',
         marital_status = x.priv ->> 'marital_status'
    from (
      select e.elem ->> 'personnel_number' as personnel_number,
             e.elem -> 'private'           as priv
        from jsonb_array_elements(p_payload -> 'employees') as e(elem)
       where jsonb_typeof(e.elem -> 'private') = 'object'
    ) x
    join public.employees emp on emp.personnel_number = x.personnel_number
   where ep.employee_id = emp.id;
  get diagnostics v_private = row_count;
  select count(*) into v_n
    from jsonb_array_elements(p_payload -> 'employees') as e(elem)
   where jsonb_typeof(e.elem -> 'private') = 'object';
  if v_private <> v_n then
    raise exception 'Gagal mengisi Data Pribadi Sensitif (% dari % baris).', v_private, v_n
      using errcode = '42501';
  end if;

  -- 9. Bukti sebelum pulang: semua Revisi yang lahir sejak Batch dibuka ada di
  --    satu Batch, yaitu Batch ini.
  select count(*), count(distinct r.batch_id)
    into v_revisions, v_n
    from public.revisions r
   where r.id > v_first_rev;
  if v_n <> 1 or not exists (
    select 1 from public.revisions r where r.id > v_first_rev and r.batch_id = v_batch_id
  ) then
    raise exception 'Seed menyentuh % Batch, seharusnya tepat satu. Tidak ada yang disimpan.', v_n
      using errcode = '55000';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',     v_batch_id,
    'lookups',      v_lookups,
    'jabatan',      v_jabatan,
    'org_units',    v_org_units,
    'employees',    v_employees,
    'data_pribadi', v_private,
    'revisions',    v_revisions
  );
end;
$fn$;

comment on function public.seed_from_payload(jsonb, text, boolean) is
  'Seed awal dari halaman web: satu payload (lib/seed/payload.ts) menjadi satu Batch jenis "seed" berisi Lookup, Jabatan, Unit Organisasi, Karyawan, dan Data Pribadi Sensitif. Menolak kalau tabel Karyawan sudah berisi, kecuali p_force (PRD #23, ADR-008).';


-- ----------------------------------------------------------------------------
-- 4b. Impor Karyawan berulang dari Excel (PRD #24)
-- ----------------------------------------------------------------------------

/*
  import_from_payload — payload yang SAMA dengan Seed, tapi boleh dijalankan
  berkali-kali di atas data yang sudah ada.

  BEDANYA DENGAN seed_from_payload
  ---------------------------------------------------------------------------
  Seed menolak jalan kalau tabel Karyawan sudah berisi, dan meng-INSERT semua
  yang ada di payload. Impor tidak menolak apa pun: ia memakai
  `personnel_number` sebagai kunci — itu memang business key Karyawan
  (CLAUDE.md) — lalu menambah yang belum ada dan memperbarui yang sudah ada.
  Pada database kosong keduanya menghasilkan hal yang persis sama.

  TIGA JANJI YANG MEMBUAT FUNGSI INI AMAN DIJALANKAN BERULANG
  ---------------------------------------------------------------------------

  1. **Sel kosong di Excel tidak pernah mengosongkan data yang sudah ada.**
     Setiap kolom ditulis sebagai `coalesce(excluded.kolom, employees.kolom)`.
     File yang cuma berisi kolom Jabatan tidak akan menghapus tanggal lahir
     seluruh perusahaan. Untuk MENGOSONGKAN sebuah kolom, pakai form Ubah
     Karyawan — di sana kosong memang berarti kosong, dan itu satu orang yang
     sengaja, bukan 1.475 orang karena satu kolom lupa diisi.

  2. **Baris yang tidak berubah tidak disentuh sama sekali.** Klausa `where`
     pada `do update` membandingkan nilai lama dengan nilai baru; kalau sama,
     baris itu tidak di-UPDATE. Bukan cuma soal Revisi — `log_revision()`
     memang sudah melewatkan UPDATE yang tidak mengubah apa pun — tapi soal
     `updated_at`, yang kalau ikut bergerak akan membuat 1.475 orang tampak
     "terakhir diubah hari ini" padahal tidak ada yang berubah.

  3. **Satu impor = satu transaksi = satu Batch jenis `impor`** (ADR-006),
     yang bisa dikembalikan utuh dari Log Perubahan seperti Batch mana pun.
     Gagal di tengah berarti tidak ada yang tertulis.

  DATA REFERENSI DICOCOKKAN LEWAT KODE, DAN TIDAK PERNAH DIUBAH
  ---------------------------------------------------------------------------
  Unit Organisasi, Jabatan, dan Lookup yang kode-nya sudah ada dipakai ulang
  apa adanya: label, nama, tipe, dan induknya TIDAK ditimpa isi Excel. Impor
  hanya boleh menambah Data Referensi yang benar-benar baru. Kalau Excel
  menulis "Divisi QHSSE" untuk kode yang di database bernama "Divisi QHSSE "
  (dengan spasi), yang menang database — dan selisihnya diberesi lewat halaman
  Perlu Dibereskan + Merge, bukan diam-diam oleh sebuah impor (ADR-002).
*/
create or replace function public.import_from_payload(
  p_payload     jsonb,
  p_keterangan  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_prev            text;
  v_batch_id        uuid;
  v_first_rev       bigint;
  v_n               bigint;
  v_n_org           integer;
  v_n_jab           integer;
  v_n_lk            integer;
  v_n_emp           integer;
  v_lookups_baru    integer := 0;
  v_jabatan_baru    integer := 0;
  v_org_baru        integer := 0;
  v_emp_cocok       integer := 0;
  v_emp_tersentuh   integer := 0;
  v_emp_baru        integer := 0;
  v_emp_ubah        integer := 0;
  v_private         integer := 0;
  v_revisions       bigint  := 0;
  v_lookup_ids      uuid[]  := '{}';
  v_jab_ids         uuid[]  := '{}';
  v_org_ids         uuid[]  := '{}';
  v_unit            jsonb;
  v_i               integer;
  v_parent          integer;
  v_parent_id       uuid;
  v_new_id          uuid;
begin
  perform public.assert_admin('menjalankan Impor');

  -- 1. Bentuk payload — sebelum apa pun ditulis atau dibuka.
  if p_payload is null
     or jsonb_typeof(p_payload -> 'org_units') is distinct from 'array'
     or jsonb_typeof(p_payload -> 'jabatan')   is distinct from 'array'
     or jsonb_typeof(p_payload -> 'lookups')   is distinct from 'array'
     or jsonb_typeof(p_payload -> 'employees') is distinct from 'array' then
    raise exception 'Payload Impor tidak berbentuk: butuh empat daftar org_units, jabatan, lookups, dan employees.'
      using errcode = '22023';
  end if;

  v_n_org := jsonb_array_length(p_payload -> 'org_units');
  v_n_jab := jsonb_array_length(p_payload -> 'jabatan');
  v_n_lk  := jsonb_array_length(p_payload -> 'lookups');
  v_n_emp := jsonb_array_length(p_payload -> 'employees');

  if v_n_emp = 0 then
    raise exception 'File ini tidak memuat satu pun Karyawan.'
      using errcode = '22023';
  end if;

  -- Induk Unit Organisasi harus sudah muncul lebih dulu di array-nya.
  if exists (
    select 1
      from jsonb_array_elements(p_payload -> 'org_units') with ordinality as u(elem, ord)
     where u.elem ->> 'parent' is not null
       and (u.elem ->> 'parent')::integer >= u.ord - 1
  ) then
    raise exception 'Urutan Unit Organisasi salah: induk harus muncul sebelum anaknya.'
      using errcode = '22023';
  end if;

  -- Satu Personnel Number tidak boleh muncul dua kali DI DALAM satu file:
  -- `on conflict` di bawah tidak bisa menangani dua baris yang bertabrakan
  -- sesama mereka ("cannot affect row a second time"), dan pesan itu tidak
  -- memberi tahu siapa pun nomor mana yang kembar.
  select count(*) into v_n
    from (
      select e.elem ->> 'personnel_number' as pn
        from jsonb_array_elements(p_payload -> 'employees') as e(elem)
       group by 1
      having count(*) > 1
    ) d;
  if v_n > 0 then
    raise exception 'Ada % Personnel Number yang muncul lebih dari sekali di file ini. Setiap orang harus satu baris.', v_n
      using errcode = '22023';
  end if;

  -- Email kantor yang kembar DI DALAM file, dicek di sini dan bukan dibiarkan
  -- jatuh ke index unik: `employees_email_kantor_lower_key` akan menolaknya
  -- dengan pesan yang menyebut nama index, bukan alamat mana yang kembar.
  -- Perbandingannya huruf kecil, sama dengan index-nya.
  select count(*) into v_n
    from (
      select lower(btrim(e.elem -> 'text' ->> 'email_kantor')) as em
        from jsonb_array_elements(p_payload -> 'employees') as e(elem)
       where nullif(btrim(e.elem -> 'text' ->> 'email_kantor'), '') is not null
       group by 1
      having count(*) > 1
    ) d;
  if v_n > 0 then
    raise exception 'Ada % alamat Email Kantor yang dipakai lebih dari satu orang di file ini. Satu alamat hanya boleh milik satu Karyawan.', v_n
      using errcode = '22023';
  end if;

  -- Karyawan BARU wajib punya Nama. Yang SUDAH ADA tidak: file yang cuma
  -- berisi Personnel Number dan Email Kantor adalah pemakaian yang paling
  -- wajar dari "sel kosong tidak menghapus apa pun" (PRD #24), dan namanya
  -- sudah ada di database. Dicek di sini supaya pesannya menyebut sebabnya,
  -- bukan jatuh ke NOT NULL constraint yang cuma menyebut nama kolom.
  select count(*) into v_n
    from jsonb_array_elements(p_payload -> 'employees') as e(elem)
   where nullif(btrim(e.elem ->> 'full_name'), '') is null
     and not exists (
       select 1 from public.employees emp
        where emp.personnel_number = e.elem ->> 'personnel_number'
     );
  if v_n > 0 then
    raise exception 'Ada % baris tanpa Nama yang Personnel Number-nya belum ada di database. Karyawan baru wajib punya Nama; kolom Nama hanya boleh dikosongkan untuk memperbarui orang yang sudah ada.', v_n
      using errcode = '22023';
  end if;

  -- 2. Satu impor pada satu waktu. Dua admin yang meng-upload bersamaan akan
  --    saling menunggu, bukan saling menimpa.
  perform pg_advisory_xact_lock(hashtext('public.import_from_payload'));

  -- 3. Berapa yang sudah ada SEBELUM apa pun ditulis — dasar hitungan
  --    "baru" versus "diperbarui" di akhir.
  select count(*) into v_emp_cocok
    from public.employees emp
   where emp.personnel_number in (
     select e.elem ->> 'personnel_number'
       from jsonb_array_elements(p_payload -> 'employees') as e(elem)
   );
  v_emp_baru := v_n_emp - v_emp_cocok;

  -- 4. Satu Batch untuk semuanya.
  v_prev := nullif(current_setting('app.batch_id', true), '');
  v_batch_id := public.begin_batch(
    'impor',
    coalesce(nullif(btrim(p_keterangan), ''), 'Impor Karyawan dari Excel'),
    true
  );
  select coalesce(max(r.id), 0) into v_first_rev from public.revisions r;

  -- 5. Lookup: tambah yang kodenya belum ada, lalu petakan SEMUANYA (baru
  --    maupun lama) balik ke indeks payload.
  insert into public.lookups (tipe, kode, label, urutan)
  select x.tipe, x.kode, x.label, x.urutan
    from jsonb_to_recordset(p_payload -> 'lookups')
         as x(tipe text, kode text, label text, urutan integer)
   where not exists (
     select 1 from public.lookups l where l.tipe = x.tipe and l.kode = x.kode
   );
  get diagnostics v_lookups_baru = row_count;
  if v_n_lk > 0 then
    select array_agg(l.id order by e.ord) into v_lookup_ids
      from jsonb_array_elements(p_payload -> 'lookups') with ordinality as e(elem, ord)
      join public.lookups l
        on l.tipe = e.elem ->> 'tipe'
       and l.kode = e.elem ->> 'kode';
    if coalesce(array_length(v_lookup_ids, 1), 0) <> v_n_lk then
      raise exception 'Gagal memetakan Lookup (% dari % baris).',
        coalesce(array_length(v_lookup_ids, 1), 0), v_n_lk
        using errcode = '42501';
    end if;
  end if;

  -- 6. Jabatan, pola yang sama.
  insert into public.jabatan (kode, nama)
  select x.kode, x.nama
    from jsonb_to_recordset(p_payload -> 'jabatan') as x(kode text, nama text)
   where not exists (select 1 from public.jabatan j where j.kode = x.kode);
  get diagnostics v_jabatan_baru = row_count;
  if v_n_jab > 0 then
    select array_agg(j.id order by e.ord) into v_jab_ids
      from jsonb_array_elements(p_payload -> 'jabatan') with ordinality as e(elem, ord)
      join public.jabatan j on j.kode = e.elem ->> 'kode';
    if coalesce(array_length(v_jab_ids, 1), 0) <> v_n_jab then
      raise exception 'Gagal memetakan Jabatan (% dari % baris).',
        coalesce(array_length(v_jab_ids, 1), 0), v_n_jab
        using errcode = '42501';
    end if;
  end if;

  -- 7. Unit Organisasi, satu per satu: parent_id anak butuh id induknya, dan
  --    induk yang sudah ada di database dipakai ulang apa adanya.
  for v_i in 0 .. v_n_org - 1 loop
    v_unit := p_payload -> 'org_units' -> v_i;
    v_new_id := null;
    select o.id into v_new_id from public.org_units o where o.kode = v_unit ->> 'kode';
    if v_new_id is null then
      v_parent := (v_unit ->> 'parent')::integer;
      v_parent_id := case when v_parent is null then null else v_org_ids[v_parent + 1] end;
      insert into public.org_units (kode, nama, tipe, parent_id)
      values (v_unit ->> 'kode', v_unit ->> 'nama', v_unit ->> 'tipe', v_parent_id)
      returning id into v_new_id;
      v_org_baru := v_org_baru + 1;
    end if;
    v_org_ids := array_append(v_org_ids, v_new_id);
  end loop;

  -- 8. Karyawan — satu statement untuk tambah DAN perbarui.
  --
  -- `on conflict (personnel_number) do update` memakai business key Karyawan
  -- sebagai kunci. `coalesce(excluded.x, employees.x)` adalah janji nomor 1 di
  -- kepala berkas ini: kolom yang kosong di Excel mempertahankan isi lama.
  -- Klausa `where` di bawahnya adalah janji nomor 2: kalau seluruh nilai baru
  -- sama dengan yang sudah ada, barisnya tidak di-UPDATE sama sekali.
  with masuk as (
    select
      e.elem ->> 'personnel_number' as personnel_number,
      e.elem ->> 'nip'              as nip,
      -- Nama kosong TIDAK boleh sampai ke tuple INSERT: `employees.full_name`
      -- NOT NULL, dan Postgres memeriksa constraint itu saat tuple dibentuk —
      -- sebelum `on conflict` sempat mengalihkan barisnya ke DO UPDATE. Jadi
      -- baris yang memperbarui orang yang sudah ada mengambil nama lamanya di
      -- sini, dan `coalesce` di DO UPDATE membuatnya tetap tidak berubah.
      coalesce(nullif(btrim(e.elem ->> 'full_name'), ''), lama.full_name) as full_name,
      -- Email disimpan huruf kecil. Index uniknya `lower(email_kantor)`, jadi
      -- "Budi.S@…" dan "budi.s@…" sudah dianggap satu; menyimpan apa adanya
      -- cuma membuat dua baris terlihat berbeda padahal database menolaknya
      -- sebagai kembar. Form Ubah Karyawan menormalkan dengan cara yang sama.
      lower(nullif(btrim(e.elem -> 'text' ->> 'email_kantor'), '')) as email_kantor,
      coalesce(e.elem ->> 'status', 'aktif') as status,
      case when e.elem ->> 'org' is null then null else v_org_ids[(e.elem ->> 'org')::integer + 1] end as org_unit_id,
      case when e.elem ->> 'jab' is null then null else v_jab_ids[(e.elem ->> 'jab')::integer + 1] end as jabatan_id,
      case when e.elem -> 'lk' ->> 'gender'                is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'gender')::integer + 1] end                as gender_id,
      case when e.elem -> 'lk' ->> 'work_contract'         is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'work_contract')::integer + 1] end         as work_contract_id,
      case when e.elem -> 'lk' ->> 'person_grade'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'person_grade')::integer + 1] end          as person_grade_id,
      case when e.elem -> 'lk' ->> 'job_grade'             is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'job_grade')::integer + 1] end             as job_grade_id,
      case when e.elem -> 'lk' ->> 'legal_entity'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'legal_entity')::integer + 1] end          as legal_entity_id,
      case when e.elem -> 'lk' ->> 'klasifikasi_rekrutmen' is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'klasifikasi_rekrutmen')::integer + 1] end as klasifikasi_rekrutmen_id,
      case when e.elem -> 'lk' ->> 'teknik_non_teknik'     is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'teknik_non_teknik')::integer + 1] end     as teknik_non_teknik_id,
      case when e.elem -> 'lk' ->> 'bod_range'             is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'bod_range')::integer + 1] end             as bod_range_id,
      case when e.elem -> 'lk' ->> 'band_jabatan'          is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'band_jabatan')::integer + 1] end          as band_jabatan_id,
      case when e.elem -> 'lk' ->> 'kategori_penempatan'   is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'kategori_penempatan')::integer + 1] end   as kategori_penempatan_id,
      case when e.elem -> 'lk' ->> 'kategori_fungsi'       is null then null else v_lookup_ids[(e.elem -> 'lk' ->> 'kategori_fungsi')::integer + 1] end       as kategori_fungsi_id,
      e.elem -> 'text' ->> 'keterangan_pj_plt'     as keterangan_pj_plt,
      e.elem -> 'text' ->> 'keterangan_rangkap_1'  as keterangan_rangkap_1,
      e.elem -> 'text' ->> 'keterangan_rangkap_2'  as keterangan_rangkap_2,
      e.elem -> 'text' ->> 'keterangan'            as keterangan,
      e.elem -> 'text' ->> 'jurusan'               as jurusan,
      e.elem -> 'text' ->> 'nomor_surat_pg'        as nomor_surat_pg,
      e.elem -> 'text' ->> 'nomor_surat_jg'        as nomor_surat_jg,
      (e.elem -> 'dates' ->> 'original_start_date')::date as original_start_date,
      (e.elem -> 'dates' ->> 'tanggal_diangkat')::date    as tanggal_diangkat,
      (e.elem -> 'dates' ->> 'tanggal_promosi_pg')::date  as tanggal_promosi_pg,
      (e.elem -> 'dates' ->> 'tanggal_promosi_jg')::date  as tanggal_promosi_jg,
      (e.elem -> 'dates' ->> 'tanggal_keluar')::date      as tanggal_keluar,
      e.ord as ord
    from jsonb_array_elements(p_payload -> 'employees') with ordinality as e(elem, ord)
    left join public.employees lama
      on lama.personnel_number = e.elem ->> 'personnel_number'
  )
  insert into public.employees (
    personnel_number, nip, full_name, email_kantor, status,
    org_unit_id, jabatan_id,
    gender_id, work_contract_id, person_grade_id, job_grade_id, legal_entity_id,
    klasifikasi_rekrutmen_id, teknik_non_teknik_id, bod_range_id, band_jabatan_id,
    kategori_penempatan_id, kategori_fungsi_id,
    keterangan_pj_plt, keterangan_rangkap_1, keterangan_rangkap_2, keterangan, jurusan,
    nomor_surat_pg, nomor_surat_jg,
    original_start_date, tanggal_diangkat, tanggal_promosi_pg, tanggal_promosi_jg, tanggal_keluar
  )
  select
    m.personnel_number, m.nip, m.full_name, m.email_kantor, m.status,
    m.org_unit_id, m.jabatan_id,
    m.gender_id, m.work_contract_id, m.person_grade_id, m.job_grade_id, m.legal_entity_id,
    m.klasifikasi_rekrutmen_id, m.teknik_non_teknik_id, m.bod_range_id, m.band_jabatan_id,
    m.kategori_penempatan_id, m.kategori_fungsi_id,
    m.keterangan_pj_plt, m.keterangan_rangkap_1, m.keterangan_rangkap_2, m.keterangan, m.jurusan,
    m.nomor_surat_pg, m.nomor_surat_jg,
    m.original_start_date, m.tanggal_diangkat, m.tanggal_promosi_pg, m.tanggal_promosi_jg, m.tanggal_keluar
  from masuk m
  order by m.ord
  on conflict (personnel_number) do update
     set nip                      = coalesce(excluded.nip,                      public.employees.nip),
         full_name                = coalesce(excluded.full_name,                public.employees.full_name),
         email_kantor             = coalesce(excluded.email_kantor,             public.employees.email_kantor),
         status                   = coalesce(excluded.status,                   public.employees.status),
         org_unit_id              = coalesce(excluded.org_unit_id,              public.employees.org_unit_id),
         jabatan_id               = coalesce(excluded.jabatan_id,               public.employees.jabatan_id),
         gender_id                = coalesce(excluded.gender_id,                public.employees.gender_id),
         work_contract_id         = coalesce(excluded.work_contract_id,         public.employees.work_contract_id),
         person_grade_id          = coalesce(excluded.person_grade_id,          public.employees.person_grade_id),
         job_grade_id             = coalesce(excluded.job_grade_id,             public.employees.job_grade_id),
         legal_entity_id          = coalesce(excluded.legal_entity_id,          public.employees.legal_entity_id),
         klasifikasi_rekrutmen_id = coalesce(excluded.klasifikasi_rekrutmen_id, public.employees.klasifikasi_rekrutmen_id),
         teknik_non_teknik_id     = coalesce(excluded.teknik_non_teknik_id,     public.employees.teknik_non_teknik_id),
         bod_range_id             = coalesce(excluded.bod_range_id,             public.employees.bod_range_id),
         band_jabatan_id          = coalesce(excluded.band_jabatan_id,          public.employees.band_jabatan_id),
         kategori_penempatan_id   = coalesce(excluded.kategori_penempatan_id,   public.employees.kategori_penempatan_id),
         kategori_fungsi_id       = coalesce(excluded.kategori_fungsi_id,       public.employees.kategori_fungsi_id),
         keterangan_pj_plt        = coalesce(excluded.keterangan_pj_plt,        public.employees.keterangan_pj_plt),
         keterangan_rangkap_1     = coalesce(excluded.keterangan_rangkap_1,     public.employees.keterangan_rangkap_1),
         keterangan_rangkap_2     = coalesce(excluded.keterangan_rangkap_2,     public.employees.keterangan_rangkap_2),
         keterangan               = coalesce(excluded.keterangan,               public.employees.keterangan),
         jurusan                  = coalesce(excluded.jurusan,                  public.employees.jurusan),
         nomor_surat_pg           = coalesce(excluded.nomor_surat_pg,           public.employees.nomor_surat_pg),
         nomor_surat_jg           = coalesce(excluded.nomor_surat_jg,           public.employees.nomor_surat_jg),
         original_start_date      = coalesce(excluded.original_start_date,      public.employees.original_start_date),
         tanggal_diangkat         = coalesce(excluded.tanggal_diangkat,         public.employees.tanggal_diangkat),
         tanggal_promosi_pg       = coalesce(excluded.tanggal_promosi_pg,       public.employees.tanggal_promosi_pg),
         tanggal_promosi_jg       = coalesce(excluded.tanggal_promosi_jg,       public.employees.tanggal_promosi_jg),
         tanggal_keluar           = coalesce(excluded.tanggal_keluar,           public.employees.tanggal_keluar)
   where (
           public.employees.nip, public.employees.full_name,
           public.employees.email_kantor, public.employees.status,
           public.employees.org_unit_id, public.employees.jabatan_id,
           public.employees.gender_id, public.employees.work_contract_id,
           public.employees.person_grade_id, public.employees.job_grade_id,
           public.employees.legal_entity_id, public.employees.klasifikasi_rekrutmen_id,
           public.employees.teknik_non_teknik_id, public.employees.bod_range_id,
           public.employees.band_jabatan_id, public.employees.kategori_penempatan_id,
           public.employees.kategori_fungsi_id,
           public.employees.keterangan_pj_plt, public.employees.keterangan_rangkap_1,
           public.employees.keterangan_rangkap_2, public.employees.keterangan,
           public.employees.jurusan, public.employees.nomor_surat_pg,
           public.employees.nomor_surat_jg,
           public.employees.original_start_date, public.employees.tanggal_diangkat,
           public.employees.tanggal_promosi_pg, public.employees.tanggal_promosi_jg,
           public.employees.tanggal_keluar
         )
         is distinct from (
           coalesce(excluded.nip,                      public.employees.nip),
           coalesce(excluded.full_name,                public.employees.full_name),
           coalesce(excluded.email_kantor,             public.employees.email_kantor),
           coalesce(excluded.status,                   public.employees.status),
           coalesce(excluded.org_unit_id,              public.employees.org_unit_id),
           coalesce(excluded.jabatan_id,               public.employees.jabatan_id),
           coalesce(excluded.gender_id,                public.employees.gender_id),
           coalesce(excluded.work_contract_id,         public.employees.work_contract_id),
           coalesce(excluded.person_grade_id,          public.employees.person_grade_id),
           coalesce(excluded.job_grade_id,             public.employees.job_grade_id),
           coalesce(excluded.legal_entity_id,          public.employees.legal_entity_id),
           coalesce(excluded.klasifikasi_rekrutmen_id, public.employees.klasifikasi_rekrutmen_id),
           coalesce(excluded.teknik_non_teknik_id,     public.employees.teknik_non_teknik_id),
           coalesce(excluded.bod_range_id,             public.employees.bod_range_id),
           coalesce(excluded.band_jabatan_id,          public.employees.band_jabatan_id),
           coalesce(excluded.kategori_penempatan_id,   public.employees.kategori_penempatan_id),
           coalesce(excluded.kategori_fungsi_id,       public.employees.kategori_fungsi_id),
           coalesce(excluded.keterangan_pj_plt,        public.employees.keterangan_pj_plt),
           coalesce(excluded.keterangan_rangkap_1,     public.employees.keterangan_rangkap_1),
           coalesce(excluded.keterangan_rangkap_2,     public.employees.keterangan_rangkap_2),
           coalesce(excluded.keterangan,               public.employees.keterangan),
           coalesce(excluded.jurusan,                  public.employees.jurusan),
           coalesce(excluded.nomor_surat_pg,           public.employees.nomor_surat_pg),
           coalesce(excluded.nomor_surat_jg,           public.employees.nomor_surat_jg),
           coalesce(excluded.original_start_date,      public.employees.original_start_date),
           coalesce(excluded.tanggal_diangkat,         public.employees.tanggal_diangkat),
           coalesce(excluded.tanggal_promosi_pg,       public.employees.tanggal_promosi_pg),
           coalesce(excluded.tanggal_promosi_jg,       public.employees.tanggal_promosi_jg),
           coalesce(excluded.tanggal_keluar,           public.employees.tanggal_keluar)
         );
  get diagnostics v_emp_tersentuh = row_count;
  v_emp_ubah := v_emp_tersentuh - v_emp_baru;
  if v_emp_ubah < 0 then
    raise exception 'Hitungan Impor tidak masuk akal (% tersentuh, % baru). Tidak ada yang disimpan.',
      v_emp_tersentuh, v_emp_baru
      using errcode = '55000';
  end if;

  -- 9. Data Pribadi Sensitif (PRD #22). Barisnya sudah ada untuk semua
  --    Karyawan — dibuat trigger saat INSERT — jadi satu UPDATE melayani yang
  --    baru maupun yang lama. `coalesce` dan `is distinct from` di sini
  --    memegang janji yang sama dengan langkah 8.
  update public.employee_private ep
     set date_of_birth  = coalesce((x.priv ->> 'date_of_birth')::date, ep.date_of_birth),
         place_of_birth = coalesce(x.priv ->> 'place_of_birth',        ep.place_of_birth),
         religion       = coalesce(x.priv ->> 'religion',              ep.religion),
         marital_status = coalesce(x.priv ->> 'marital_status',        ep.marital_status)
    from (
      select e.elem ->> 'personnel_number' as personnel_number,
             e.elem -> 'private'           as priv
        from jsonb_array_elements(p_payload -> 'employees') as e(elem)
       where jsonb_typeof(e.elem -> 'private') = 'object'
    ) x
    join public.employees emp on emp.personnel_number = x.personnel_number
   where ep.employee_id = emp.id
     and (ep.date_of_birth, ep.place_of_birth, ep.religion, ep.marital_status)
         is distinct from (
           coalesce((x.priv ->> 'date_of_birth')::date, ep.date_of_birth),
           coalesce(x.priv ->> 'place_of_birth',        ep.place_of_birth),
           coalesce(x.priv ->> 'religion',              ep.religion),
           coalesce(x.priv ->> 'marital_status',        ep.marital_status)
         );
  get diagnostics v_private = row_count;

  -- 10. Bukti sebelum pulang: semua Revisi yang lahir sejak Batch dibuka ada
  --     di satu Batch, yaitu Batch ini. Impor yang tidak mengubah apa pun sah
  --     dan menghasilkan nol Revisi — Batch-nya sendiri dibersihkan di bawah.
  select count(*), count(distinct r.batch_id)
    into v_revisions, v_n
    from public.revisions r
   where r.id > v_first_rev;

  -- Impor yang tidak mengubah apa pun BATAL, bukan sukses-dengan-nol.
  -- Bukan kerewelan: `begin_batch` sudah menulis satu baris `batches`, dan
  -- Batch tanpa Revisi adalah baris kosong di Log Perubahan yang tidak bisa
  -- dihapus lagi (CLAUDE.md melarang DELETE pada `batches`, dan
  -- scripts/verify-schema.sql menegakkan "tidak ada Batch kosong"). Membatalkan
  -- transaksinya membuang Batch itu bersamaan, dan tidak ada yang hilang —
  -- memang tidak ada yang berubah.
  if v_revisions = 0 then
    raise exception 'File ini tidak mengubah apa pun: % Karyawan di dalamnya sudah ada dengan isi yang sama persis.', v_n_emp
      using errcode = '55000';
  end if;

  if v_n <> 1 or not exists (
    select 1 from public.revisions r where r.id > v_first_rev and r.batch_id = v_batch_id
  ) then
    raise exception 'Impor menyentuh % Batch, seharusnya tepat satu. Tidak ada yang disimpan.', v_n
      using errcode = '55000';
  end if;

  perform set_config('app.batch_id', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'batch_id',            v_batch_id,
    'karyawan_baru',       v_emp_baru,
    'karyawan_diperbarui', v_emp_ubah,
    'karyawan_tetap',      v_n_emp - v_emp_tersentuh,
    'lookups_baru',        v_lookups_baru,
    'jabatan_baru',        v_jabatan_baru,
    'org_units_baru',      v_org_baru,
    'data_pribadi',        v_private,
    'revisions',           v_revisions
  );
end;
$fn$;

comment on function public.import_from_payload(jsonb, text) is
  'Impor Karyawan berulang dari Excel (PRD #24): payload yang sama dengan Seed, dicocokkan lewat personnel_number. Menambah yang belum ada, memperbarui yang berubah, tidak menyentuh yang sama, dan tidak pernah mengosongkan kolom karena sel Excel kosong. Satu panggilan = satu Batch jenis "impor" yang bisa dikembalikan utuh.';

-- ----------------------------------------------------------------------------
-- 5. Grants
--
-- EXECUTE dicabut dari PUBLIC lebih dulu, karena `create function` memberikan
-- EXECUTE ke PUBLIC secara default. `anon` tidak pernah dapat: pengunjung yang
-- belum login tidak boleh menyentuh satu pun fungsi di file ini.
--
-- `authenticated` mencakup viewer; mereka boleh MEMANGGIL, dan assert_admin()
-- di dalam setiap entry point menolak mereka dengan 42501. Itu disengaja:
-- penolakan yang bisa dibaca lebih baik daripada UPDATE yang diam-diam
-- mengenai nol baris.
-- ----------------------------------------------------------------------------

revoke all on function public.assert_admin(text) from public;
revoke all on function public.merge_org_unit(uuid, uuid, text) from public;
revoke all on function public.merge_jabatan(uuid, uuid, text) from public;
revoke all on function public.merge_lookup(uuid, uuid, text) from public;
revoke all on function public.apply_revert_operation(jsonb) from public;
revoke all on function public.revert_skip_entry(bigint, text, uuid, text) from public;
revoke all on function public.revert_plan_for_batch(uuid) from public;
revoke all on function public.apply_revert(jsonb) from public;
revoke all on function public.revert_batch(uuid, text) from public;
revoke all on function public.seed_from_payload(jsonb, text, boolean) from public;
revoke all on function public.import_from_payload(jsonb, text) from public;

grant execute on function public.assert_admin(text) to authenticated, service_role;
grant execute on function public.merge_org_unit(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.merge_jabatan(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.merge_lookup(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.apply_revert_operation(jsonb) to authenticated, service_role;
grant execute on function public.revert_skip_entry(bigint, text, uuid, text) to authenticated, service_role;
grant execute on function public.revert_plan_for_batch(uuid) to authenticated, service_role;
grant execute on function public.apply_revert(jsonb) to authenticated, service_role;
grant execute on function public.revert_batch(uuid, text) to authenticated, service_role;
grant execute on function public.seed_from_payload(jsonb, text, boolean) to authenticated, service_role;
grant execute on function public.import_from_payload(jsonb, text) to authenticated, service_role;

reset client_min_messages;
