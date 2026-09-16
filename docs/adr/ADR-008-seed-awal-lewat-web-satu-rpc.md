# ADR-008 — Seed awal juga lewat halaman web: Excel dibaca di peramban, satu RPC menulis satu Batch

Status: Diterima
Tanggal: 2026-09-16
Terkait: ADR-006 §"Seed: koneksi `pg` langsung, bukan RPC `seed_employees(jsonb)`" (dibuka ulang di sini), ADR-005 §5 (`xlsx`), PRD #1, PRD #23, PRD §3 ("Excel dipakai sekali saja")

## Konteks

Seed awal (±1.475 Karyawan dari workbook "Demografi Karyawan - Posisi") hanya
punya satu pintu: `scripts/seed-from-excel.ts`, dijalankan dari komputer yang
punya Node.js, salinan repositori, dan sambungan Postgres langsung. ADR-006
memilih bentuk itu dengan sengaja dan **menolak** alternatif "satu RPC
`seed_employees(jsonb)`" dengan empat argumen.

Yang berubah adalah keadaan pemilik proyek: laptop kantornya tidak boleh
memasang apa pun, termasuk Node. Dua jalan keluar tanpa mengubah kode ditimbang
dan ditolak:

- **GitHub Codespaces** atau GitHub Actions: skrip jalan di mesin GitHub. Tapi
  file Excel berisi data karyawan asli harus singgah di mesin itu, dan itu
  keputusan kebijakan data yang bukan milik repo ini.
- **Laptop orang lain** yang boleh memasang Node: bisa, tapi berarti Seed
  bergantung pada satu orang teknis, persis yang Fase 5 ROADMAP ingin
  hilangkan.

Jadi pertanyaannya bukan "apakah RPC seed itu buruk" — ADR-006 sudah menjawab
itu untuk situasi tanpa kebutuhan web — melainkan "kalau Seed harus bisa dari
peramban, bentuk mana yang tetap memenuhi ADR-006: satu tindakan = satu
transaksi = satu Batch?"

### Keempat argumen ADR-006, dijawab satu per satu

| Argumen ADR-006 | Yang ditemukan sekarang |
|---|---|
| "Satu RPC jsonb raksasa berarti menulis ulang separuh skema sebagai kontrak jsonb di SQL, dan mengubahnya setiap kali pemetaan Excel bergeser." | Kontraknya **bukan** Excel dan bukan skema, melainkan `SeedPlan` yang sudah ada — keluaran `planSeed()` di `scripts/lib/excelMapping.ts` (kini `lib/seed/excelMapping.ts`), murni dan diuji 131 test. Pemetaan Excel yang bergeser mengubah modul itu, dan **tidak** mengubah bentuk payload: empat daftar dengan kolom tabel apa adanya. Fungsi SQL-nya 29 kolom `employees` yang persis sama dengan `EMPLOYEE_COLUMNS` di skrip. |
| "±1.475 baris dalam satu body request HTTP adalah risiko payload dan timeout yang tidak perlu diambil oleh script yang jalan sekali." | Diukur pada workbook dummy: rencana mentah 1.808 KB untuk 1.500 baris, dan **1.039 KB** dalam bentuk index (`lib/seed/payload.ts`). `bodySizeLimit` Server Action dinaikkan ke 4 MB, di bawah batas 4,5 MB Vercel; `lib/seed/payload.test.ts` menjaga payload 1.500 baris tetap di bawah 2 MB. Di Postgres 16 lokal `seed_from_payload()` untuk 1.500 baris selesai dalam sekitar 0,6 detik (4.704 Revisi), 3.000 baris dalam sekitar 1,2 detik — jauh di bawah batas waktu fungsi Vercel. |
| "Script sekali jalan memegang koneksinya sendiri — situasi yang ADR-005 §9 sebut aman." | Fungsi Postgres memegang **transaksinya sendiri**: satu panggilan RPC adalah satu statement adalah satu transaksi. `begin_batch('seed', …, p_local => true)` dipanggil di dalamnya, sama seperti `merge_*` dan `revert_batch`; `app.batch_id` tidak pernah keluar dari transaksi itu. |
| "Bonus yang tidak diberikan RPC: satu baris gagal me-ROLLBACK seluruh Seed, termasuk baris `batches`-nya." | RPC memberikannya juga: exception di tengah fungsi membatalkan seluruh statement, termasuk `insert` yang `begin_batch()` lakukan. `scripts/verify-schema.sql` §18.8.d membuktikannya: Lookup bertipe di luar CHECK gagal di tengah, dan **tidak ada** baris `batches` maupun `employees` yang tersisa. |

Satu kekhawatiran lain yang bukan milik ADR-006 tapi milik ADR-005 §5:
`xlsx@0.18.5` punya CVE (prototype pollution, ReDoS) dan penerimaan risikonya
bertumpu pada "hanya dijalankan skrip, tidak pernah menyentuh input dari
pengguna, tidak pernah masuk request path server". Komentar di kepala
`scripts/seed-from-excel.ts` menegaskan: *nothing under `app/` may import it.*

## Keputusan

**Seed awal mendapat pintu kedua di `/karyawan/seed`, dan kedua pintu memakai
logika yang sama.** Tiga bagian:

1. **Excel dibaca di peramban admin, bukan di server.** Komponen klien memuat
   SheetJS lewat `import("xlsx")` dinamis (chunk terpisah, hanya untuk halaman
   itu), membaca file yang admin pilih sendiri dengan opsi persis `readSheet()`
   skrip, lalu menjalankan `planSeed()` dari `lib/seed/excelMapping.ts`. File
   tidak pernah diunggah; yang sampai ke server hanya JSON. Dengan begitu
   `xlsx` **tetap tidak pernah dijalankan di server** — ADR-005 §5 tetap
   berdiri, dengan catatan tinjauan yang ditambahkan di sana. Risiko CVE-nya
   kini berada di peramban admin atas file admin sendiri, tempat yang sama
   dengan skrip di laptop admin.

2. **Payload berbasis index, divalidasi dua kali.** `lib/seed/payload.ts`
   mengubah `SeedPlan` menjadi `SeedPayload`: empat daftar, setiap rujukan
   (induk Unit Organisasi, unit/jabatan seorang Karyawan, Lookup per tipe)
   berupa index 0-based ke daftarnya. Dua alasan: kunci rencana memakai
   karakter NUL yang ditolak `jsonb`, dan bentuk index memangkas ukuran hampir
   setengah. `seedPayloadSchema` (zod) memeriksa bentuk, batas jumlah, enum
   tipe, tanggal ISO, induk-lebih-dulu, index dalam jangkauan dan tipenya
   cocok, keunikan Personnel Number/NIP/kode — di Server Action, karena
   peramban bukan pihak tepercaya. Fungsi SQL memeriksa ulang bentuk dan
   rujukan sebelum membuka Batch, dan database memeriksa sisanya (UNIQUE,
   CHECK, trigger `employees_validate_lookups`, RLS).

3. **Satu fungsi Postgres, `seed_from_payload(p_payload, p_keterangan,
   p_force)`**, di `0002_batch_operations.sql` (direktori tetap dua file),
   mengikuti setiap aturan fungsi di sana: `SECURITY INVOKER`, `assert_admin()`
   sebagai statement pertama, membuka Batch `seed` sendiri dan mengembalikan
   `app.batch_id` pemanggil di akhir, tanpa DELETE, tanpa menulis `revisions`
   atau `batches`, satu `revoke` + satu `grant`. Urutan tulis dipaksa FK:
   lookups → jabatan → org_units (induk lebih dulu) → employees → UPDATE
   `employee_private` (barisnya dibuat trigger, seperti di skrip). Penjaga
   sekali-jalan sama dengan skrip: menolak kalau `employees` sudah berisi,
   kecuali `p_force` — yang **tidak pernah** dikirim halaman web; ia ada
   untuk test dan orang teknis. `pg_advisory_xact_lock` menyerialkan dua admin
   yang menekan "Jalankan" bersamaan.

**Skrip CLI tetap ada** sebagai alternatif orang teknis, memakai
`lib/seed/excelMapping.ts` yang sama; ADR-006 §Seed tetap benar untuk skrip
itu. Yang dicabut dari ADR-006 hanya kalimat "bukan RPC" sebagai larangan
umum: RPC ditolak *sebagai pengganti* skrip pada saat itu, bukan sebagai
bentuk yang salah.

Yang sengaja **tidak** dibangun: batch add berulang (parkiran ROADMAP). "Seed"
tetap berarti sekali jalan (CONTEXT.md), dan halaman menolak dirinya sendiri
begitu tabel Karyawan berisi.

## Alternatif yang Ditolak

- **Parsing Excel di server (Server Action menerima `FormData`)** — melanggar
  larangan `xlsx` di request path (ADR-005 §5, komentar skrip), menaikkan
  risiko CVE dari "file admin di mesin admin" menjadi "file apa pun yang
  sampai ke server", dan tidak memberi apa-apa yang parsing di peramban tidak
  berikan; malah pratinjau jadi butuh satu round-trip unggah.
- **Codespaces / GitHub Actions menjalankan skrip** — tidak butuh kode, tapi
  data karyawan asli singgah di mesin GitHub. Ditawarkan dan ditolak pemilik
  proyek.
- **Mengirim `SeedPlan` apa adanya** — `jsonb` menolak NUL di kuncinya, dan
  1,8 MB untuk 1.500 baris tanpa alasan.
- **Temp table untuk pemetaan index → id** — array plpgsql cukup untuk ratusan
  Data Referensi, dan tidak menyisakan objek apa pun saat fungsi dipanggil dua
  kali dalam satu transaksi (test).
- **`SECURITY DEFINER`** untuk fungsinya — ditolak ADR-006, tidak ada alasan
  baru.

## Konsekuensi

- Chunk `xlsx` (~400 KB) dimuat hanya di `/karyawan/seed`, tidak masuk
  *First Load JS* halaman lain (`next build` memperlihatkannya).
- `next.config.ts` menaikkan `experimental.serverActions.bodySizeLimit` ke
  `4mb`. Ini konfigurasi global Server Action; tidak ada action lain yang
  mendekati 1 MB.
- `lib/seed/excelMapping.ts` pindah dari `scripts/lib/` (isi tidak berubah)
  karena `lib/` tidak boleh mengimpor dari `scripts/`. `scripts/seed-from-excel.ts`
  dan generator dummy mengimpornya dari lokasi baru.
- Halaman Karyawan menampilkan tombol "Jalankan Seed awal" hanya untuk admin
  saat daftar kosong tanpa filter — pintu masuk satu-satunya selain README.
- `p_force` ada di tanda tangan fungsi. Jangan pernah mengeksposnya di UI;
  kalau suatu hari batch add berulang dibangun, itu fungsi lain dengan
  aturan duplikat sendiri, bukan `p_force => true`.
- Jangan "memperbaiki" halaman Seed dengan memindahkan parsing ke server tanpa
  ADR baru: batas `xlsx` di peramban adalah keputusan, bukan kebetulan.

## Bagaimana keputusan ini dijaga

- `tests/migrationInvariants.test.ts`: `seed_from_payload` terdaftar sebagai
  entry point (assert_admin pertama, satu `begin_batch` per entry point,
  `p_local` selalu `true`, tanpa `security definer`, grant persis).
- `scripts/verify-schema.sql` §18.1 (10 fungsi, INVOKER, anon ditolak) dan
  §18.8 (satu Batch berisi 10 Revisi dari payload kecil; 55000 tanpa
  `p_force`; 22023 tanpa Batch; 23514 di tengah tanpa sisa; viewer 42501).
- `tests/seedFromPayload.sql.test.ts`: workbook dummy → `planSeed` →
  `buildSeedPayload` → RPC di Postgres lokal, angka hasil = panjang rencana,
  semua Revisi di satu Batch, index terpetakan ke id. Jalan di job `skema` CI.
- `lib/seed/payload.test.ts` dan `scripts/lib/__tests__/dummyWorkbook.test.ts`:
  skema menolak payload yang dirusak; payload 1.500 baris < 2 MB; angka
  pratinjau web = angka laporan CLI.
- `tests/batchDiscipline.test.ts`: Server Action tidak menyebut `begin_batch`.
