# ARCHITECTURE — HC Core

## 1. Stack

| Lapisan | Pilihan | Alasan / rujukan |
|---|---|---|
| Framework | Next.js 15 (App Router, TypeScript) | ADR-001 |
| Database & Auth | Supabase (Postgres 15 + Supabase Auth + RLS) | ADR-001; Supabase dianggap sementara, skema harus portable ke Postgres biasa |
| Hosting | Vercel | ADR-001 |
| UI | Tailwind CSS + shadcn/ui | komponen tabel/form/dialog siap pakai, cepat dibangun |
| Tabel & form | TanStack Table + react-hook-form + zod | pencarian/filter di tabel besar, validasi satu skema untuk client & server |
| Excel (seed) | SheetJS (`xlsx`) di skrip Node **dan** di peramban admin (halaman Seed, `import()` dinamis) | hanya untuk seed awal; tidak pernah dijalankan di server (ADR-008) |
| API eksternal | Next.js Route Handlers di `app/api/v1/` | ADR-004 |

Tidak ada ORM. Akses database memakai `@supabase/supabase-js` dan SQL migration polos di `supabase/migrations/`.

## 2. Struktur Folder

```
hc-core/
├── app/                             # HANYA file konvensi Next + _components/ + _lib/ per route
│   ├── (auth)/login/                # halaman login (Supabase Auth, email kantor); _components/LoginForm
│   ├── (app)/                       # semua halaman internal; layout dengan sidebar
│   │   ├── _lib/                    # helper sisi server yang dipakai banyak page (riwayat.ts, bacaAman.ts)
│   │   ├── karyawan/                # daftar + filter (_components/)
│   │   │   ├── baru/                # form tambah
│   │   │   ├── seed/                # Seed awal lewat web (PRD #23): wizard di _components/
│   │   │   └── [id]/                # detail + form edit + riwayat revisi
│   │   ├── struktur/                # pohon unit organisasi + CRUD + merge (_lib/strukturData)
│   │   │   └── [id]/                # detail unit + riwayat revisi (baca saja)
│   │   ├── jabatan/                 # daftar jabatan + CRUD + merge (_components/)
│   │   │   └── [id]/                # detail jabatan + riwayat revisi (baca saja)
│   │   ├── master-data/             # lookups, satu tab per tipe (_components/)
│   │   │   └── [id]/                # detail lookup + riwayat revisi (baca saja)
│   │   ├── bereskan/                # halaman "Perlu Dibereskan" (_components/, _lib/data)
│   │   ├── log/                     # log global per batch + revert batch (_components/)
│   │   ├── api-keys/                # kelola konsumen & whitelist kolom (_components/)
│   │   └── pengguna/                # set role admin/viewer (admin only) (_components/)
│   └── api/v1/                      # REST untuk konsumen (Route Handlers); logika di _lib/
│       ├── employees/route.ts
│       ├── employees/[personnelNumber]/route.ts
│       ├── org-units/route.ts
│       ├── jabatan/route.ts
│       └── lookups/route.ts
├── components/                      # komponen UI reusable (DataTable, EntityPicker, RevisionPanel, MergeDialog, DaftarTerpotongAlert, SignOutButton)
├── lib/
│   ├── supabase/                    # server.ts (server, cookie session), admin.ts (service role — HANYA untuk api/v1 & seed). Tidak ada browser client: Client Component membaca lewat Server Action
│   ├── db/                          # lapisan baca, satu file per entitas: employees.ts, orgUnits.ts, jabatan.ts, lookups.ts, revisions.ts, apiKeys.ts, profiles.ts, labels.ts, referenceOptions.ts
│   ├── actions/                     # SEMUA Server Action, termasuk auth.ts (login) dan bereskan.ts; SATU-SATUNYA jalur tulis dari UI. _guard.ts (sesi), errors.ts, result.ts, pgErrors.ts (mapDbError)
│   ├── revisions/                   # batch.ts (label Batch + kenapa tidak ada withBatch), revert.ts (revert revisi & batch), references.ts (tipe rujukan), seedBatch.ts (transaksi seed via pg — script saja)
│   ├── cleaning/                    # normalize.ts, findSimilar.ts, findOrphans.ts
│   ├── api/                         # auth.ts (validasi key), fields.ts (whitelist), response.ts (envelope)
│   ├── derived/                     # perhitungan usia, masa kerja (dipakai view & UI)
│   ├── validation/                  # skema zod per entitas; uuid.ts (satu regex uuid)
│   ├── seed/                        # excelMapping.ts (murni; dipakai skrip CLI + halaman Seed), payload.ts (kontrak RPC seed_from_payload), ringkasan.ts (angka pratinjau)
│   └── entityOptions.ts             # baris → opsi EntityPicker (murni; server boleh memanggil)
├── scripts/
│   └── seed-from-excel.ts           # seed awal lewat skrip (alternatif orang teknis), dijalankan sekali
├── supabase/
│   └── migrations/                  # SQL migration bernomor; sumber kebenaran skema
├── docs/adr/
├── CONTEXT.md
├── PRD.md · ARCHITECTURE.md · API-CONTRACT.md · ROADMAP.md · CLAUDE.md
```

## 3. Data Model

Semua tabel di schema `public`. Semua primary key `uuid default gen_random_uuid()`. Semua tabel punya `created_at`, `updated_at` (trigger). Tidak ada `DELETE` pada tabel data di fase 1 — status `nonaktif` menggantikannya.

### `employees` — Karyawan
| Kolom | Tipe | Catatan |
|---|---|---|
| id | uuid PK | dipakai sebagai FK oleh tabel lain & aplikasi konsumen |
| personnel_number | text UNIQUE NOT NULL | **business key**, dipakai konsumen di API |
| nip | text UNIQUE | |
| full_name | text NOT NULL | |
| org_unit_id | uuid FK → org_units | unit **terendah** tempat ditempatkan; direktorat/divisi/bagian diturunkan dari hierarki |
| jabatan_id | uuid FK → jabatan | |
| gender_id, work_contract_id, person_grade_id, job_grade_id, legal_entity_id, klasifikasi_rekrutmen_id, teknik_non_teknik_id, bod_range_id, band_jabatan_id, kategori_penempatan_id, kategori_fungsi_id | uuid FK → lookups | tiap kolom dibatasi CHECK ke `lookups.tipe` yang sesuai lewat trigger validasi |
| keterangan_pj_plt, keterangan_rangkap_1, keterangan_rangkap_2, keterangan, jurusan | text | teks bebas sesuai Excel |
| original_start_date, tanggal_diangkat, tanggal_promosi_pg, tanggal_promosi_jg, tanggal_keluar | date | |
| nomor_surat_pg, nomor_surat_jg | text | |
| status | text CHECK IN ('aktif','nonaktif') default 'aktif' | |

Index: `(status)`, `(org_unit_id)`, `(jabatan_id)`, `lower(full_name)` (trigram opsional), `personnel_number`, `nip`.

### `employee_private` — data sensitif (PRD #22)
| Kolom | Tipe |
|---|---|
| employee_id | uuid PK, FK → employees |
| date_of_birth | date NULL |
| place_of_birth | text NULL |
| religion | text NULL |
| marital_status | text NULL |

Satu baris per karyawan dibuat otomatis (trigger) saat karyawan dibuat, semua kolom NULL. RLS: hanya `admin`. **Tidak pernah** di-select oleh `lib/api/`.

### `org_units` — Unit Organisasi
| Kolom | Tipe | Catatan |
|---|---|---|
| id | uuid PK | |
| kode | text UNIQUE NOT NULL | stabil, tidak diubah setelah dibuat |
| nama | text NOT NULL | boleh diganti; rename otomatis berlaku ke semua karyawan |
| tipe | text CHECK IN ('direktorat','divisi','departemen','bagian','sub_bagian','proyek') | |
| parent_id | uuid FK → org_units NULL | NULL hanya boleh untuk `direktorat` (dicek di halaman Bereskan, bukan constraint, agar seed data kotor tetap bisa masuk) |
| status | 'aktif' / 'nonaktif' | |
| merged_into_id | uuid FK → org_units NULL | diisi saat di-merge |

Constraint: tidak boleh siklus (trigger cek ancestor). Index `(parent_id)`, `(tipe)`.

### `jabatan` — Jabatan
`id`, `kode` UNIQUE, `nama`, `status`, `merged_into_id`. Jabatan adalah *nama pekerjaan* yang bisa dipegang banyak orang, bukan kursi (ADR-002).

### `lookups` — Daftar pilihan
| Kolom | Tipe |
|---|---|
| id | uuid PK |
| tipe | text NOT NULL — salah satu: `gender`, `work_contract`, `person_grade`, `job_grade`, `legal_entity`, `klasifikasi_rekrutmen`, `teknik_non_teknik`, `bod_range`, `band_jabatan`, `kategori_penempatan`, `kategori_fungsi` |
| kode | text NOT NULL |
| label | text NOT NULL |
| urutan | int |
| status, merged_into_id | seperti di atas |

UNIQUE `(tipe, kode)`. Daftar `tipe` yang sah didefinisikan di `lib/validation/lookupTypes.ts` **dan** di CHECK constraint migration — keduanya harus sama.

### `batches` — Batch perubahan
| Kolom | Tipe | Catatan |
|---|---|---|
| id | uuid PK | |
| jenis | text CHECK IN ('edit','create','deactivate','merge','rename','seed','revert') | |
| keterangan | text | mis. "Merge Divisi QHSSE → Divisi QHSSE (baru)" |
| actor_id | uuid FK → auth.users NULL | NULL untuk seed via script |
| reverted_by_batch_id | uuid FK → batches NULL | diisi kalau batch ini sudah dibalikkan |
| created_at | timestamptz | |

### `revisions` — Revisi (satu baris per perubahan satu baris tabel)
| Kolom | Tipe |
|---|---|
| id | bigserial PK |
| batch_id | uuid FK → batches NOT NULL |
| table_name | text NOT NULL |
| row_id | uuid NOT NULL |
| action | text CHECK IN ('insert','update') |
| before | jsonb NULL (NULL untuk insert) |
| after | jsonb NOT NULL |
| actor_id | uuid NULL |
| created_at | timestamptz |

Diisi **oleh trigger `AFTER INSERT OR UPDATE`** pada **tujuh** tabel — `employees`, `employee_private`, `org_units`, `jabatan`, `lookups`, `api_keys`, `profiles` — bukan oleh kode aplikasi (ADR-003). Trigger membaca `current_setting('app.batch_id', true)`; kalau kosong, trigger membuat batch baru berjenis `edit` otomatis, sehingga tidak ada perubahan yang lolos tanpa log. Index `(table_name, row_id, id desc)`, `(batch_id)`.

> **Tujuh tabel ter-log vs enam tabel data.** Daftar tabel yang di-log sengaja satu lebih panjang daripada daftar tabel yang dilarang di-`DELETE`. `profiles` ikut di-log karena kenaikan hak akses (viewer → admin) adalah perubahan yang paling layak diaudit di sistem HR, dan PRD #13 berbunyi "setiap perubahan pada tabel mana pun". Tapi `profiles` **tidak** dipasangi guard DELETE, karena barisnya menggantung pada `auth.users` dengan `ON DELETE CASCADE` dan siklus hidupnya dipegang Supabase Auth. Jangan menyamakan kedua daftar itu.

Siapa boleh membaca satu baris `revisions` mengikuti siapa boleh membaca baris yang diceritakannya, supaya log tidak jadi pintu belakang: revisi `employee_private` dan `api_keys` hanya admin; revisi `profiles` hanya admin atau pemilik profil itu sendiri; sisanya boleh dibaca semua yang login.

### `api_keys` — Konsumen
| Kolom | Tipe | Catatan |
|---|---|---|
| id | uuid PK | |
| nama_konsumen | text NOT NULL | mis. "Perf App" |
| key_prefix | text | 8 karakter pertama untuk ditampilkan |
| key_hash | text UNIQUE | SHA-256 dari key penuh; key penuh hanya ditampilkan sekali saat dibuat |
| allowed_fields | text[] NOT NULL | subset dari kolom `v_employees_api` |
| status | 'aktif' / 'nonaktif' | |
| last_used_at | timestamptz | |

### `profiles` — Pengguna aplikasi
`id` uuid PK = `auth.users.id`, `email`, `role` CHECK IN ('admin','viewer') default 'viewer'. Dibuat otomatis oleh trigger saat user pertama kali login.

Ikut dipasangi trigger `log_revision`, jadi setiap pembuatan profil dan setiap perubahan `role` muncul di halaman Log Perubahan dan bisa di-revert. Tidak dipasangi guard DELETE (cascade dari `auth.users`).

### Views
- **`v_employees`** — karyawan + nama unit terendah + `direktorat_nama`, `divisi_nama`, `departemen_nama`, `bagian_nama`, `sub_bagian_nama`, `proyek_nama` (dari recursive CTE ke atas) + label semua lookup + `jabatan_nama` + turunan: `masa_kerja_tahun`, `masa_kerja_bulan`, `masa_sejak_diangkat_*`, `masa_pg_tahun`, `masa_jg_tahun`. Dipakai halaman daftar & detail.
- **`v_employees_private`** — `v_employees` + kolom `employee_private` + `usia`. Hanya admin (RLS pada tabel dasar tetap berlaku karena view `security_invoker = true`).
- **`v_employees_api`** — subset `v_employees` yang boleh keluar lewat API (semua kolom kecuali yang berasal dari `employee_private`). Daftar kolomnya = semesta `allowed_fields`.

Semua view dibuat dengan `security_invoker = true` agar RLS tabel dasar tetap berlaku.

## 4. Data Flow Utama

### A. Admin mengedit satu karyawan
1. Form di `app/(app)/karyawan/[id]` submit → Server Action `lib/actions/employees.ts:updateEmployee`.
2. Server Action memvalidasi input dengan zod (`lib/validation/employee.ts`), `requireAdmin()`, lalu membaca baris yang sekarang.
3. Server Action menjalankan **satu** `UPDATE employees` via session user (RLS admin) — **tanpa membuka Batch sendiri**.
4. Trigger `log_revision` melihat `app.batch_id` kosong, membuat satu Batch `edit`, dan menulis baris `revisions` dengan `before`/`after` ke dalamnya.
5. Revalidate path; halaman detail menampilkan revisi baru di daftar riwayat.

Kenapa tidak ada Batch yang dibuka dari kode: `begin_batch` dan `UPDATE` adalah
**dua request PostgREST**, jadi dua transaksi. `app.batch_id` ber-scope
transaksi (ADR-005 §9, dan scope sesi ditolak karena bocor lewat koneksi
pooled), sehingga Batch yang dibuka di request pertama sudah hilang saat
`UPDATE` tiba di request kedua — Batch itu akan nongkrong di `/log` tanpa isi
apa pun. Dengan membiarkan Batch otomatis trigger menjadi catatannya, `/log`
menampilkan **tepat satu** baris per tindakan, dan baris itu benar-benar memuat
Revisi-nya (ADR-006).

Harganya: satu edit biasa tidak punya `keterangan` per tindakan, dan `jenis`-nya
selalu `edit` (`create`/`deactivate`/`rename` kini hanya ditulis fungsi RPC).
Yang ditanyakan PRD tetap utuh — siapa, kapan, apa yang berubah, dan bisa
dikembalikan: `revisions.action` memisahkan insert dari update, `before`/`after`
menunjukkan kolom mana yang bergerak (termasuk perubahan `status`), dan setiap
Revisi tetap bisa dikembalikan satu per satu (PRD #15).

Tindakan yang menulis banyak baris tidak boleh dibangun seperti ini — lihat
§4B, §4C dan ADR-006.

### B. Merge dua unit organisasi

Merge adalah tiga `UPDATE` di dua tabel, dan lewat PostgREST tiga statement =
tiga request = tiga transaksi = tiga Batch. Karena itu seluruh Merge dikerjakan
**satu fungsi Postgres**, bukan urutan panggilan dari TypeScript (ADR-006):
satu panggilan RPC = satu transaksi = satu `app.batch_id` = satu Batch.

1. Dialog merge di `app/(app)/struktur` (atau dari `bereskan`) → `lib/actions/merge.ts:mergeOrgUnit({ sourceId, targetId, keterangan })`.
2. Server Action memvalidasi input (zod), `requireAdmin()`, lalu memanggil RPC `merge_org_unit(p_source, p_target, p_keterangan)`.
3. Fungsi itu, dalam satu batch `merge`: menolak asal = tujuan, asal/tujuan yang sudah pernah di-merge, dan tujuan yang berada **di bawah** asal (akan membuat siklus); lalu `UPDATE employees SET org_unit_id = target WHERE org_unit_id = source`; `UPDATE org_units SET parent_id = target WHERE parent_id = source`; `UPDATE org_units SET status='nonaktif', merged_into_id=target WHERE id=source`.
4. Setiap baris yang berubah jadi satu revisi di batch yang sama — revert batch mengembalikan semuanya.

`merge_jabatan` dan `merge_lookup` berbentuk sama. Merge Lookup juga memindahkan
kolom `employees.<tipe>_id` yang cocok dengan `lookups.tipe`, lewat `CASE` atas
sebelas `UPDATE` **statis** (bukan SQL dinamis), dan menolak merge lintas tipe.

Ketiganya `SECURITY INVOKER` — berjalan sebagai pemanggil, jadi RLS tetap
berlaku — dengan `assert_admin()` sebagai statement pertama. Keduanya, bukan
salah satu.

### C. Revert

Alasannya sama seperti §4B: revert satu Batch bisa menyentuh ratusan baris, dan
lewat PostgREST setiap `UPDATE` akan berakhir di Batch otomatisnya sendiri. Jadi
penulisannya juga dikerjakan di dalam satu fungsi Postgres (ADR-006).
Keputusan **apa** yang ditulis tetap di TypeScript, murni dan teruji:
`lib/revisions/revert.ts:planRevert()` (ARCHITECTURE §1 — logika yang salah
diam-diam paling mahal).

- **Satu revisi (PRD #15):** `planRevert([revisi])` → `applyRevert(plan, client)` → RPC `apply_revert(p_plan)` → batch baru `revert` → `UPDATE <table_name> SET (kolom...) = before WHERE <pk> = row_id`. Kalau `before` NULL (insert), baris di-set `status='nonaktif'`, bukan dihapus — dan database menolak langkah `deactivate` yang mencoba menulis kolom lain.
- **Satu batch (PRD #16):** `revertBatch(batchId, client)` → RPC `revert_batch(p_batch_id, p_keterangan)` → mengunci batch itu, menolak yang sudah punya `reverted_by_batch_id`, menyusun rencananya di SQL (`revert_plan_for_batch`, aturan identik dengan `planRevert()`) **urut `revisions.id` menurun**, menerapkannya dalam satu batch `revert`, lalu mengisi `batches.reverted_by_batch_id`. Batch yang sudah di-revert tidak bisa di-revert lagi (tombolnya hilang; server juga menolak).

Urutan menurun itulah yang membuat revert sebuah Merge rapi: unit asal kembali
`aktif` **sebelum** anak-anaknya dikembalikan kepadanya, dan baris yang
tersentuh dua kali berakhir di `before` yang paling tua.

`apply_revert` memeriksa ulang setiap keputusan perencana — tabelnya salah satu
dari tujuh tabel ter-log, kolom kuncinya benar untuk tabel itu, langkah
`deactivate` hanya menulis `status = 'nonaktif'` — karena rencana datang sebagai
data, dan data tidak dipercaya.

### D. Konsumen menarik data
1. `GET /api/v1/employees?fields=personnel_number,full_name,divisi_nama&status=aktif` dengan header `Authorization: Bearer <key>`.
2. `lib/api/auth.ts` meng-hash key, mencari `api_keys` aktif, update `last_used_at`.
3. `lib/api/fields.ts` memotong `fields` ke `allowed_fields ∩ kolom v_employees_api`; kolom di luar itu → 403 dengan daftar kolom yang ditolak.
4. Query ke `v_employees_api` memakai **service-role client** (`lib/supabase/admin.ts`) — satu-satunya tempat service role dipakai di runtime.
5. Response envelope `{ data, meta: { page, per_page, total } }`.

### E. Seed awal dari Excel
1. Dua pintu, satu logika. Halaman `/karyawan/seed` (PRD #23, admin saja) atau `scripts/seed-from-excel.ts <file.xlsx>` membaca sheet "Demografi Karyawan - Posisi", header baris 4, mengabaikan kolom rumus — keduanya lewat `lib/seed/excelMapping.ts:planSeed()`, yang murni dan diuji. Di halaman web, Excel dibaca **di peramban admin** (SheetJS lewat `import()` dinamis); file tidak pernah diunggah ke server.
2. Rencana membuat `lookups`, `jabatan`, `org_units` dari nilai unik **apa adanya** (trim saja), hierarki: Business Unit → Divisi → Bagian → Sub Bagian; kalau Sub Bagian == Bagian, tidak dibuat node anak; Bagian yang diawali "Proyek" bertipe `proyek`.
3. Pratinjau (`--dry-run` di skrip, langkah kedua wizard di web) menampilkan angka yang sama: yang akan dibuat, kolom tidak dikenal, Peringatan, error. Ada error → tidak ada yang ditulis.
4. Penulisan: `employees` + `employee_private` (DOB/tempat lahir/agama/status nikah masuk ke private) dalam **satu transaksi** = satu batch `seed` → bisa di-revert utuh kalau seed salah.

Bagaimana satu transaksi itu dipegang berbeda per pintu, dan itulah isi ADR-006 dan ADR-008:

- **Halaman web** mengirim `SeedPayload` (`lib/seed/payload.ts`: empat daftar, rujukan berupa index 0-based, ±1,0 MB untuk 1.500 Karyawan) ke Server Action `jalankanSeed()`, yang memvalidasinya dengan zod lalu memanggil **satu** RPC `seed_from_payload()` di `0002_batch_operations.sql`. Satu panggilan = satu transaksi = satu `app.batch_id` = satu Batch, persis pola merge/revert; gagal di tengah me-rollback semuanya termasuk baris `batches`-nya. `p_force` ada untuk test dan orang teknis, tidak pernah dikirim halaman.
- **Skrip** tidak memakai supabase-js. Ia memegang koneksinya sendiri lewat `pg` (devDependency) dan membuka satu transaksi sungguhan: `lib/revisions/seedBatch.ts:runSeedBatch()` → `BEGIN` → `begin_batch('seed', …, p_local => true)` → semua insert → `COMMIT`.

Keduanya menolak berjalan kalau `employees` sudah berisi (skrip: `--force`; fungsi: `p_force`), karena Seed memang sekali jalan (PRD §3).

## 5. Auth & Permission

Login: Supabase Auth email + password (atau magic link), dibatasi domain email kantor di trigger `on_auth_user_created`. Role di `profiles.role`. Pendaftaran sendiri **dimatikan** di dashboard Supabase (*Allow new users to sign up* off; README-HC §8a): akun dibuat lewat undangan admin, dan `handle_new_user()` tetap membuat baris `profiles` ber-role `viewer` untuk akun yang diundang.

| Kemampuan | admin | viewer | konsumen (API key) |
|---|---|---|---|
| Lihat daftar/detail karyawan | ✅ | ✅ | ✅ (kolom sesuai whitelist) |
| Lihat `employee_private` | ✅ | ❌ | ❌ selalu |
| Tambah/edit/nonaktifkan karyawan | ✅ | ❌ | ❌ |
| CRUD & merge unit/jabatan/lookup | ✅ | ❌ | ❌ |
| Lihat riwayat & log | ✅ | ✅ | ❌ |
| Revert revisi/batch | ✅ | ❌ | ❌ |
| Kelola API key & pengguna | ✅ | ❌ | ❌ |

Implementasi: RLS di setiap tabel (`select` untuk authenticated; `insert/update` hanya jika `profiles.role = 'admin'`; `employee_private` select+update admin saja; `api_keys` select admin saja; `profiles` select hanya baris sendiri atau admin). Server Action juga mengecek role sebelum menyentuh DB (defense in depth). Route `api/v1` **tidak** memakai session user; otentikasinya API key.

`revisions` ikut aturan yang sama: karena `revisions.after` adalah salinan utuh baris yang berubah, policy bacanya mencerminkan policy baca tabel asalnya (lihat §3). Tanpa itu, viewer bisa membaca Data Pribadi Sensitif, `key_hash`, dan email rekan kerja lewat log.

## 6. Aturan & Konvensi

- Semua tulisan ke database dari UI lewat Server Action di `lib/actions/`; tidak ada `supabase.from(...).insert/update` di Client Component.
- Satu Server Action = **satu statement**, ditulis langsung; tidak ada Batch yang dibuka dari TypeScript. Trigger `log_revision` yang membuat Batch-nya, jadi Batch itu selalu berisi Revisi-nya (ADR-006).
- **Tindakan yang menyentuh lebih dari satu baris atau lebih dari satu tabel ditulis sebagai fungsi Postgres, bukan sebagai urutan panggilan supabase-js** (ADR-006). Satu panggilan RPC = satu transaksi = satu Batch; urutan panggilan lewat PostgREST = satu Batch per statement. Fungsi RPC membuka Batch-nya sendiri — jangan dibungkus apa pun.
- `batches.jenis` `create` / `deactivate` / `rename` hanya ditulis fungsi RPC; edit biasa selalu masuk Batch `edit` otomatis.
- Tidak ada `DELETE` ke tabel `employees`, `employee_private`, `org_units`, `jabatan`, `lookups`, `api_keys` — di kode maupun migration. Nonaktifkan dengan `status`.
- Service-role client (`lib/supabase/admin.ts`) hanya di-import oleh `app/api/v1/**` dan `scripts/**`.
- Semua perubahan skema lewat file di `supabase/migrations/`; tidak ada perubahan skema dari dashboard Supabase.
- Kolom referensi di `employees` selalu FK ke `org_units`/`jabatan`/`lookups`; tidak ada kolom teks bebas baru untuk hal yang punya daftar.
- Kolom turunan (usia, masa kerja) dihitung di view / `lib/derived/`, tidak pernah disimpan.
- Route API hanya membaca dari `v_employees_api`, `org_units`, `jabatan`, `lookups`; tidak pernah dari `employee_private` atau `v_employees_private`.
- Format error API seragam (lihat API-CONTRACT.md).
- Penamaan: tabel & kolom `snake_case` (campuran Indonesia/Inggris mengikuti nama asli kolom Excel); file TypeScript `camelCase.ts`; komponen `PascalCase.tsx`.
- Bahasa UI: Indonesia. Bahasa kode & komentar: Inggris seperlunya.
- Tidak ada data karyawan sungguhan di repo, fixture, atau test — pakai data dummy.

## 7. Yang Sengaja Tidak Di-handle

- Tidak ada rate limiting API di fase 1 (konsumen internal, jumlah kecil).
- Tidak ada riwayat posisi eksplisit (`valid_from/valid_to`) — histori dibaca dari `revisions`.
- Tidak ada soft-lock/concurrent-edit detection; edit terakhir menang, dan keduanya tercatat sebagai revisi.
- Tidak ada webhook/notifikasi ke konsumen saat data berubah — konsumen menarik saat butuh.
- Tidak ada pagination di UI pohon struktur (≈ ratusan node, cukup dimuat sekaligus).
- Tidak ada test end-to-end dan tidak ada test render (tanpa jsdom, ADR-005 §1). Yang diuji adalah logika murni — `vitest.config.ts` mengumpulkan setiap `*.test.ts` dari `app/**`, `lib/**`, `components/**`, `scripts/**`, `tests/**` — plus invarian yang bisa dibaca dari file (`tests/migrationInvariants.test.ts`, `tests/batchDiscipline.test.ts`, `tests/serverOnlyBoundary.test.ts`) dan perilaku skema terhadap PostgreSQL lokal (`scripts/verify-schema.sql`).
