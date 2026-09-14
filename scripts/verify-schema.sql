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
  if v_n <> 57 then
    raise exception
      'GAGAL: v_employees_api punya % kolom, bukan 57. Kalau perubahan ini memang disengaja, perbarui API-CONTRACT.md, lalu angka 57 di scripts/verify-schema.sql §15.',
      v_n;
  end if;

  raise notice 'OK   v_employees_api = 57 kolom, tanpa Data Pribadi Sensitif';
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

\echo ''
\echo '================ SEMUA ASSERTION LULUS ================'
\echo ''
