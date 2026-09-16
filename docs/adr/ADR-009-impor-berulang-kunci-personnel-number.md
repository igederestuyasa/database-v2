# ADR-009 — Impor Excel berulang: `personnel_number` sebagai kunci, dan sel kosong tidak pernah mengosongkan

Status: Diterima
Tanggal: 2026-09-16
Terkait: ADR-008 (Seed lewat web, yang halaman ini gantikan), ADR-006 (satu tindakan = satu transaksi = satu Batch), ADR-002 (Data Referensi masuk apa adanya, dibersihkan lewat Merge), PRD #24, PRD §5 (tempat fitur ini sebelumnya ditunda)

## Konteks

`/karyawan/seed` hanya berjalan **sekali**: `seed_from_payload()` menolak jalan
kalau tabel Karyawan sudah berisi, dan halamannya berubah jadi jalan buntu
setelah Seed pertama. Itu keputusan yang benar untuk apa yang dijanjikan PRD
#23 — "Excel dipakai sekali saja" — dan salah untuk apa yang ternyata
dibutuhkan setiap bulan sesudahnya: karyawan baru masuk, jabatan orang berubah,
dan sumbernya tetap sebuah Excel yang dikirim unit lain.

Jalan keluar yang ada sebelum ADR ini cuma dua, dan dua-duanya buruk:
mengetik ulang puluhan orang lewat form Tambah Karyawan satu per satu, atau
mengembalikan Batch Seed lalu Seed ulang — yang berarti seluruh riwayat Revisi
sejak Seed pertama jadi tidak berarti.

PRD §5 memang sudah menyebut "batch add karyawan berulang" sebagai
Nice-to-Have. Yang membuatnya naik jadi PRD #24 adalah pemiliknya memintanya
secara eksplisit, dengan kunci yang sudah ditentukan: Personnel Number.

## Keputusan

**Halaman `/karyawan/seed` diganti `/karyawan/impor`, dan RPC-nya
`import_from_payload()` — upsert, bukan insert.**

Empat hal yang dikunci di sini:

### 1. Kuncinya `personnel_number`, bukan `id` dan bukan `nip`

`personnel_number` memang business key Karyawan (CLAUDE.md, CONTEXT.md) dan
sudah `unique` di skema. `id` adalah uuid internal yang tidak pernah ada di
Excel mana pun. `nip` juga unique tapi **nullable** — ada Karyawan tanpa NIP,
dan kunci yang boleh kosong bukan kunci.

Konsekuensi yang disengaja: NIP yang di file menunjuk orang lain tetap bisa
menabrak `unique` dan membatalkan seluruh Impor. Itu benar — dua orang tidak
boleh berbagi NIP, dan diam-diam melewati barisnya akan menyembunyikan
kesalahan ketik yang nyata.

### 2. Sel Excel yang kosong TIDAK mengosongkan data yang sudah ada

Setiap kolom ditulis `coalesce(excluded.kolom, employees.kolom)`.

Alternatif "Excel adalah kebenaran, kosong berarti kosong" ditolak: file yang
dikirim unit lain hampir tidak pernah memuat semua 29 kolom, dan sekali saja
seseorang mengunggah file berisi tiga kolom, seluruh perusahaan kehilangan
tanggal lahir, jurusan, dan nomor surat sekaligus. Kerusakan itu bisa
dikembalikan lewat Log Perubahan, tapi hanya kalau ada yang menyadarinya.

Untuk **mengosongkan** sebuah kolom: form Ubah Karyawan. Di sana kosong memang
berarti kosong, dan itu satu orang yang sengaja.

### 3. Baris yang tidak berubah tidak disentuh sama sekali

Klausa `where … is distinct from …` pada `do update` menyaring baris yang
nilainya sama. `log_revision()` sebenarnya sudah melewatkan UPDATE yang tidak
mengubah apa pun, jadi ini bukan soal Revisi — ini soal `updated_at`, yang
kalau ikut bergerak akan membuat 1.475 orang tampak "terakhir diubah hari ini"
setiap kali ada satu orang yang berubah.

Efek samping yang ikut diputuskan: Impor yang tidak mengubah **apa pun**
dibatalkan (55000), bukan dilaporkan sukses-dengan-nol. `begin_batch()` sudah
menulis satu baris `batches` sebelum kita tahu hasilnya, dan Batch tanpa Revisi
adalah baris kosong di Log Perubahan yang tidak bisa dihapus lagi — CLAUDE.md
melarang DELETE pada `batches`, dan `verify-schema.sql` menegakkan "tidak ada
Batch kosong". Membatalkan transaksinya membuang Batch itu bersamaan.

### 4. Data Referensi dicocokkan lewat kode, dan tidak pernah ditimpa

Unit Organisasi, Jabatan, dan Lookup yang kode-nya sudah ada dipakai ulang apa
adanya: nama, label, tipe, dan induknya tidak diubah isi Excel. Impor hanya
boleh **menambah** Data Referensi yang benar-benar baru.

Ini ADR-002 diterapkan pada jalur baru: pembersihan varian adalah pekerjaan
halaman Perlu Dibereskan + Merge, yang menghasilkan Temuan yang bisa dilihat
dan Merge yang bisa dikembalikan. Impor yang diam-diam menimpa nama unit
menghasilkan perubahan yang tidak diminta siapa pun dan tidak dilihat siapa
pun.

## Alternatif yang ditolak

| Alternatif | Kenapa tidak |
|---|---|
| Tetap pakai `seed_from_payload` dengan `p_force` | `p_force` hanya melewati pemeriksaan "tabel sudah berisi"; sesudahnya ia tetap murni INSERT, jadi baris pertama langsung menabrak `unique (personnel_number)` dan seluruh transaksi batal. Force bukan upsert. |
| Halaman terpisah "Tambah Batch", Seed dibiarkan | Dua halaman yang menerima file Excel yang sama dan berbeda hanya pada apa yang terjadi kalau datanya sudah ada — itu pilihan yang harus dibuat staf HC setiap bulan, padahal database sudah tahu jawabannya. |
| Excel sebagai sumber kebenaran penuh (kosong = kosong) | Lihat §2. Juga bertentangan dengan PRD §6: aplikasi ini sumber kebenarannya, bukan Excel. |
| Melewati baris yang Personnel Number-nya sudah ada | Yang diminta justru memperbarui; "lewati" membuat file koreksi jadi tidak berguna. |
| Menolak seluruh file kalau ada yang sudah terdaftar | Sama: file bulanan hampir selalu memuat orang lama dan orang baru sekaligus. |
| Menghapus `seed_from_payload` sekalian | 14 assertion di `scripts/verify-schema.sql` dan satu berkas test bergantung padanya, dan fungsinya masih benar untuk apa yang dijanjikannya. Ia tidak lagi dipanggil halaman mana pun; mencabutnya adalah pembersihan tersendiri, bukan bagian dari perubahan ini. |

## Konsekuensi

**Yang didapat.** File Excel boleh diunggah kapan saja, berapa kali pun.
Koreksi satu kolom untuk 50 orang jadi satu unggahan, bukan 50 form. Tiap
unggahan satu Batch `impor` yang bisa dikembalikan utuh, dan yang masuk Revisi
cuma yang benar-benar berubah.

**Yang dibayar.**

- `batches.jenis` bertambah satu nilai (`impor`). CHECK-nya dipasang ulang
  lewat `alter table … drop constraint if exists` di `0001_init.sql`, karena
  `create table if not exists` tidak menyentuh tabel yang sudah ada — jadi
  database yang sudah jalan **harus menempel ulang kedua file migration** untuk
  mendapatkannya.
- Pratinjau hanya bisa mengatakan "sudah terdaftar", bukan "akan diperbarui".
  Yang tahu berapa yang benar-benar berubah hanya fungsi SQL-nya, sesudah
  membandingkan per kolom. Angka yang jujur dan tidak lengkap lebih baik
  daripada angka yang menjanjikan.
- Halaman ini sekarang membaca seluruh `personnel_number` (±20 KB untuk 1.500
  orang) tiap kali dibuka, supaya pratinjau bisa memisahkan baru dari lama.
  Kalau pembacaan itu gagal, Impor tetap boleh jalan — databasenya yang
  memutuskan, bukan daftar itu.
- Template Excel menambah satu kewajiban: ia harus tetap sejalan dengan
  `HEADER_TARGETS`. Dijaga `lib/seed/template.test.ts` dua arah — tiap kolom
  template harus dikenali pemetaan, dan tiap tujuan pemetaan harus punya kolom
  di template.
