-- ============================================================================
-- scripts/verify-schema.sql — behavioural assertions for the HC Core schema.
--
-- Run against a database that already has db/local/00-shim.sql and
-- supabase/migrations/0001_init.sql applied:
--
--   bash scripts/db-local.sh
--
-- or standalone:
--
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v repo_root="$PWD" \
--        -d hc_core_test -f scripts/verify-schema.sql
--
-- Every assertion RAISEs EXCEPTION on failure, so ON_ERROR_STOP=1 turns a
-- broken invariant into a non-zero exit code with a readable message.
-- Passing assertions print "OK   ..." notices, so the output reads as a
-- checklist.
--
-- All fixture data is obviously dummy (prefix "UJI-"). Never put real
-- employee data in here (CLAUDE.md).
-- ============================================================================

\set ON_ERROR_STOP on
\timing off
\pset pager off

\if :{?repo_root}
\else
\set repo_root ''
\endif

select set_config('hc.repo_root', :'repo_root', false) \g /dev/null

\echo ''
\echo '================ HC Core — verifikasi skema ================'
\echo ''

-- ---------------------------------------------------------------------------
-- 1. Semua 9 tabel dan 3 view ada
-- ---------------------------------------------------------------------------
do $$
declare
  v_expected text[] := array[
    'employees','employee_private','org_units','jabatan','lookups',
    'batches','revisions','api_keys','profiles'
  ];
  v_missing text[];
begin
  select array_agg(t order by t) into v_missing
  from unnest(v_expected) t
  where not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
  );

  if v_missing is not null then
    raise exception 'GAGAL: tabel hilang: %', array_to_string(v_missing, ', ');
  end if;
  raise notice 'OK   9 tabel data ada';
end
$$;

do $$
declare
  v_expected text[] := array['v_employees','v_employees_private','v_employees_api'];
  v_missing text[];
begin
  select array_agg(t order by t) into v_missing
  from unnest(v_expected) t
  where not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t and c.relkind = 'v'
  );

  if v_missing is not null then
    raise exception 'GAGAL: view hilang: %', array_to_string(v_missing, ', ');
  end if;
  raise notice 'OK   3 view ada';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Ketiga view memakai security_invoker = true
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
  v_opts text[];
begin
  foreach v_name in array array['v_employees','v_employees_private','v_employees_api'] loop
    select c.reloptions into v_opts
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_name;

    if v_opts is null or not ('security_invoker=true' = any(v_opts)) then
      raise exception
        'GAGAL: view %.% tidak punya security_invoker=true (reloptions=%) — RLS tabel dasar tidak akan berlaku',
        'public', v_name, coalesce(array_to_string(v_opts, ','), '(kosong)');
    end if;
  end loop;
  raise notice 'OK   3 view memakai security_invoker = true';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger log_revision terpasang di KETUJUH tabel ter-log
--    (enam tabel data + profiles; profiles sengaja tanpa guard DELETE)
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array[
    'employees','employee_private','org_units','jabatan','lookups','api_keys',
    'profiles'
  ];
  v_missing text[];
begin
  select array_agg(t order by t) into v_missing
  from unnest(v_tables) t
  where not exists (
    select 1
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
    where n.nspname = 'public'
      and c.relname = t
      and p.proname = 'log_revision'
      and not tg.tgisinternal
  );

  if v_missing is not null then
    raise exception 'GAGAL: trigger log_revision tidak terpasang di: %', array_to_string(v_missing, ', ');
  end if;
  raise notice 'OK   trigger log_revision terpasang di 7 tabel ter-log';
end
$$;

-- profiles TIDAK boleh punya guard DELETE: barisnya ikut terhapus lewat
-- ON DELETE CASCADE dari auth.users, dan Supabase Auth yang memiliki siklus
-- hidup itu. Kalau seseorang "merapikan" kedua daftar jadi sama, ini gagal.
do $$
begin
  if exists (
    select 1
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and tg.tgname = 'no_delete' and not tg.tgisinternal
  ) then
    raise exception
      'GAGAL: profiles punya trigger no_delete — itu memblokir ON DELETE CASCADE dari auth.users';
  end if;
  raise notice 'OK   profiles ter-log tapi sengaja tanpa guard DELETE';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger revisi hidup: INSERT org_units -> tepat 1 revisi insert
-- ---------------------------------------------------------------------------
do $$
declare
  v_id   uuid;
  v_n    integer;
  v_rev  public.revisions%rowtype;
begin
  insert into public.org_units (kode, nama, tipe)
  values ('UJI-REV', 'Divisi Uji Revisi', 'divisi')
  returning id into v_id;

  select count(*) into v_n
  from public.revisions where table_name = 'org_units' and row_id = v_id;
  if v_n <> 1 then
    raise exception 'GAGAL: INSERT org_units menghasilkan % baris revisions (harus tepat 1)', v_n;
  end if;

  select * into v_rev
  from public.revisions where table_name = 'org_units' and row_id = v_id;

  if v_rev.action <> 'insert' then
    raise exception 'GAGAL: action revisi = "%" (harus "insert")', v_rev.action;
  end if;
  if v_rev.before is not null then
    raise exception 'GAGAL: before harus NULL untuk insert, dapat %', v_rev.before;
  end if;
  if v_rev.after ->> 'nama' <> 'Divisi Uji Revisi' then
    raise exception 'GAGAL: after->>nama = "%" (harus "Divisi Uji Revisi")', v_rev.after ->> 'nama';
  end if;

  raise notice 'OK   INSERT org_units -> 1 revisi action=insert, before IS NULL';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. UPDATE mencatat before/after yang benar
-- ---------------------------------------------------------------------------
do $$
declare
  v_id   uuid;
  v_n    integer;
  v_rev  public.revisions%rowtype;
begin
  select id into v_id from public.org_units where kode = 'UJI-REV';

  update public.org_units set nama = 'Divisi Uji Revisi (Baru)' where id = v_id;

  select count(*) into v_n
  from public.revisions where table_name = 'org_units' and row_id = v_id;
  if v_n <> 2 then
    raise exception 'GAGAL: setelah 1 insert + 1 update ada % revisi (harus 2)', v_n;
  end if;

  select * into v_rev
  from public.revisions
  where table_name = 'org_units' and row_id = v_id and action = 'update';

  if v_rev.before ->> 'nama' <> 'Divisi Uji Revisi' then
    raise exception 'GAGAL: before->>nama = "%" (harus "Divisi Uji Revisi")', v_rev.before ->> 'nama';
  end if;
  if v_rev.after ->> 'nama' <> 'Divisi Uji Revisi (Baru)' then
    raise exception 'GAGAL: after->>nama = "%" (harus "Divisi Uji Revisi (Baru)")', v_rev.after ->> 'nama';
  end if;

  raise notice 'OK   UPDATE org_units -> revisi ke-2 dengan before/after yang benar';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Auto-batch: menulis TANPA app.batch_id tetap membuat batch jenis 'edit'
--    (inti janji ADR-003 — tidak ada perubahan yang lolos tanpa log)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id     uuid;
  v_batch  public.batches%rowtype;
begin
  -- pastikan tidak ada batch yang sedang terbuka
  perform set_config('app.batch_id', '', true);
  if public.current_batch_id() is not null then
    raise exception 'GAGAL: app.batch_id masih terisi setelah dikosongkan';
  end if;

  insert into public.jabatan (kode, nama)
  values ('UJI-AUTOBATCH', 'Jabatan Uji Auto Batch')
  returning id into v_id;

  select b.* into v_batch
  from public.batches b
  join public.revisions r on r.batch_id = b.id
  where r.table_name = 'jabatan' and r.row_id = v_id;

  if v_batch.id is null then
    raise exception 'GAGAL: perubahan tanpa app.batch_id tidak menghasilkan batch apa pun';
  end if;
  if v_batch.jenis <> 'edit' then
    raise exception 'GAGAL: batch otomatis berjenis "%" (harus "edit")', v_batch.jenis;
  end if;

  raise notice 'OK   tulis tanpa app.batch_id -> batch otomatis jenis "edit" dibuat';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. begin_batch(): revisi masuk ke batch yang dibuka, bukan batch otomatis
-- ---------------------------------------------------------------------------
do $$
declare
  v_batch_id  uuid;
  v_id        uuid;
  v_got       uuid;
  v_jenis     text;
begin
  v_batch_id := public.begin_batch('merge', 'Uji batch eksplisit', true);

  if public.current_batch_id() <> v_batch_id then
    raise exception 'GAGAL: begin_batch tidak mengisi app.batch_id';
  end if;

  insert into public.jabatan (kode, nama)
  values ('UJI-BATCH', 'Jabatan Uji Batch Eksplisit')
  returning id into v_id;

  select r.batch_id into v_got
  from public.revisions r where r.table_name = 'jabatan' and r.row_id = v_id;

  if v_got <> v_batch_id then
    raise exception 'GAGAL: revisi masuk ke batch % (harus %)', v_got, v_batch_id;
  end if;

  select jenis into v_jenis from public.batches where id = v_batch_id;
  if v_jenis <> 'merge' then
    raise exception 'GAGAL: jenis batch = "%" (harus "merge")', v_jenis;
  end if;

  perform set_config('app.batch_id', '', true);
  raise notice 'OK   begin_batch() mengelompokkan revisi ke batch yang dibuka';
end
$$;

-- ---------------------------------------------------------------------------
-- 8. employee_private dibuat otomatis saat Karyawan dibuat, dalam batch yang sama
-- ---------------------------------------------------------------------------
do $$
declare
  v_id       uuid;
  v_n        integer;
  v_batches  integer;
begin
  insert into public.employees (personnel_number, full_name)
  values ('UJI-0001', 'Karyawan Uji Satu')
  returning id into v_id;

  select count(*) into v_n from public.employee_private where employee_id = v_id;
  if v_n <> 1 then
    raise exception 'GAGAL: employee_private tidak dibuat otomatis (dapat % baris)', v_n;
  end if;

  select count(distinct batch_id) into v_batches
  from public.revisions
  where row_id = v_id and table_name in ('employees', 'employee_private');
  if v_batches <> 1 then
    raise exception 'GAGAL: revisi employees + employee_private tersebar di % batch (harus 1)', v_batches;
  end if;

  select count(*) into v_n
  from public.revisions where table_name = 'employee_private' and row_id = v_id;
  if v_n <> 1 then
    raise exception 'GAGAL: employee_private tidak menghasilkan revisi (dapat %)', v_n;
  end if;

  raise notice 'OK   employee_private dibuat otomatis + ikut tercatat di batch yang sama';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Guard siklus org_units
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
begin
  insert into public.org_units (kode, nama, tipe)
    values ('UJI-DIR', 'Direktorat Uji', 'direktorat') returning id into v_a;
  insert into public.org_units (kode, nama, tipe, parent_id)
    values ('UJI-DIV', 'Divisi Uji', 'divisi', v_a) returning id into v_b;
  insert into public.org_units (kode, nama, tipe, parent_id)
    values ('UJI-BAG', 'Bagian Uji', 'bagian', v_b) returning id into v_c;

  -- induk = keturunannya sendiri -> harus ditolak
  begin
    update public.org_units set parent_id = v_c where id = v_a;
    raise exception 'GAGAL: siklus org_units (A -> C, C keturunan A) TIDAK ditolak';
  exception
    when check_violation then
      null;  -- diharapkan
  end;

  -- induk = dirinya sendiri -> harus ditolak
  begin
    update public.org_units set parent_id = v_b where id = v_b;
    raise exception 'GAGAL: org_units menjadi induk dirinya sendiri TIDAK ditolak';
  exception
    when check_violation then
      null;  -- diharapkan
  end;

  raise notice 'OK   guard siklus org_units menolak parent = keturunan dan parent = diri sendiri';
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Kolom referensi Karyawan wajib menunjuk Lookup dengan tipe yang cocok
-- ---------------------------------------------------------------------------
do $$
declare
  v_gender uuid;
  v_jg     uuid;
begin
  insert into public.lookups (tipe, kode, label)
    values ('gender', 'L', 'Laki-laki') returning id into v_gender;
  insert into public.lookups (tipe, kode, label)
    values ('job_grade', 'P3-13', 'Pratama III - 13') returning id into v_jg;

  -- benar
  update public.employees set gender_id = v_gender where personnel_number = 'UJI-0001';

  -- salah tipe
  begin
    update public.employees set gender_id = v_jg where personnel_number = 'UJI-0001';
    raise exception 'GAGAL: gender_id boleh menunjuk Lookup bertipe job_grade';
  exception
    when check_violation then
      null;  -- diharapkan
  end;

  raise notice 'OK   validasi tipe Lookup pada kolom referensi employees bekerja';
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Tulis housekeeping (last_used_at) tidak mengotori log; perubahan nyata dicatat
-- ---------------------------------------------------------------------------
do $$
declare
  v_id      uuid;
  v_before  integer;
  v_after   integer;
begin
  insert into public.api_keys (nama_konsumen, key_prefix, key_hash, allowed_fields)
  values ('Konsumen Uji', 'hck_uji1', 'sha256-uji-1', array['personnel_number','full_name'])
  returning id into v_id;

  select count(*) into v_before
  from public.revisions where table_name = 'api_keys' and row_id = v_id;
  if v_before <> 1 then
    raise exception 'GAGAL: INSERT api_keys menghasilkan % revisi (harus 1)', v_before;
  end if;

  update public.api_keys set last_used_at = now() where id = v_id;
  select count(*) into v_after
  from public.revisions where table_name = 'api_keys' and row_id = v_id;
  if v_after <> v_before then
    raise exception 'GAGAL: sentuhan last_used_at menghasilkan revisi baru (% -> %)', v_before, v_after;
  end if;

  update public.api_keys set status = 'nonaktif' where id = v_id;
  select count(*) into v_after
  from public.revisions where table_name = 'api_keys' and row_id = v_id;
  if v_after <> v_before + 1 then
    raise exception 'GAGAL: perubahan status api_keys tidak tercatat (% -> %)', v_before, v_after;
  end if;

  raise notice 'OK   last_used_at tidak membuat revisi; perubahan nyata tetap tercatat';
end
$$;

-- ---------------------------------------------------------------------------
-- 12. Tidak ada DELETE policy maupun DELETE grant di keenam tabel data
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array[
    'employees','employee_private','org_units','jabatan','lookups','api_keys'
  ];
  v_bad text;
begin
  select string_agg(format('%s (policy %s, cmd %s)', tablename, policyname, cmd), '; ')
  into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename = any(v_tables)
    and cmd in ('DELETE', 'ALL');
  if v_bad is not null then
    raise exception 'GAGAL: ada policy DELETE/ALL di tabel data: %', v_bad;
  end if;

  select string_agg(format('%s -> %s', table_name, grantee), '; ')
  into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_tables)
    and privilege_type = 'DELETE'
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if v_bad is not null then
    raise exception 'GAGAL: DELETE ter-grant di tabel data: %', v_bad;
  end if;

  raise notice 'OK   tidak ada policy DELETE dan tidak ada grant DELETE di 6 tabel data';
end
$$;

-- ---------------------------------------------------------------------------
-- 13. Trigger no_delete benar-benar menolak DELETE (bahkan untuk superuser)
-- ---------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array[
    'employees','employee_private','org_units','jabatan','lookups','api_keys'
  ] loop
    begin
      execute format('delete from public.%I where false', v_t);
      raise exception 'GAGAL: DELETE pada % tidak ditolak', v_t;
    exception
      when insufficient_privilege then
        null;  -- diharapkan
    end;
  end loop;
  raise notice 'OK   DELETE ditolak trigger di keenam tabel data';
end
$$;

-- revisions append-only
do $$
begin
  begin
    update public.revisions set actor_id = null where false;
    raise exception 'GAGAL: UPDATE pada revisions tidak ditolak';
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from public.revisions where false;
    raise exception 'GAGAL: DELETE pada revisions tidak ditolak';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'OK   revisions append-only (UPDATE & DELETE ditolak)';
end
$$;

-- batches hanya boleh berubah pada reverted_by_batch_id
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.batches order by created_at limit 1;
  begin
    update public.batches set keterangan = 'diubah' where id = v_id;
    raise exception 'GAGAL: kolom keterangan pada batches boleh diubah';
  exception
    when insufficient_privilege then null;
  end;
  update public.batches set reverted_by_batch_id = v_id where id = v_id;
  update public.batches set reverted_by_batch_id = null where id = v_id;
  raise notice 'OK   batches hanya boleh diubah pada reverted_by_batch_id';
end
$$;

-- ---------------------------------------------------------------------------
-- 14. View v_employees menurunkan rantai Unit Organisasi dan kolom turunan
-- ---------------------------------------------------------------------------
do $$
declare
  v_bag uuid;
  v_row record;
begin
  select id into v_bag from public.org_units where kode = 'UJI-BAG';

  update public.employees
     set org_unit_id = v_bag,
         original_start_date = current_date - interval '3 years 4 months'
   where personnel_number = 'UJI-0001';

  select * into v_row from public.v_employees where personnel_number = 'UJI-0001';

  if v_row.org_unit_nama <> 'Bagian Uji' then
    raise exception 'GAGAL: org_unit_nama = "%" (harus "Bagian Uji")', v_row.org_unit_nama;
  end if;
  if v_row.divisi_nama <> 'Divisi Uji' then
    raise exception 'GAGAL: divisi_nama = "%" (harus "Divisi Uji" dari hierarki)', v_row.divisi_nama;
  end if;
  if v_row.direktorat_nama <> 'Direktorat Uji' then
    raise exception 'GAGAL: direktorat_nama = "%" (harus "Direktorat Uji")', v_row.direktorat_nama;
  end if;
  if v_row.masa_kerja_tahun <> 3 or v_row.masa_kerja_bulan <> 4 then
    raise exception 'GAGAL: masa kerja = % tahun % bulan (harus 3 tahun 4 bulan)',
      v_row.masa_kerja_tahun, v_row.masa_kerja_bulan;
  end if;

  raise notice 'OK   v_employees menurunkan direktorat/divisi/bagian + masa kerja';
end
$$;

-- ---------------------------------------------------------------------------
-- 15. v_employees_api tidak memuat satu pun kolom Data Pribadi Sensitif
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_n   integer;
begin
  select string_agg(column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_employees_api'
    and column_name in ('date_of_birth','place_of_birth','religion','marital_status','usia');
  if v_bad is not null then
    raise exception 'GAGAL: v_employees_api memuat kolom sensitif: %', v_bad;
  end if;

  -- Cheap tripwire. The authoritative comparison against API-CONTRACT.md
  -- §"Kolom v_employees_api yang bisa diminta" lives in
  -- tests/apiColumns.test.ts and runs in `npm test`.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_employees_api';
  if v_n <> 58 then
    raise exception
      'GAGAL: v_employees_api punya % kolom, bukan 58. Kalau perubahan ini memang disengaja, perbarui API-CONTRACT.md, lalu angka 58 di scripts/verify-schema.sql §15.',
      v_n;
  end if;

  raise notice 'OK   v_employees_api = 58 kolom, tanpa Data Pribadi Sensitif';
end
$$;

-- service_role menembus RLS, jadi security_invoker tidak melindungi apa pun di
-- sana. Satu-satunya pengaman untuk route api/v1 adalah tidak adanya grant.
do $$
declare v_bad text;
begin
  select string_agg(format('%s -> %s (%s)', table_name, grantee, privilege_type), '; ')
  into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'v_employees_private'
    and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_bad is not null then
    raise exception
      'GAGAL: v_employees_private ter-grant ke role yang menembus RLS: %', v_bad;
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'v_employees_api'
      and grantee = 'service_role' and privilege_type = 'SELECT'
  ) then
    raise exception 'GAGAL: service_role tidak bisa membaca v_employees_api (route api/v1 akan gagal)';
  end if;

  raise notice 'OK   service_role bisa baca v_employees_api, tidak bisa baca v_employees_private';
end
$$;

-- ---------------------------------------------------------------------------
-- 16. RLS benar-benar menggigit
-- ---------------------------------------------------------------------------

-- fixture: satu admin, satu viewer. Trigger on_auth_user_created membuat
-- profiles-nya (dan menolak email di luar domain kantor).
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin.uji@hutamakarya.com'),
  ('b0000000-0000-4000-8000-000000000002', 'viewer.uji@hutamakarya.com')
on conflict (id) do nothing;

update public.profiles set role = 'admin'
where id = 'a0000000-0000-4000-8000-000000000001';

-- Kenaikan hak akses adalah perubahan yang paling layak diaudit di sistem HR
-- (PRD #13: "setiap perubahan pada tabel mana pun").
do $$
declare
  v_admin uuid := 'a0000000-0000-4000-8000-000000000001';
  v_n     integer;
  v_rev   public.revisions%rowtype;
begin
  select count(*) into v_n
  from public.revisions
  where table_name = 'profiles' and action = 'insert';
  if v_n <> 2 then
    raise exception
      'GAGAL: pembuatan 2 profil menghasilkan % revisi insert (harus 2)', v_n;
  end if;

  select count(*) into v_n
  from public.revisions
  where table_name = 'profiles' and row_id = v_admin and action = 'update';
  if v_n <> 1 then
    raise exception
      'GAGAL: perubahan role menghasilkan % revisi update (harus 1)', v_n;
  end if;

  select * into v_rev
  from public.revisions
  where table_name = 'profiles' and row_id = v_admin and action = 'update';

  if v_rev.before ->> 'role' <> 'viewer' then
    raise exception 'GAGAL: before->>role = "%" (harus "viewer")', v_rev.before ->> 'role';
  end if;
  if v_rev.after ->> 'role' <> 'admin' then
    raise exception 'GAGAL: after->>role = "%" (harus "admin")', v_rev.after ->> 'role';
  end if;
  if v_rev.after ->> 'email' <> 'admin.uji@hutamakarya.com' then
    raise exception 'GAGAL: after->>email = "%"', v_rev.after ->> 'email';
  end if;

  raise notice 'OK   perubahan profiles.role tercatat sebagai Revisi (viewer -> admin)';
end
$$;

-- domain email kantor benar-benar dipaksa
do $$
begin
  begin
    insert into auth.users (id, email)
    values ('c0000000-0000-4000-8000-000000000003', 'orang.luar@gmail.com');
    raise exception 'GAGAL: pendaftaran email di luar domain kantor TIDAK ditolak';
  exception
    when insufficient_privilege then null;  -- diharapkan
  end;
  raise notice 'OK   on_auth_user_created menolak email di luar domain kantor';
end
$$;

do $$
declare v_role text;
begin
  select role into v_role from public.profiles where email = 'viewer.uji@hutamakarya.com';
  if v_role <> 'viewer' then
    raise exception 'GAGAL: profil baru berperan "%" (harus "viewer")', v_role;
  end if;
  raise notice 'OK   profiles dibuat otomatis dengan role default "viewer"';
end
$$;

-- ---- sebagai VIEWER ----
set request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;

do $$
declare v_n integer;
begin
  if public.is_admin() then
    raise exception 'GAGAL: viewer dianggap admin oleh is_admin()';
  end if;

  select count(*) into v_n from public.employee_private;
  if v_n <> 0 then
    raise exception
      'GAGAL: viewer bisa membaca % baris employee_private (RLS harus menolak semuanya)', v_n;
  end if;

  select count(*) into v_n from public.v_employees_private;
  if v_n <> 0 then
    raise exception 'GAGAL: viewer bisa membaca % baris v_employees_private', v_n;
  end if;

  -- tapi data karyawan non-sensitif tetap boleh dibaca
  select count(*) into v_n from public.employees;
  if v_n < 1 then
    raise exception 'GAGAL: viewer tidak bisa membaca employees sama sekali';
  end if;

  raise notice 'OK   RLS: viewer ditolak di employee_private & v_employees_private, tetap bisa baca employees';
end
$$;

do $$
begin
  begin
    insert into public.org_units (kode, nama, tipe)
    values ('UJI-RLS', 'Unit Uji RLS', 'divisi');
    raise exception 'GAGAL: viewer berhasil INSERT ke org_units';
  exception
    when insufficient_privilege then null;  -- diharapkan
  end;
  raise notice 'OK   RLS: INSERT org_units oleh viewer ditolak';
end
$$;

do $$
declare v_n integer;
begin
  update public.employees set full_name = 'DIUBAH OLEH VIEWER'
   where personnel_number = 'UJI-0001';
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'GAGAL: viewer mengubah % baris employees', v_n;
  end if;
  raise notice 'OK   RLS: UPDATE employees oleh viewer tidak mengubah baris apa pun';
end
$$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.api_keys;
  if v_n <> 0 then
    raise exception 'GAGAL: viewer bisa melihat % baris api_keys', v_n;
  end if;
  raise notice 'OK   RLS: viewer tidak bisa melihat api_keys';
end
$$;

-- revisions.after adalah salinan baris yang berubah. Kalau log bisa dibaca
-- bebas, viewer tinggal membaca Data Pribadi Sensitif dan key_hash dari sana.
do $$
declare
  v_priv  integer;
  v_keys  integer;
  v_lain  integer;
begin
  select count(*) into v_priv
  from public.revisions where table_name = 'employee_private';
  if v_priv <> 0 then
    raise exception
      'GAGAL: viewer bisa membaca % revisi employee_private (Data Pribadi Sensitif bocor lewat revisions.after)', v_priv;
  end if;

  select count(*) into v_keys
  from public.revisions where table_name = 'api_keys';
  if v_keys <> 0 then
    raise exception
      'GAGAL: viewer bisa membaca % revisi api_keys (key_hash bocor lewat revisions.after)', v_keys;
  end if;

  -- tapi log biasa tetap boleh dibaca viewer (matriks §5)
  select count(*) into v_lain
  from public.revisions where table_name = 'org_units';
  if v_lain < 1 then
    raise exception 'GAGAL: viewer tidak bisa membaca revisi org_units sama sekali';
  end if;

  raise notice 'OK   RLS: revisions employee_private & api_keys tersembunyi dari viewer, sisanya terbaca';
end
$$;

-- Revisi `profiles` memuat email + role. Aturannya mengikuti profiles_select:
-- viewer hanya boleh melihat revisi profilnya sendiri, bukan milik orang lain.
do $$
declare
  v_viewer uuid := 'b0000000-0000-4000-8000-000000000002';
  v_admin  uuid := 'a0000000-0000-4000-8000-000000000001';
  v_n      integer;
begin
  select count(*) into v_n
  from public.revisions where table_name = 'profiles' and row_id = v_admin;
  if v_n <> 0 then
    raise exception
      'GAGAL: viewer bisa membaca % revisi profiles milik orang lain (email & role bocor)', v_n;
  end if;

  select count(*) into v_n
  from public.revisions where table_name = 'profiles' and row_id = v_viewer;
  if v_n <> 1 then
    raise exception
      'GAGAL: viewer melihat % revisi profilnya sendiri (harus 1, sama seperti profiles_select)', v_n;
  end if;

  raise notice 'OK   RLS: viewer hanya melihat revisi profiles miliknya sendiri';
end
$$;

do $$
begin
  begin
    perform public.begin_batch('edit', 'batch oleh viewer', true);
    raise exception 'GAGAL: viewer berhasil memanggil begin_batch()';
  exception
    when insufficient_privilege then null;  -- diharapkan
  end;
  raise notice 'OK   RLS: begin_batch() oleh viewer ditolak';
end
$$;

reset role;

-- ---- sebagai ADMIN ----
set request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;

do $$
declare v_n integer;
begin
  if not public.is_admin() then
    raise exception 'GAGAL: admin tidak dikenali oleh is_admin()';
  end if;

  select count(*) into v_n from public.employee_private;
  if v_n < 1 then
    raise exception 'GAGAL: admin tidak bisa membaca employee_private';
  end if;

  select count(*) into v_n from public.v_employees_private;
  if v_n < 1 then
    raise exception 'GAGAL: admin tidak bisa membaca v_employees_private';
  end if;

  raise notice 'OK   RLS: admin bisa membaca employee_private & v_employees_private (% baris)', v_n;
end
$$;

do $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.revisions where table_name in ('employee_private', 'api_keys');
  if v_n < 1 then
    raise exception 'GAGAL: admin tidak bisa membaca revisi employee_private/api_keys';
  end if;
  raise notice 'OK   RLS: admin bisa membaca revisi employee_private & api_keys (% baris)', v_n;

  -- admin melihat SEMUA revisi profiles, termasuk milik orang lain
  select count(*) into v_n from public.revisions where table_name = 'profiles';
  if v_n <> 3 then
    raise exception
      'GAGAL: admin melihat % revisi profiles (harus 3: 2 insert + 1 kenaikan role)', v_n;
  end if;
  raise notice 'OK   RLS: admin bisa membaca seluruh revisi profiles (% baris)', v_n;
end
$$;

do $$
declare
  v_n integer;
  v_batch uuid;
begin
  v_batch := public.begin_batch('edit', 'Uji tulis oleh admin', true);

  insert into public.org_units (kode, nama, tipe)
  values ('UJI-RLS-ADMIN', 'Unit Uji RLS Admin', 'divisi');

  update public.employees set keterangan = 'diubah admin'
   where personnel_number = 'UJI-0001';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'GAGAL: admin gagal mengubah employees (% baris)', v_n;
  end if;

  select count(*) into v_n from public.revisions where batch_id = v_batch;
  if v_n < 2 then
    raise exception 'GAGAL: tulisan admin hanya menghasilkan % revisi (harus >= 2)', v_n;
  end if;

  perform set_config('app.batch_id', '', true);
  raise notice 'OK   RLS: admin bisa menulis, dan tulisannya tercatat sebagai revisi';
end
$$;

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- 17. Daftar tipe Lookup di CHECK constraint == lib/validation/lookupTypes.ts
-- ---------------------------------------------------------------------------
do $$
declare
  v_root    text := nullif(current_setting('hc.repo_root', true), '');
  v_def     text;
  v_db      text[];
  v_src     text;
  v_block   text;
  v_ts      text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'lookups' and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%tipe%';

  if v_def is null then
    raise exception 'GAGAL: CHECK constraint pada lookups.tipe tidak ditemukan';
  end if;

  select array_agg(m[1] order by m[1]) into v_db
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;

  if array_length(v_db, 1) <> 11 then
    raise exception 'GAGAL: CHECK lookups.tipe memuat % nilai (harus 11): %',
      array_length(v_db, 1), array_to_string(v_db, ', ');
  end if;

  if v_root is null then
    raise warning
      'DILEWATI: perbandingan dengan lib/validation/lookupTypes.ts butuh -v repo_root=<path>. Jalankan lewat scripts/db-local.sh, atau andalkan `npm test` (lib/validation/lookupTypes.test.ts).';
    raise notice 'OK   CHECK lookups.tipe memuat 11 nilai';
    return;
  end if;

  begin
    v_src := pg_read_file(v_root || '/lib/validation/lookupTypes.ts');
  exception
    when others then
      raise exception
        'GAGAL: tidak bisa membaca %/lib/validation/lookupTypes.ts (%). ', v_root, sqlerrm;
  end;

  v_block := substring(v_src from 'LOOKUP_TYPES[^=]*=\s*\[([^\]]*)\]');
  if v_block is null then
    raise exception 'GAGAL: tidak menemukan array LOOKUP_TYPES di lookupTypes.ts';
  end if;

  select array_agg(m[1] order by m[1]) into v_ts
  from regexp_matches(v_block, '"([a-z_]+)"', 'g') m;

  if v_ts is distinct from v_db then
    raise exception
      'GAGAL: daftar tipe Lookup berbeda. CHECK constraint = [%] ; lookupTypes.ts = [%]',
      array_to_string(v_db, ', '), array_to_string(coalesce(v_ts, '{}'::text[]), ', ');
  end if;

  raise notice 'OK   11 tipe Lookup identik di CHECK constraint dan lib/validation/lookupTypes.ts';
end
$$;

-- ===========================================================================
-- 18. 0002_batch_operations.sql — satu tindakan = satu Batch (ADR-006)
--
-- Ini adalah exit criteria ROADMAP Fase 3 yang dijadikan bisa dicek mesin:
-- "merge dari halaman itu → semua karyawan pindah, unit lama nonaktif, SATU
-- batch `merge` muncul di log → revert batch → keadaan kembali PERSIS,
-- termasuk status unit lama."
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 18.1 Kesepuluh fungsi ada, SECURITY INVOKER, dan tidak bisa dipanggil anon
-- ---------------------------------------------------------------------------
do $$
declare
  v_expected text[] := array[
    'assert_admin','merge_org_unit','merge_jabatan','merge_lookup',
    'apply_revert_operation','revert_skip_entry','revert_plan_for_batch',
    'apply_revert','revert_batch','seed_from_payload'
  ];
  v_missing  text[];
  v_definer  text[];
  v_anon     text[];
begin
  select array_agg(f order by f) into v_missing
  from unnest(v_expected) f
  where not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f
  );
  if v_missing is not null then
    raise exception 'GAGAL: fungsi 0002 hilang: %', array_to_string(v_missing, ', ');
  end if;

  -- SECURITY INVOKER dipilih sengaja (ADR-006): fungsi berjalan sebagai
  -- pemanggil, jadi RLS tetap menggigit di setiap statement. SECURITY DEFINER
  -- tanpa pemeriksaan role di dalamnya akan menyerahkan hak admin ke viewer.
  select array_agg(p.proname order by p.proname) into v_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any(v_expected) and p.prosecdef;
  if v_definer is not null then
    raise exception
      'GAGAL: fungsi berikut SECURITY DEFINER padahal harus INVOKER (ADR-006): %',
      array_to_string(v_definer, ', ');
  end if;

  -- anon tidak pernah boleh mengeksekusi apa pun dari file ini.
  select array_agg(p.proname order by p.proname) into v_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any(v_expected)
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon is not null then
    raise exception 'GAGAL: anon bisa mengeksekusi: %', array_to_string(v_anon, ', ');
  end if;

  raise notice 'OK   10 fungsi 0002 ada, semuanya SECURITY INVOKER, anon ditolak';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.2 Merge Unit Organisasi = TEPAT SATU Batch 'merge' berisi semua Revisi
-- ---------------------------------------------------------------------------

-- fixture: satu direktorat, dua divisi kembar, satu bagian anak, dua Karyawan
do $$
declare
  v_dir uuid; v_src uuid; v_tgt uuid; v_child uuid;
begin
  insert into public.org_units (kode, nama, tipe)
    values ('UJI-M-DIR', 'Direktorat Uji Merge', 'direktorat') returning id into v_dir;
  insert into public.org_units (kode, nama, tipe, parent_id)
    values ('UJI-M-SRC', 'Divisi QHSSE', 'divisi', v_dir) returning id into v_src;
  insert into public.org_units (kode, nama, tipe, parent_id)
    values ('UJI-M-TGT', 'DIVISI QHSSE', 'divisi', v_dir) returning id into v_tgt;
  insert into public.org_units (kode, nama, tipe, parent_id)
    values ('UJI-M-CHILD', 'Bagian K3 Uji', 'bagian', v_src) returning id into v_child;

  insert into public.employees (personnel_number, full_name, org_unit_id)
  values ('UJI-M-0001', 'Karyawan Uji Merge Satu', v_src),
         ('UJI-M-0002', 'Karyawan Uji Merge Dua',  v_src);
end
$$;

do $$
declare
  v_src      uuid;
  v_tgt      uuid;
  v_child    uuid;
  v_res      jsonb;
  v_batch    uuid;
  v_n        integer;
  v_jenis    text;
  v_batches  integer;
begin
  select id into v_src   from public.org_units where kode = 'UJI-M-SRC';
  select id into v_tgt   from public.org_units where kode = 'UJI-M-TGT';
  select id into v_child from public.org_units where kode = 'UJI-M-CHILD';

  select count(*) into v_batches from public.batches where jenis = 'merge';

  v_res := public.merge_org_unit(v_src, v_tgt, 'Uji merge Unit Organisasi');
  v_batch := (v_res ->> 'batch_id')::uuid;

  if (v_res ->> 'moved_employees')::int <> 2 then
    raise exception 'GAGAL: merge memindahkan % Karyawan (harus 2)', v_res ->> 'moved_employees';
  end if;
  if (v_res ->> 'moved_children')::int <> 1 then
    raise exception 'GAGAL: merge me-reparent % unit anak (harus 1)', v_res ->> 'moved_children';
  end if;

  -- TEPAT SATU batch 'merge' baru (inti ADR-006: bukan tiga, bukan 1+3)
  select count(*) into v_n from public.batches where jenis = 'merge';
  if v_n <> v_batches + 1 then
    raise exception
      'GAGAL: satu Merge menghasilkan % Batch jenis "merge" (harus tepat 1)', v_n - v_batches;
  end if;

  select jenis into v_jenis from public.batches where id = v_batch;
  if v_jenis <> 'merge' then
    raise exception 'GAGAL: jenis Batch merge = "%" (harus "merge")', v_jenis;
  end if;

  -- setiap Karyawan yang pindah, setiap anak yang di-reparent, dan asal yang
  -- dinonaktifkan: SEMUA di batch_id yang sama
  select count(*) into v_n from public.revisions where batch_id = v_batch;
  if v_n <> 4 then
    raise exception
      'GAGAL: Batch merge memuat % Revisi (harus 4: 2 Karyawan + 1 unit anak + 1 unit asal)', v_n;
  end if;

  select count(*) into v_n
  from public.revisions
  where batch_id = v_batch and table_name = 'employees' and action = 'update';
  if v_n <> 2 then
    raise exception 'GAGAL: % Revisi employees di Batch merge (harus 2)', v_n;
  end if;

  select count(*) into v_n
  from public.revisions
  where batch_id = v_batch and table_name = 'org_units' and row_id = v_child;
  if v_n <> 1 then
    raise exception 'GAGAL: Revisi unit anak tidak ada di Batch merge';
  end if;

  select count(*) into v_n
  from public.revisions
  where batch_id = v_batch and table_name = 'org_units' and row_id = v_src;
  if v_n <> 1 then
    raise exception 'GAGAL: Revisi penonaktifan unit asal tidak ada di Batch merge';
  end if;

  -- tidak ada Revisi dari Merge ini yang nyasar ke batch otomatis 'edit'
  select count(distinct r.batch_id) into v_n
  from public.revisions r
  where r.action = 'update'
    and (
      (r.table_name = 'org_units' and r.row_id in (v_src, v_child))
      or (r.table_name = 'employees' and r.row_id in (
            select e.id from public.employees e
             where e.personnel_number in ('UJI-M-0001','UJI-M-0002')))
    );
  if v_n <> 1 then
    raise exception
      'GAGAL: Revisi Merge tersebar di % Batch (harus 1) — app.batch_id tidak bertahan', v_n;
  end if;

  -- keadaan setelah merge
  if (select org_unit_id from public.employees where personnel_number = 'UJI-M-0001') <> v_tgt then
    raise exception 'GAGAL: Karyawan tidak pindah ke Unit Organisasi tujuan';
  end if;
  if (select parent_id from public.org_units where id = v_child) <> v_tgt then
    raise exception 'GAGAL: unit anak tidak di-reparent ke tujuan';
  end if;
  if (select status from public.org_units where id = v_src) <> 'nonaktif' then
    raise exception 'GAGAL: Unit Organisasi asal tidak dinonaktifkan';
  end if;
  if (select merged_into_id from public.org_units where id = v_src) <> v_tgt then
    raise exception 'GAGAL: merged_into_id unit asal tidak menunjuk tujuan';
  end if;

  raise notice 'OK   merge_org_unit: 1 Batch "merge", 4 Revisi, semuanya satu batch_id';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.3 revert_batch mengembalikan keadaan PERSIS + tepat satu Batch 'revert'
-- ---------------------------------------------------------------------------
do $$
declare
  v_src        uuid;
  v_tgt        uuid;
  v_child      uuid;
  v_merge      uuid;
  v_res        jsonb;
  v_revert     uuid;
  v_n          integer;
  v_reverts    integer;
begin
  select id into v_src   from public.org_units where kode = 'UJI-M-SRC';
  select id into v_tgt   from public.org_units where kode = 'UJI-M-TGT';
  select id into v_child from public.org_units where kode = 'UJI-M-CHILD';

  select id into v_merge from public.batches
   where jenis = 'merge' and keterangan = 'Uji merge Unit Organisasi';

  select count(*) into v_reverts from public.batches where jenis = 'revert';

  v_res := public.revert_batch(v_merge, null);
  v_revert := (v_res ->> 'batch_id')::uuid;

  if (v_res ->> 'applied')::int <> 4 then
    raise exception 'GAGAL: revert menerapkan % langkah (harus 4)', v_res ->> 'applied';
  end if;

  select count(*) into v_n from public.batches where jenis = 'revert';
  if v_n <> v_reverts + 1 then
    raise exception
      'GAGAL: satu revert batch menghasilkan % Batch "revert" (harus tepat 1)', v_n - v_reverts;
  end if;

  -- keadaan kembali PERSIS, termasuk status unit lama (ROADMAP Fase 3)
  if (select status from public.org_units where id = v_src) <> 'aktif' then
    raise exception 'GAGAL: status Unit Organisasi asal tidak kembali "aktif"';
  end if;
  if (select merged_into_id from public.org_units where id = v_src) is not null then
    raise exception 'GAGAL: merged_into_id unit asal tidak dikosongkan lagi';
  end if;
  if (select parent_id from public.org_units where id = v_child) <> v_src then
    raise exception 'GAGAL: unit anak tidak kembali ke induk asalnya';
  end if;
  select count(*) into v_n from public.employees
   where personnel_number in ('UJI-M-0001','UJI-M-0002') and org_unit_id = v_src;
  if v_n <> 2 then
    raise exception 'GAGAL: % dari 2 Karyawan kembali ke Unit Organisasi asal', v_n;
  end if;

  -- revert menulis Revisi baru, tidak menghapus log
  select count(*) into v_n from public.revisions where batch_id = v_revert;
  if v_n <> 4 then
    raise exception 'GAGAL: Batch revert memuat % Revisi (harus 4)', v_n;
  end if;
  select count(*) into v_n from public.revisions where batch_id = v_merge;
  if v_n <> 4 then
    raise exception 'GAGAL: revert mengubah isi Batch merge (sekarang % Revisi)', v_n;
  end if;

  -- batches.reverted_by_batch_id terisi
  if (select reverted_by_batch_id from public.batches where id = v_merge) <> v_revert then
    raise exception 'GAGAL: reverted_by_batch_id tidak menunjuk Batch revert';
  end if;

  raise notice 'OK   revert_batch: keadaan kembali persis (termasuk status & merged_into_id), 1 Batch "revert"';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.4 Batch yang sudah di-revert tidak bisa di-revert dua kali
-- ---------------------------------------------------------------------------
do $$
declare
  v_merge uuid;
  v_n     integer;
begin
  select id into v_merge from public.batches
   where jenis = 'merge' and keterangan = 'Uji merge Unit Organisasi';

  select count(*) into v_n from public.batches where jenis = 'revert';

  begin
    perform public.revert_batch(v_merge, null);
    raise exception 'GAGAL: Batch yang sudah di-revert bisa di-revert lagi';
  exception
    when object_not_in_prerequisite_state then null;  -- diharapkan (55000)
  end;

  if (select count(*) from public.batches where jenis = 'revert') <> v_n then
    raise exception 'GAGAL: revert kedua tetap membuat Batch baru';
  end if;

  raise notice 'OK   revert_batch menolak Batch yang sudah pernah dikembalikan';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.5 apply_revert atas Revisi insert -> status nonaktif, TIDAK PERNAH DELETE
-- ---------------------------------------------------------------------------
do $$
declare
  v_batch   uuid;
  v_id      uuid;
  v_plan    jsonb;
  v_res     jsonb;
  v_jenis   text;
  v_n       integer;
begin
  v_batch := public.begin_batch('create', 'Uji insert lalu revert', true);
  insert into public.jabatan (kode, nama)
  values ('UJI-REV-INS', 'Jabatan Uji Revert Insert')
  returning id into v_id;
  perform set_config('app.batch_id', '', true);

  v_plan := public.revert_plan_for_batch(v_batch);

  if v_plan ->> 'jenis' <> 'revert' then
    raise exception 'GAGAL: revert_plan_for_batch tidak berjenis "revert"';
  end if;
  if jsonb_array_length(v_plan -> 'operations') <> 1 then
    raise exception 'GAGAL: rencana memuat % langkah (harus 1)',
      jsonb_array_length(v_plan -> 'operations');
  end if;
  if v_plan -> 'operations' -> 0 ->> 'kind' <> 'deactivate' then
    raise exception 'GAGAL: Revisi insert direncanakan sebagai "%" (harus "deactivate")',
      v_plan -> 'operations' -> 0 ->> 'kind';
  end if;
  if v_plan -> 'operations' -> 0 -> 'values' <> jsonb_build_object('status','nonaktif') then
    raise exception 'GAGAL: langkah deactivate menulis % (harus {"status":"nonaktif"})',
      v_plan -> 'operations' -> 0 -> 'values';
  end if;

  v_res := public.apply_revert(v_plan);

  if (select status from public.jabatan where id = v_id) <> 'nonaktif' then
    raise exception 'GAGAL: revert Revisi insert tidak menonaktifkan barisnya';
  end if;
  select count(*) into v_n from public.jabatan where id = v_id;
  if v_n <> 1 then
    raise exception 'GAGAL: revert Revisi insert MENGHAPUS barisnya (ADR-003 dilanggar)';
  end if;

  select b.jenis into v_jenis from public.batches b where b.id = (v_res ->> 'batch_id')::uuid;
  if v_jenis <> 'revert' then
    raise exception 'GAGAL: apply_revert membuat Batch jenis "%" (harus "revert")', v_jenis;
  end if;

  raise notice 'OK   apply_revert: Revisi insert -> status nonaktif, baris tetap ada';
end
$$;

-- apply_revert menolak langkah "deactivate" yang mencoba menulis apa pun selain
-- status = 'nonaktif' (mis. rencana yang dipalsukan dari client).
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.jabatan where kode = 'UJI-REV-INS';

  begin
    perform public.apply_revert(jsonb_build_object(
      'jenis', 'revert',
      'keterangan', 'Rencana palsu',
      'operations', jsonb_build_array(jsonb_build_object(
        'revisionId', 1,
        'table', 'jabatan',
        'pkColumn', 'id',
        'rowId', v_id,
        'kind', 'deactivate',
        'values', jsonb_build_object('nama', 'DIRETAS')
      )),
      'skipped', '[]'::jsonb
    ));
    raise exception 'GAGAL: langkah deactivate bisa menulis kolom selain status';
  exception
    when invalid_parameter_value then null;  -- diharapkan (22023)
  end;

  -- tabel di luar tujuh tabel ter-log juga ditolak
  begin
    perform public.apply_revert(jsonb_build_object(
      'jenis', 'revert',
      'keterangan', 'Rencana palsu',
      'operations', jsonb_build_array(jsonb_build_object(
        'revisionId', 1,
        'table', 'batches',
        'pkColumn', 'id',
        'rowId', gen_random_uuid(),
        'kind', 'restore',
        'values', jsonb_build_object('jenis', 'edit')
      )),
      'skipped', '[]'::jsonb
    ));
    raise exception 'GAGAL: apply_revert menerima tabel di luar tujuh tabel ter-log';
  exception
    when invalid_parameter_value then null;  -- diharapkan (22023)
  end;

  if (select nama from public.jabatan where kode = 'UJI-REV-INS') = 'DIRETAS' then
    raise exception 'GAGAL: rencana palsu berhasil menulis';
  end if;

  raise notice 'OK   apply_revert menolak langkah palsu (kolom di luar status, tabel tak ter-log)';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.6 Merge Jabatan & Lookup: satu Batch, kolom yang benar yang pindah
-- ---------------------------------------------------------------------------
do $$
declare
  v_j1 uuid; v_j2 uuid; v_l1 uuid; v_l2 uuid; v_e uuid;
  v_res jsonb;
  v_n integer;
begin
  insert into public.jabatan (kode, nama) values ('UJI-MJ-A', 'Site Manager') returning id into v_j1;
  insert into public.jabatan (kode, nama) values ('UJI-MJ-B', 'Site Ops Manager') returning id into v_j2;
  insert into public.lookups (tipe, kode, label)
    values ('job_grade', 'UJI-JG-A', 'Pratama III - 13') returning id into v_l1;
  insert into public.lookups (tipe, kode, label)
    values ('job_grade', 'UJI-JG-B', 'PRATAMA III-13') returning id into v_l2;
  insert into public.lookups (tipe, kode, label)
    values ('band_jabatan', 'UJI-BJ-A', 'Band Uji');

  insert into public.employees (personnel_number, full_name, jabatan_id, job_grade_id)
  values ('UJI-M-0003', 'Karyawan Uji Merge Tiga', v_j1, v_l1)
  returning id into v_e;

  v_res := public.merge_jabatan(v_j1, v_j2, 'Uji merge Jabatan');
  if (v_res ->> 'moved_employees')::int <> 1 then
    raise exception 'GAGAL: merge_jabatan memindahkan % Karyawan (harus 1)', v_res ->> 'moved_employees';
  end if;
  select count(*) into v_n from public.revisions where batch_id = (v_res ->> 'batch_id')::uuid;
  if v_n <> 2 then
    raise exception 'GAGAL: Batch merge Jabatan memuat % Revisi (harus 2)', v_n;
  end if;
  if (select jabatan_id from public.employees where id = v_e) <> v_j2 then
    raise exception 'GAGAL: Karyawan tidak pindah ke Jabatan tujuan';
  end if;
  if (select status from public.jabatan where id = v_j1) <> 'nonaktif' then
    raise exception 'GAGAL: Jabatan asal tidak dinonaktifkan';
  end if;

  v_res := public.merge_lookup(v_l1, v_l2, 'Uji merge Lookup');
  if (v_res ->> 'moved_employees')::int <> 1 then
    raise exception
      'GAGAL: merge_lookup memindahkan % Karyawan (harus 1) — CASE per tipe salah kolom?',
      v_res ->> 'moved_employees';
  end if;
  if (select job_grade_id from public.employees where id = v_e) <> v_l2 then
    raise exception 'GAGAL: kolom job_grade_id Karyawan tidak pindah ke Lookup tujuan';
  end if;
  select count(*) into v_n from public.revisions where batch_id = (v_res ->> 'batch_id')::uuid;
  if v_n <> 2 then
    raise exception 'GAGAL: Batch merge Lookup memuat % Revisi (harus 2)', v_n;
  end if;

  raise notice 'OK   merge_jabatan & merge_lookup: satu Batch, kolom yang benar yang pindah';
end
$$;

-- merge lintas tipe Lookup ditolak (kalau tidak, Karyawan jadi menunjuk tipe salah)
do $$
declare v_l2 uuid; v_bj uuid;
begin
  select id into v_l2 from public.lookups where kode = 'UJI-JG-B';
  select id into v_bj from public.lookups where kode = 'UJI-BJ-A';
  begin
    perform public.merge_lookup(v_l2, v_bj, null);
    raise exception 'GAGAL: merge Lookup lintas tipe diterima';
  exception
    when invalid_parameter_value then null;  -- diharapkan (22023)
  end;

  -- merge asal yang sudah pernah di-merge juga ditolak
  begin
    perform public.merge_lookup(
      (select id from public.lookups where kode = 'UJI-JG-A'), v_l2, null);
    raise exception 'GAGAL: Lookup yang sudah di-merge bisa di-merge lagi';
  exception
    when object_not_in_prerequisite_state then null;  -- diharapkan (55000)
  end;

  raise notice 'OK   merge_lookup menolak lintas tipe dan asal yang sudah di-merge';
end
$$;

-- merge Unit Organisasi ke turunannya sendiri ditolak (akan membuat siklus)
do $$
declare v_src uuid; v_child uuid;
begin
  select id into v_src   from public.org_units where kode = 'UJI-M-SRC';
  select id into v_child from public.org_units where kode = 'UJI-M-CHILD';
  begin
    perform public.merge_org_unit(v_src, v_child, null);
    raise exception 'GAGAL: merge ke turunan sendiri diterima (akan membuat siklus)';
  exception
    when check_violation then null;  -- diharapkan (23514)
  end;
  raise notice 'OK   merge_org_unit menolak tujuan yang berada di bawah asal';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.7 VIEWER tidak bisa memanggil satu pun fungsi ini
-- ---------------------------------------------------------------------------
set request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;

do $$
declare
  v_src   uuid;
  v_tgt   uuid;
  v_j1    uuid;
  v_j2    uuid;
  v_l1    uuid;
  v_l2    uuid;
  v_batch uuid;
  v_ok    boolean;
begin
  if public.is_admin() then
    raise exception 'GAGAL: fixture salah — pemanggil dianggap admin';
  end if;

  select id into v_src   from public.org_units where kode = 'UJI-M-SRC';
  select id into v_tgt   from public.org_units where kode = 'UJI-M-TGT';
  select id into v_j1    from public.jabatan   where kode = 'UJI-MJ-A';
  select id into v_j2    from public.jabatan   where kode = 'UJI-MJ-B';
  select id into v_l1    from public.lookups   where kode = 'UJI-JG-A';
  select id into v_l2    from public.lookups   where kode = 'UJI-JG-B';
  select id into v_batch from public.batches   where jenis = 'merge' and keterangan = 'Uji merge Jabatan';

  v_ok := false;
  begin
    perform public.merge_org_unit(v_src, v_tgt, null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: viewer bisa memanggil merge_org_unit()'; end if;

  v_ok := false;
  begin
    perform public.merge_jabatan(v_j1, v_j2, null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: viewer bisa memanggil merge_jabatan()'; end if;

  v_ok := false;
  begin
    perform public.merge_lookup(v_l1, v_l2, null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: viewer bisa memanggil merge_lookup()'; end if;

  v_ok := false;
  begin
    perform public.revert_batch(v_batch, null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: viewer bisa memanggil revert_batch()'; end if;

  v_ok := false;
  begin
    perform public.apply_revert(jsonb_build_object(
      'jenis', 'revert',
      'keterangan', 'oleh viewer',
      'operations', jsonb_build_array(jsonb_build_object(
        'revisionId', 1, 'table', 'jabatan', 'pkColumn', 'id',
        'rowId', v_j2, 'kind', 'deactivate',
        'values', jsonb_build_object('status', 'nonaktif')
      )),
      'skipped', '[]'::jsonb
    ));
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: viewer bisa memanggil apply_revert()'; end if;

  v_ok := false;
  begin
    perform public.assert_admin('menguji');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'GAGAL: assert_admin() meloloskan viewer'; end if;

  raise notice 'OK   viewer ditolak (42501) di merge_org_unit, merge_jabatan, merge_lookup, revert_batch, apply_revert';
end
$$;

-- viewer juga tidak berhasil mengubah data lewat apply_revert_operation langsung
do $$
declare
  v_j2  uuid;
  v_ok  boolean := false;
begin
  select id into v_j2 from public.jabatan where kode = 'UJI-MJ-B';
  begin
    perform public.apply_revert_operation(jsonb_build_object(
      'revisionId', 1, 'table', 'jabatan', 'pkColumn', 'id',
      'rowId', v_j2, 'kind', 'deactivate',
      'values', jsonb_build_object('status', 'nonaktif')
    ));
  exception
    -- RLS memotong UPDATE-nya jadi 0 baris, dan fungsi menolak berisik (P0002).
    when no_data_found or insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'GAGAL: viewer bisa menulis lewat apply_revert_operation()';
  end if;
  raise notice 'OK   RLS tetap menggigit di dalam apply_revert_operation() (SECURITY INVOKER)';
end
$$;

reset role;
reset request.jwt.claims;

do $$
begin
  if (select status from public.jabatan where kode = 'UJI-MJ-B') <> 'aktif' then
    raise exception 'GAGAL: viewer berhasil mengubah data lewat salah satu fungsi 0002';
  end if;
  raise notice 'OK   tidak satu pun data berubah oleh percobaan viewer';
end
$$;

-- ---------------------------------------------------------------------------
-- 18.8 seed_from_payload(): satu payload → SATU Batch 'seed' (PRD #23, ADR-008)
--      Payload kecil tulis-tangan berprefix UJI-SEED-. p_force => true karena
--      tabel Karyawan sudah berisi fixture seksi-seksi sebelumnya. Berjalan
--      sebagai superuser tanpa JWT (assert_admin lolos), seperti §18.2–18.6.
-- ---------------------------------------------------------------------------
do $$
declare
  v_payload jsonb := jsonb_build_object(
    'org_units', jsonb_build_array(
      jsonb_build_object('kode','UJI-SEED-DIR','nama','Direktorat Uji Seed','tipe','direktorat','parent',null),
      jsonb_build_object('kode','UJI-SEED-DIV','nama','Divisi Uji Seed','tipe','divisi','parent',0)
    ),
    'jabatan', jsonb_build_array(
      jsonb_build_object('kode','UJI-SEED-JB','nama','Staf Uji Seed')
    ),
    'lookups', jsonb_build_array(
      jsonb_build_object('tipe','gender','kode','UJI-SEED-L','label','Uji Seed L','urutan',1),
      jsonb_build_object('tipe','job_grade','kode','UJI-SEED-JG1','label','Uji Seed JG 1','urutan',1)
    ),
    'employees', jsonb_build_array(
      jsonb_build_object(
        'personnel_number','UJI-SEED-0001','nip',null,'full_name','Karyawan Uji Seed Satu','status','aktif',
        'org',1,'jab',0,'lk',jsonb_build_object('gender',0,'job_grade',1),
        'text',jsonb_build_object('nomor_surat_pg','SK-UJI-1'),
        'dates',jsonb_build_object('original_start_date','2015-03-04'),
        'private',jsonb_build_object('date_of_birth','1990-01-01','place_of_birth','Kota Uji','religion',null,'marital_status',null)
      ),
      jsonb_build_object(
        'personnel_number','UJI-SEED-0002','nip','UJI-SEED-NIP2','full_name','Karyawan Uji Seed Dua','status','nonaktif',
        'org',0,'jab',null,'lk','{}'::jsonb,'text','{}'::jsonb,'dates','{}'::jsonb,'private',null
      )
    )
  );
  v_res    jsonb;
  v_batch  uuid;
  v_before integer;
  v_n      integer;
  v_emp    uuid;
  v_dir    uuid;
  v_div    uuid;
begin
  select count(*) into v_before from public.batches where jenis = 'seed';

  v_res := public.seed_from_payload(v_payload, 'Uji seed lewat web', true);
  v_batch := (v_res ->> 'batch_id')::uuid;

  if (v_res ->> 'org_units')::int <> 2 or (v_res ->> 'jabatan')::int <> 1
     or (v_res ->> 'lookups')::int <> 2 or (v_res ->> 'employees')::int <> 2
     or (v_res ->> 'data_pribadi')::int <> 1 then
    raise exception 'GAGAL: hasil seed_from_payload tidak sesuai: %', v_res;
  end if;

  select count(*) into v_n from public.batches where jenis = 'seed';
  if v_n <> v_before + 1 then
    raise exception 'GAGAL: satu seed menghasilkan % Batch seed baru (harus 1)', v_n - v_before;
  end if;
  if (select keterangan from public.batches where id = v_batch) <> 'Uji seed lewat web' then
    raise exception 'GAGAL: keterangan Batch seed tidak tersimpan';
  end if;

  -- index → id: induk unit, unit/jabatan/lookup Karyawan
  select id into v_dir from public.org_units where kode = 'UJI-SEED-DIR';
  select id into v_div from public.org_units where kode = 'UJI-SEED-DIV';
  if (select parent_id from public.org_units where id = v_div) is distinct from v_dir then
    raise exception 'GAGAL: induk Unit Organisasi tidak terpetakan dari index';
  end if;
  select id into v_emp from public.employees where personnel_number = 'UJI-SEED-0001';
  if (select org_unit_id from public.employees where id = v_emp) is distinct from v_div then
    raise exception 'GAGAL: org_unit_id Karyawan tidak terpetakan dari index';
  end if;
  if (select jabatan_id from public.employees where id = v_emp)
     is distinct from (select id from public.jabatan where kode = 'UJI-SEED-JB') then
    raise exception 'GAGAL: jabatan_id Karyawan tidak terpetakan dari index';
  end if;
  if (select gender_id from public.employees where id = v_emp)
     is distinct from (select id from public.lookups where tipe = 'gender' and kode = 'UJI-SEED-L') then
    raise exception 'GAGAL: gender_id Karyawan tidak terpetakan dari index';
  end if;
  if (select job_grade_id from public.employees where id = v_emp)
     is distinct from (select id from public.lookups where tipe = 'job_grade' and kode = 'UJI-SEED-JG1') then
    raise exception 'GAGAL: job_grade_id Karyawan tidak terpetakan dari index';
  end if;
  if (select nomor_surat_pg from public.employees where id = v_emp) <> 'SK-UJI-1'
     or (select original_start_date from public.employees where id = v_emp) <> date '2015-03-04' then
    raise exception 'GAGAL: kolom teks/tanggal Karyawan tidak tersimpan';
  end if;
  if (select status from public.employees where personnel_number = 'UJI-SEED-0002') <> 'nonaktif'
     or (select org_unit_id from public.employees where personnel_number = 'UJI-SEED-0002') is distinct from v_dir then
    raise exception 'GAGAL: Karyawan kedua (nonaktif, unit index 0) tidak tersimpan benar';
  end if;

  -- Data Pribadi Sensitif di-UPDATE ke baris buatan trigger zz_autocreate_private
  if (select date_of_birth from public.employee_private where employee_id = v_emp) is distinct from date '1990-01-01'
     or (select place_of_birth from public.employee_private where employee_id = v_emp) is distinct from 'Kota Uji' then
    raise exception 'GAGAL: Data Pribadi Sensitif tidak terisi lewat seed';
  end if;

  -- Semua Revisi di satu Batch: 2 unit + 1 jabatan + 2 lookup + 2 Karyawan
  -- + 2 insert employee_private otomatis + 1 update employee_private = 10.
  select count(*) into v_n from public.revisions where batch_id = v_batch;
  if v_n <> 10 then
    raise exception 'GAGAL: Batch seed memuat % Revisi (harus 10)', v_n;
  end if;
  if (v_res ->> 'revisions')::int <> 10 then
    raise exception 'GAGAL: hasil melaporkan % Revisi (harus 10)', v_res ->> 'revisions';
  end if;

  raise notice 'OK   seed_from_payload: satu Batch seed, 10 Revisi, index → id terpetakan, Data Pribadi terisi';
end
$$;

-- 18.8.b Tabel Karyawan berisi + tanpa p_force → 55000, tanpa Batch tersisa
do $$
declare
  v_before integer;
  v_n      integer;
  v_min    jsonb := jsonb_build_object(
    'org_units', '[]'::jsonb, 'jabatan', '[]'::jsonb, 'lookups', '[]'::jsonb,
    'employees', jsonb_build_array(jsonb_build_object(
      'personnel_number','UJI-SEED-X','nip',null,'full_name','X','status','aktif',
      'org',null,'jab',null,'lk','{}'::jsonb,'text','{}'::jsonb,'dates','{}'::jsonb,'private',null))
  );
begin
  select count(*) into v_before from public.batches;
  begin
    perform public.seed_from_payload(v_min, null, false);
    raise exception 'GAGAL: seed tanpa p_force diterima padahal tabel Karyawan sudah berisi';
  exception
    when object_not_in_prerequisite_state then null;
  end;
  select count(*) into v_n from public.batches;
  if v_n <> v_before then
    raise exception 'GAGAL: penolakan seed (55000) meninggalkan Batch';
  end if;
  raise notice 'OK   seed_from_payload menolak (55000) ketika tabel Karyawan sudah berisi, tanpa Batch tersisa';
end
$$;

-- 18.8.c Payload tanpa Karyawan / tidak berbentuk → 22023, tanpa Batch
do $$
declare
  v_before integer;
  v_n      integer;
begin
  select count(*) into v_before from public.batches;
  begin
    perform public.seed_from_payload(
      jsonb_build_object('org_units','[]'::jsonb,'jabatan','[]'::jsonb,'lookups','[]'::jsonb,'employees','[]'::jsonb),
      null, true);
    raise exception 'GAGAL: payload tanpa Karyawan diterima';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    perform public.seed_from_payload('{"employees": 1}'::jsonb, null, true);
    raise exception 'GAGAL: payload tidak berbentuk diterima';
  exception
    when invalid_parameter_value then null;
  end;
  select count(*) into v_n from public.batches;
  if v_n <> v_before then
    raise exception 'GAGAL: penolakan payload cacat (22023) meninggalkan Batch';
  end if;
  raise notice 'OK   seed_from_payload menolak payload kosong/cacat (22023) sebelum membuka Batch';
end
$$;

-- 18.8.d Tipe Lookup di luar CHECK → 23514 dari database, dan SELURUH seed
--        batal termasuk baris Batch-nya (satu statement = satu transaksi)
do $$
declare
  v_before integer;
  v_n      integer;
  v_bad    jsonb := jsonb_build_object(
    'org_units', '[]'::jsonb, 'jabatan', '[]'::jsonb,
    'lookups', jsonb_build_array(jsonb_build_object('tipe','warna_favorit','kode','UJI-SEED-BAD','label','Biru','urutan',1)),
    'employees', jsonb_build_array(jsonb_build_object(
      'personnel_number','UJI-SEED-BAD','nip',null,'full_name','Bad','status','aktif',
      'org',null,'jab',null,'lk','{}'::jsonb,'text','{}'::jsonb,'dates','{}'::jsonb,'private',null))
  );
begin
  select count(*) into v_before from public.batches;
  begin
    perform public.seed_from_payload(v_bad, 'Uji seed gagal', true);
    raise exception 'GAGAL: Lookup bertipe di luar CHECK diterima';
  exception
    when check_violation then null;
  end;
  select count(*) into v_n from public.batches;
  if v_n <> v_before then
    raise exception 'GAGAL: seed yang gagal di tengah meninggalkan Batch';
  end if;
  if exists (select 1 from public.employees where personnel_number = 'UJI-SEED-BAD') then
    raise exception 'GAGAL: seed yang gagal di tengah meninggalkan Karyawan';
  end if;
  raise notice 'OK   seed yang gagal di tengah (23514) tidak meninggalkan apa pun, termasuk Batch-nya';
end
$$;

-- 18.8.e Viewer → 42501, sebelum apa pun disentuh
set request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$
declare
  v_min jsonb := jsonb_build_object(
    'org_units', '[]'::jsonb, 'jabatan', '[]'::jsonb, 'lookups', '[]'::jsonb,
    'employees', jsonb_build_array(jsonb_build_object(
      'personnel_number','UJI-SEED-V','nip',null,'full_name','V','status','aktif',
      'org',null,'jab',null,'lk','{}'::jsonb,'text','{}'::jsonb,'dates','{}'::jsonb,'private',null))
  );
begin
  begin
    perform public.seed_from_payload(v_min, null, true);
    raise exception 'GAGAL: viewer bisa menjalankan seed_from_payload()';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'OK   viewer ditolak seed_from_payload() dengan 42501';
end
$$;
reset role;
reset request.jwt.claims;

-- ===========================================================================
-- 19. Tindakan satu-statement menghasilkan TEPAT SATU Batch (ADR-006)
--
-- Inti keputusan ADR-006 bagian kedua: Server Action untuk tindakan satu
-- statement TIDAK membuka Batch sendiri. Batch yang dibuka dari TypeScript
-- selalu kosong — `begin_batch` dan UPDATE-nya adalah dua request PostgREST,
-- jadi dua transaksi, dan `app.batch_id` sudah hilang saat UPDATE tiba. Yang
-- jadi catatan tindakan itu adalah Batch `edit` otomatis dari trigger, yang
-- benar-benar memuat Revisi-nya.
--
-- Yang bisa dibuktikan dari sisi database ada dua, dan keduanya di bawah:
-- (19.1) satu UPDATE telanjang menghasilkan tepat satu Batch yang memuat
-- Revisi-nya, dan (19.2) tidak ada satu pun Batch kosong yang tertinggal —
-- gejala yang pasti muncul kalau ada yang membuka Batch dari kode lagi.
-- Sisi TypeScript-nya dijaga `tests/batchDiscipline.test.ts`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 19.1 Satu UPDATE tanpa Batch eksplisit -> satu Batch, dan Batch itu berisi
--      Revisi-nya (bukan satu Batch bernama yang kosong + satu Batch yatim)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id       uuid;
  v_sebelum  integer;
  v_sesudah  integer;
  v_batches  uuid[];
  v_batch    public.batches%rowtype;
  v_n        integer;
begin
  insert into public.jabatan (kode, nama)
  values ('UJI-1STMT', 'Jabatan Uji Satu Statement')
  returning id into v_id;

  -- Tiru persis apa yang dilakukan Server Action sekarang: satu UPDATE, tanpa
  -- begin_batch sama sekali (lib/actions/_reference.ts langkah 5).
  perform set_config('app.batch_id', '', true);
  select count(*) into v_sebelum from public.batches;

  update public.jabatan set nama = 'Jabatan Uji Satu Statement (baru)'
   where id = v_id;

  select count(*) into v_sesudah from public.batches;
  if v_sesudah <> v_sebelum + 1 then
    raise exception
      'GAGAL: satu UPDATE tanpa Batch eksplisit menghasilkan % Batch (harus tepat 1)',
      v_sesudah - v_sebelum;
  end if;

  -- Batch yang baru itu harus memuat Revisi-nya.
  select array_agg(distinct r.batch_id) into v_batches
  from public.revisions r
  where r.table_name = 'jabatan' and r.row_id = v_id and r.action = 'update';

  if coalesce(array_length(v_batches, 1), 0) <> 1 then
    raise exception 'GAGAL: Revisi rename tersebar di % Batch (harus 1)',
      coalesce(array_length(v_batches, 1), 0);
  end if;

  select * into v_batch from public.batches where id = v_batches[1];
  if v_batch.jenis <> 'edit' then
    raise exception 'GAGAL: Batch otomatis berjenis "%" (harus "edit")', v_batch.jenis;
  end if;

  select count(*) into v_n from public.revisions where batch_id = v_batch.id;
  if v_n <> 1 then
    raise exception 'GAGAL: Batch tindakan ini memuat % Revisi (harus 1)', v_n;
  end if;

  -- Sejak ADR-006 baris inilah yang paling sering muncul di halaman Log
  -- Perubahan, jadi keterangannya dibaca staf HC — bukan developer yang sedang
  -- mencari batch id yang hilang.
  if v_batch.keterangan is null then
    raise exception 'GAGAL: Batch otomatis tidak punya keterangan sama sekali';
  end if;

  raise notice
    'OK   tindakan satu-statement -> tepat 1 Batch "edit" berisi Revisi-nya ("%")',
    v_batch.keterangan;
end
$$;

-- ---------------------------------------------------------------------------
-- 19.2 TIDAK ADA Batch kosong di seluruh database
--
-- Satu Batch tanpa Revisi berarti ada yang membuka Batch dari TypeScript lagi
-- — persis cacat yang ADR-006 tutup. Batch `merge` dan `revert` pun selalu
-- berisi, karena fungsinya menolak rencana nol langkah sebelum membuka Batch.
-- ---------------------------------------------------------------------------
do $$
declare
  v_kosong integer;
  v_contoh text;
begin
  select count(*) into v_kosong
  from public.batches b
  where not exists (select 1 from public.revisions r where r.batch_id = b.id);

  if v_kosong > 0 then
    select string_agg(
             format('%s/%s', b.jenis, coalesce(b.keterangan, '(tanpa keterangan)')),
             '; ')
      into v_contoh
    from public.batches b
    where not exists (select 1 from public.revisions r where r.batch_id = b.id);

    raise exception
      'GAGAL: ada % Batch tanpa satu pun Revisi — Batch yang dibuka dari kode selalu kosong (ADR-006): %',
      v_kosong, v_contoh;
  end if;

  raise notice 'OK   tidak ada satu pun Batch kosong di seluruh database';
end
$$;

-- ---------------------------------------------------------------------------
-- 19.3 Tidak ada keterangan Batch yang menyebut istilah internal
--      (halaman Log Perubahan dibaca staf HC, bukan developer)
-- ---------------------------------------------------------------------------
do $$
declare
  v_buruk text;
begin
  select string_agg(distinct b.keterangan, '; ') into v_buruk
  from public.batches b
  where b.keterangan ~* '(trigger|log_revision|app\.batch_id|withBatch)';

  if v_buruk is not null then
    raise exception
      'GAGAL: keterangan Batch menyebut istilah internal, padahal dibaca staf HC di halaman Log Perubahan: %',
      v_buruk;
  end if;

  raise notice 'OK   tidak ada keterangan Batch yang menyebut istilah internal';
end
$$;

-- ---------------------------------------------------------------------------
-- 20. Policy RLS memanggil fungsi penjaganya sebagai InitPlan, bukan per baris
--
-- `is_admin()` dan `current_actor_id()` SECURITY DEFINER, dan planner tidak
-- pernah meng-inline fungsi SECURITY DEFINER: dipanggil telanjang di sebuah
-- policy, keduanya dievaluasi sekali per baris (masing-masing dengan lookup
-- `profiles` sendiri). Ditulis `(select public.is_admin())` keduanya menjadi
-- InitPlan yang dievaluasi sekali per query. Diukur di harness ini atas Batch
-- seed 6.000 Revisi: count(*) turun dari ~100 ms menjadi ~4 ms.
--
-- Dibaca dari katalog, bukan dari teks migration: pg_policies men-deparse
-- bentuk subquery-nya sebagai `( SELECT is_admin() AS is_admin)`. Setelah
-- potongan itu dibuang, tidak boleh tersisa satu pun pemanggilan telanjang.
-- ---------------------------------------------------------------------------
do $$
declare
  v_telanjang text;
begin
  select string_agg(format('%s.%s', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname)
    into v_telanjang
  from pg_policies p
  where p.schemaname = 'public'
    and regexp_replace(
          coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
          '\( SELECT (is_admin|current_actor_id)\(\) AS (is_admin|current_actor_id)\)',
          '', 'g'
        ) ~ '\m(is_admin|current_actor_id)\(\)';

  if v_telanjang is not null then
    raise exception
      'GAGAL: policy memanggil is_admin()/current_actor_id() telanjang (dievaluasi per baris) — tulis sebagai (select public.is_admin()): %',
      v_telanjang;
  end if;

  raise notice 'OK   semua policy RLS memakai (select is_admin()) / (select current_actor_id()) — InitPlan, bukan per baris';
end
$$;

-- 20.1 Index pada FK yang difilter halaman Log Perubahan (`?status=belum|sudah`).
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'batches' and indexname = 'batches_reverted_by_idx'
  ) then
    raise exception 'GAGAL: index batches_reverted_by_idx tidak ada';
  end if;
  raise notice 'OK   batches (reverted_by_batch_id) ber-index';
end
$$;

\echo ''
\echo '================ SEMUA ASSERTION LULUS ================'
\echo ''
