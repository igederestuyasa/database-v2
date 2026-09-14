# ADR-006 — Satu tindakan = satu Batch: pekerjaan multi-baris pindah ke fungsi Postgres, dan tidak ada Batch yang dibuka dari TypeScript

Status: Diterima
Tanggal: 2026-09-14
Mengubah: ADR-005 §Terkunci (pembekuan satu file migration), ADR-003 (cara Batch dijamin utuh)

## Konteks

Empat dokumen menjanjikan hal yang sama:

- `CONTEXT.md` — **Batch**: "Sekumpulan Revisi yang terjadi karena **satu
  tindakan** (satu simpan, satu merge, satu seed, satu revert). Satuan yang bisa
  dibalikkan utuh."
- `PRD.md` #16 — "admin bisa membalikkan **satu batch utuh** (misalnya satu merge
  atau satu seed)".
- `ADR-003` — Batch adalah "satuan yang bisa dibalikkan utuh".
- `ROADMAP.md` Fase 3 — exit criteria: merge → "satu batch `merge` muncul di log
  → revert batch → keadaan kembali **persis**, termasuk status unit lama".

Skema tidak menepatinya. `begin_batch()` mengarahkan `app.batch_id` lewat
`set_config(..., p_local => true)`, dan `p_local => true` berarti **scope
transaksi**. Diuji langsung terhadap PostgreSQL 16:

```sql
select set_config('app.demo','X',true);    -- mengembalikan X
select current_setting('app.demo',true);   -- mengembalikan '' — sudah hilang
```

supabase-js bicara ke PostgREST lewat HTTP, jadi **setiap tulisan adalah request
tersendiri dan transaksi tersendiri**. Saat sebuah `UPDATE` tiba, `app.batch_id`
sudah hilang, dan trigger `log_revision` membuka Batch `edit` otomatisnya
sendiri. Hasil nyatanya: satu tindakan pengguna menghasilkan satu Batch
bernama-bagus yang **kosong** ditambah satu atau lebih Batch otomatis yatim.
Pengelompokan hanya dijamin **per statement**.

Akibatnya konkret:

- Edit biasa (satu `UPDATE`) = **dua** baris di Log Perubahan: satu Batch
  bernama-bagus yang kosong, dan satu Batch `edit` otomatis yang memuat
  Revisi-nya. Baris yang bisa dibaca bukan baris yang berisi.
- Merge = tiga `UPDATE` di dua tabel → **tiga** Batch (plus satu yang kosong).
  "Kembalikan Merge ini" akan membatalkan sepertiganya.
- Seed ±1.475 Karyawan → ±1.475 Batch. Exit criteria Fase 1 ("satu batch
  `seed`") tidak mungkin tercapai.
- Revert satu Batch = satu `UPDATE` per Revisi → satu Batch per Revisi, sehingga
  "revert dari revert" pun tidak bisa dilakukan utuh.

Ini bukan salah ketik di satu tempat; ini konsekuensi desain yang mengenai
setiap operasi multi-baris di aplikasi.

## Keputusan

Dua bagian, satu aturan: **Batch hanya dibuat di tempat yang benar-benar
memegang satu transaksi.**

### Bagian 1 — pekerjaan multi-baris pindah ke fungsi Postgres

**Setiap unit kerja yang lebih dari satu statement dipindahkan ke satu fungsi
Postgres.** Satu panggilan RPC = satu transaksi = satu `app.batch_id` = satu
Batch.

Untuk itu pembekuan "satu-satunya file migration" (ADR-005) **dibuka satu kali,
atas persetujuan eksplisit pemilik proyek**, untuk menambahkan
`supabase/migrations/0002_batch_operations.sql`. Setelah perubahan ini masuk,
`supabase/migrations/` beku lagi **pada dua file**; tidak ada `0003_*.sql`.
`tests/migrationInvariants.test.ts` gagal kalau ada file ketiga.

Isi `0002_batch_operations.sql`:

| Fungsi | Untuk |
|---|---|
| `assert_admin(p_aksi)` | gerbang admin di database, pasangan `requireAdmin()` |
| `merge_org_unit(p_source, p_target, p_keterangan)` | PRD #10, ARCHITECTURE §4B |
| `merge_jabatan(...)` / `merge_lookup(...)` | idem, per entitas |
| `apply_revert_operation(p_op)` | internal: satu langkah revert |
| `revert_skip_entry(...)` / `revert_plan_for_batch(p_batch_id)` | rencana revert satu Batch, versi SQL dari `planRevert()` |
| `apply_revert(p_plan)` | PRD #15 — menerapkan rencana dari `planRevert()` |
| `revert_batch(p_batch_id, p_keterangan)` | PRD #16 — membalikkan satu Batch utuh |

Sisi TypeScript menjadi tipis: `lib/actions/merge.ts` memvalidasi, menjaga role,
memanggil RPC, dan `revalidatePath()`; `lib/revisions/revert.ts:applyRevert()`
dan `revertBatch()` memanggil RPC dan menerjemahkan hasilnya. Tanda tangan
ekspornya tidak berubah sama sekali — tiga belas unit paralel sudah menulis kode
terhadapnya.

### Bagian 2 — tindakan satu-statement tidak membuka Batch sama sekali

**`withBatch()`, `beginBatch()` dan `endBatch()` dihapus.** Sebuah Server Action
untuk tindakan satu statement menjalankan `UPDATE`/`INSERT`-nya langsung, dan
**Batch `edit` otomatis dari trigger `log_revision` itulah catatan tindakan
tersebut**. Hasilnya: `/log` menampilkan **tepat satu** baris per tindakan, dan
baris itu benar-benar memuat Revisi-nya.

Versi pertama ADR ini membiarkan bagian ini apa adanya dan mendokumentasikannya
sebagai batas yang diterima. Pemilik proyek meninjau batas itu dan memutuskan
menutupnya: Batch kosong tidak pernah punya pembaca, dan membiarkan setiap
tindakan menghasilkan dua baris log — satu yang bisa dibaca dan satu yang berisi
— justru merusak halaman yang PRD #16 minta.

Yang hilang, dan diterima secara sadar:

- **`keterangan` per edit.** Tidak ada lagi kalimat "Ganti nama Jabatan: "A" →
  "B"" di tingkat Batch.
- **`jenis` yang spesifik.** `create`, `deactivate` dan `rename` sekarang
  **hanya** pernah ditulis oleh fungsi RPC di `0002_batch_operations.sql`; edit
  biasa selalu `edit`.

Yang tidak hilang, dan inilah alasan harganya pantas: `revisions.action` tetap
memisahkan `insert` dari `update`, `before`/`after` tetap menunjukkan kolom mana
yang bergerak (termasuk perubahan `status`, yang membuat "dinonaktifkan" tetap
terbaca), `actor_id` dan `created_at` tetap ada, dan setiap Revisi tetap bisa
dikembalikan satu per satu (PRD #15). PRD tidak pernah meminta deskripsi per
edit; ia meminta siapa, kapan, apa yang berubah, dan bisa dikembalikan —
keempatnya selamat.

Karena Batch `edit` otomatis sekarang menjadi **jalur normal**, bukan jalur
pengecualian, `keterangan`-nya di `0001_init.sql` diganti dari "Perubahan tanpa
batch eksplisit (dibuat otomatis oleh trigger log_revision)" menjadi "Perubahan
data": baris itu kini dibaca staf HC di halaman Log Perubahan, bukan oleh
developer yang sedang mencari batch id yang hilang.

Satu-satunya pemanggil `begin_batch` yang tersisa di TypeScript adalah
`lib/revisions/seedBatch.ts`, yang memegang koneksi dan transaksinya sendiri —
di sana batch id memang bertahan sampai `COMMIT`.

### Model keamanan: `SECURITY INVOKER` + `assert_admin()`, bukan `SECURITY DEFINER`

Semua fungsi di file itu `SECURITY INVOKER` (default), jadi berjalan **sebagai
pemanggil** dan RLS tetap berlaku di setiap statement — persis seolah `UPDATE`
yang sama tiba lewat PostgREST. Di atas itu setiap entry point memanggil
`assert_admin()` sebagai statement pertama, yang melempar `42501` untuk pengguna
login yang bukan admin.

Keduanya, bukan salah satu (CLAUDE.md: "Cek role di Server Action **dan** RLS —
keduanya"). Alasan memilih invoker:

- `SECURITY DEFINER` menjalankan **seluruh badan fungsi** dengan hak pemilik.
  Satu kesalahan sunting di kemudian hari — satu cabang yang lupa memeriksa role
  — langsung menjadi bug eskalasi hak yang RLS tidak lagi bisa tangkap. Dengan
  invoker, RLS adalah jaring pengaman yang selalu ada.
- Gerbang eksplisit tetap dibutuhkan meski RLS ada: policy `update ... using
  (is_admin())` menolak **diam-diam** (0 baris), dan Merge yang "berhasil" tanpa
  memindahkan siapa pun jauh lebih berbahaya daripada penolakan yang bisa
  dibaca. Fungsi-fungsi itu juga melempar kalau langkah wajibnya mengenai 0
  baris.
- `anon` tidak pernah diberi `EXECUTE`; `authenticated` diberi (viewer termasuk
  di dalamnya) dan ditolak `assert_admin()` dengan pesan Indonesia.

`begin_batch()`, `is_admin()` dan trigger `log_revision` tetap `SECURITY
DEFINER` seperti di `0001_init.sql` — itu memang perlu, dan tidak berubah.

### Satu transaksi juga berarti satu kunci

Karena sekarang seluruh Merge ada dalam satu transaksi, gerbang "sudah pernah
digabungkan" bisa dibuat benar-benar berlaku: ketiga fungsi merge mengunci baris
asal **dan** tujuan (`for update`, dalam urutan `id` yang tetap) sebelum
membacanya, dan `revert_batch` mengunci baris `batches`-nya sebelum memeriksa
`reverted_by_batch_id`. Tanpa itu, dua admin yang menekan tombol yang sama pada
detik yang sama sama-sama lolos gerbang; yang kedua memindahkan nol baris tapi
tetap menulis `merged_into_id` ke tujuan yang salah, sehingga Konsumen yang
mengikuti `merged_into_id` diarahkan ke unit yang keliru dan revert tidak lagi
mengembalikan keadaan persis. Urutan `id` yang tetap membuat dua Merge yang
saling menyilang gagal-deadlock (dan satu di-rollback utuh) alih-alih saling
menunggu selamanya.

### Tanpa SQL dinamis dari identifier pemanggil

`merge_lookup` harus memindahkan kolom `employees.<tipe>_id` yang cocok dengan
`lookups.tipe`. Itu dikerjakan dengan `CASE` atas **sebelas `UPDATE` statis**,
bukan `EXECUTE format(...)`. Cabang `else`-nya melempar, jadi tipe Lookup
kedua belas yang ditambahkan ke CHECK constraint tanpa menambah cabang di sini
akan gagal keras — bukan diam-diam membuat Karyawan menunjuk Lookup yang salah.

`apply_revert_operation` memang memakai `EXECUTE`, karena kolom yang dipulihkan
berbeda-beda per Revisi. Tapi tidak satu pun identifier datang dari pemanggil:
nama tabel dicocokkan ke daftar tujuh tabel ter-log yang ditulis tangan di
fungsi itu, kolom kunci harus persis kolom kunci tabel tersebut, dan daftar
kolomnya diambil dari `information_schema` — kunci jsonb dari pemanggil hanya
**menyaring** daftar katalog itu, tidak pernah ikut di-`format`.

### Seed: koneksi `pg` langsung, bukan RPC `seed_employees(jsonb)`

`scripts/seed-from-excel.ts` menyambung langsung ke Postgres lewat `pg` (sudah
devDependency, dipakai `scripts/gen-types-from-pg.ts`) dan menjalankan seluruh
Seed dalam satu transaksi sungguhan. Mekanismenya disediakan di
`lib/revisions/seedBatch.ts` (`runSeedBatch()` / `withSeedBatch()`): `BEGIN` →
`begin_batch('seed', …, p_local => true)` → semua insert → `COMMIT`.

Dipilih daripada `seed_employees(p_rows jsonb)` karena:

- Seed memasukkan **empat** jenis Data Referensi (`lookups`, `jabatan`,
  `org_units` berhierarki) plus `employees` plus `employee_private`. Satu RPC
  jsonb raksasa berarti menulis ulang separuh skema sebagai kontrak jsonb di
  SQL, dan mengubahnya setiap kali pemetaan Excel bergeser.
- ±1.475 baris dalam satu body request HTTP adalah risiko payload dan timeout
  yang tidak perlu diambil oleh script yang jalan sekali.
- Script sekali jalan **memegang koneksinya sendiri** — justru situasi yang
  ADR-005 §9 sebut aman. Dan dengan transaksi sungguhan, ia tetap memakai
  `p_local => true` (scope transaksi), jadi tidak ada yang bisa bocor sama
  sekali, bahkan tidak butuh `sessionScoped`.
- Bonus yang tidak diberikan RPC: satu baris gagal me-`ROLLBACK` seluruh Seed,
  termasuk baris `batches`-nya, alih-alih meninggalkan separuh perusahaan dan
  separuh Batch di database.

## Alternatif yang Ditolak

- **`begin_batch(..., p_local => false)`** — cara paling cepat, dan justru
  lubang yang ADR-005 §9 tutup dengan sengaja. Setting ber-scope sesi menempel
  pada koneksi **pooled**: request yang mati sebelum `end_batch()` mewariskan
  `app.batch_id` ke request berikutnya, sehingga tulisan admin lain ikut masuk
  ke Batch itu — dan "kembalikan Batch ini" ikut membatalkan pekerjaan mereka.
  Di sistem HR, itu menukar satu bug pengelompokan dengan satu bug integritas
  data lintas pengguna. Ditolak.
- **Menerima pengelompokan per statement dan mendokumentasikannya** — itu
  keadaan sebelum ADR ini. Artinya mencoret janji di empat dokumen, membuang
  PRD #16 sepenuhnya, dan membiarkan exit criteria Fase 1 dan Fase 3 tidak bisa
  dipenuhi.
- **Mempertahankan `withBatch()` untuk tindakan satu-statement demi
  `keterangan` dan `jenis` yang spesifik** — versi pertama ADR ini memilih itu.
  Harganya: setiap tindakan menghasilkan dua baris di Log Perubahan, yang bisa
  dibaca kosong dan yang berisi tidak bisa dibaca, dan "kembalikan Batch ini"
  atas baris yang bisa dibaca tidak melakukan apa-apa. Label yang salah tempat
  lebih buruk daripada tidak ada label: yang hilang cuma kalimat, sedangkan yang
  didapat adalah satu baris log yang isinya cocok dengan judulnya.
- **Membuat setiap Server Action jadi fungsi Postgres supaya `keterangan` dan
  `jenis` tetap ada** — satu fungsi SQL per tulisan, validasi zod bersama jadi
  tidak terpakai, dan tiga belas unit paralel menulis SQL alih-alih TypeScript.
  Biaya besar untuk sebuah label yang PRD tidak minta.
- **Satu `UPDATE ... FROM` raksasa per Merge** — tiga tabel berbeda dengan
  kolom berbeda tidak bisa disatukan jadi satu statement, dan yang bisa pun akan
  jadi SQL yang tidak ada yang berani sunting.
- **Menjalankan Merge/Revert lewat `service_role` dari Server Action** — satu
  panggilan, tapi menembus RLS untuk operasi yang paling merusak di aplikasi,
  dan melanggar aturan CLAUDE.md bahwa service role hanya untuk `app/api/v1/**`
  dan `scripts/**`.
- **`SECURITY DEFINER` tanpa pemeriksaan role** — akan menyerahkan hak admin ke
  setiap viewer yang bisa memanggil RPC. Bahkan dengan pemeriksaan role, lihat
  alasan memilih invoker di atas.
- **Menunggu akses Supabase sebelum menambah migration** — supabase.com tetap
  diblokir; PostgreSQL 16 lokal memverifikasi seluruh permukaan SQL, dan
  `scripts/verify-schema.sql` §18 membuktikan perilakunya.

## Konsekuensi

- Lebih mudah: satu Merge = satu baris di Log Perubahan yang benar-benar bisa
  dibalikkan utuh. Exit criteria ROADMAP Fase 3 sekarang **dicek mesin** di
  `scripts/verify-schema.sql` §18 — satu Batch `merge`, Revisi untuk setiap
  Karyawan yang pindah, setiap unit anak yang di-reparent dan unit asal yang
  dinonaktifkan, lalu revert yang mengembalikan keadaan persis termasuk `status`
  dan `merged_into_id`, lalu penolakan revert kedua.
- Lebih mudah: Seed ±1.475 Karyawan jadi satu Batch `seed` yang bisa dibatalkan
  utuh, dan gagal-total kalau ada satu baris rusak.
- Lebih mudah: `/log` menampilkan **tepat satu** baris per tindakan, dan baris
  itu memuat Revisi-nya. Tidak ada lagi Batch kosong di mana pun —
  `scripts/verify-schema.sql` §19.2 gagal kalau ada satu saja.
- Lebih mudah: aturan barunya sederhana dan bisa diucapkan — **satu statement →
  tulis langsung, jangan buka Batch; lebih dari satu statement → fungsi
  Postgres.** Tidak ada lagi keputusan "pakai `withBatch()` atau tidak", karena
  `withBatch()` sudah tidak ada.
- **Lebih susah, dan ini biayanya: logika pindah ke SQL.** Merge dan revert
  sekarang hidup di `0002_batch_operations.sql`, di luar jangkauan TypeScript,
  `npm run typecheck` dan unit test biasa. Yang menjaganya adalah
  `scripts/verify-schema.sql` (perilaku, butuh Postgres) dan
  `tests/migrationInvariants.test.ts` (aturan yang terbaca dari file, jalan di
  mana saja). Menambah aturan Merge baru berarti menyunting SQL, menjalankan
  `npm run db:local`, dan `npm run gen:types`.
- Lebih susah: ada dua tempat yang memuat aturan perencanaan revert —
  `planRevert()` di TypeScript (untuk revert satu Revisi, teruji murni) dan
  `revert_plan_for_batch()` di SQL (untuk revert satu Batch). Keduanya harus
  diubah bersamaan; pesan `skipped`-nya sengaja identik kata per kata supaya
  perbedaan langsung terlihat.
- **Lebih susah: Log Perubahan jadi lebih sepi kata-kata.** Edit biasa muncul
  sebagai "Edit — Perubahan data" plus daftar Revisi-nya; halaman `/log` harus
  menjelaskan tindakan dari baris Revisi (tabel mana, baris mana, kolom apa yang
  bergerak), bukan dari judul Batch. Untuk Merge, Revert dan Seed judulnya tetap
  kaya, karena fungsi RPC-nya menulis `keterangan` sendiri.
- Lebih susah: `batches.jenis` kini tidak seimbang — `create`, `deactivate` dan
  `rename` hanya pernah muncul dari fungsi RPC. Ketujuh nilainya tetap sah di
  CHECK constraint dan di `BATCH_TYPE_LABELS`; jangan "membersihkan" yang tidak
  terpakai.
- Terkunci lagi: `supabase/migrations/` beku pada **dua** file. Perubahan skema
  berikutnya dilakukan di dalam file yang sudah ada — sampai ada project
  Supabase berisi data, yang akan menuntut ADR baru lagi.

## Bagaimana keputusan ini dijaga

Aturan yang cuma ditulis di dokumen akan dilanggar oleh unit paralel berikutnya
yang membaca contoh lama. Karena itu keduanya dicek mesin:

- `scripts/verify-schema.sql` §19 — sisi database: satu `UPDATE` telanjang
  menghasilkan **tepat satu** Batch yang memuat Revisi-nya (§19.1); **tidak ada
  satu pun Batch kosong** di seluruh database setelah seluruh suite berjalan
  (§19.2) — gejala yang pasti muncul kalau ada yang membuka Batch dari kode
  lagi; dan tidak ada `keterangan` Batch yang menyebut istilah internal, karena
  halaman itu dibaca staf HC (§19.3).
- `tests/batchDiscipline.test.ts` — sisi TypeScript, yang tidak bisa dilihat
  SQL: tidak ada berkas di `lib/`, `app/`, `components/` atau `scripts/` yang
  memanggil `withBatch()`/`beginBatch()`/`endBatch()` atau RPC
  `begin_batch`/`end_batch`, dengan **satu** pengecualian yang terdaftar
  eksplisit: `lib/revisions/seedBatch.ts`.
- `lib/revisions/batch.ts` tetap ada sebagai tempat aturan ini dijelaskan —
  berisi penjelasan kenapa `withBatch()` tidak ada lagi, plus
  `batchKeterangan()`, satu-satunya label Batch yang masih ditulis manusia
  (yang diserahkan ke RPC merge/revert).

Kalau nanti ada tindakan satu-statement yang benar-benar butuh `keterangan` atau
`jenis` sendiri, jalannya sudah jelas dan sudah terbukti: pindahkan tindakan itu
ke fungsi Postgres, seperti Merge dan Revert di sini. Jangan menghidupkan lagi
Batch yang dibuka dari TypeScript — ia akan kosong, persis seperti sebelumnya.
