# Panduan HC Core — untuk Staf Human Capital

HC Core adalah tempat resmi data Karyawan PT Hutama Karya (Persero). Semua
perubahan data Karyawan dilakukan **di sini**, bukan di file Excel. Setiap
perubahan tercatat: siapa yang mengubah, kapan, apa yang berubah — dan hampir
semuanya bisa dikembalikan lagi.

Panduan ini ditulis untuk orang yang memakai aplikasinya, bukan yang
membangunnya. Anda tidak perlu tahu apa pun soal database untuk mengikutinya.

**Satu hal yang perlu ditenangkan lebih dulu:** tidak ada tombol hapus di
aplikasi ini, di mana pun. Karyawan yang keluar ditandai **nonaktif**, bukan
dihapus. Jadi kesalahan terburuk yang bisa Anda buat adalah kesalahan yang bisa
dikembalikan.

---

## 1. Masuk ke aplikasi

1. Buka alamat HC Core di peramban (Chrome/Edge), lalu Anda akan melihat halaman
   **Masuk**.
2. Isi **email kantor** Anda. Hanya email kantor yang diterima; email pribadi
   akan ditolak.
3. Dua cara masuk, pilih salah satu:
   - **Punya kata sandi** — isi kata sandi lalu tekan **Masuk**.
   - **Belum punya kata sandi** — kosongkan kata sandi dan tekan **Kirim tautan
     masuk ke email**. Sebuah tautan sekali pakai dikirim ke email kantor Anda.
     Buka tautan itu **di peramban yang sama**; masa berlakunya terbatas.
4. Setelah masuk, Anda mendarat di halaman **Karyawan**.

Keluar dari aplikasi: tombol **Keluar** ada di pojok kiri bawah, di bawah alamat
email Anda.

### Dua jenis pengguna

| | Boleh apa |
|---|---|
| **Admin** | Mengubah semua data, membereskan data kotor, mengembalikan perubahan, mengelola API Key, dan melihat Data Pribadi Sensitif (agama, tanggal & tempat lahir, status pernikahan). |
| **Viewer** | Membaca dan mencari saja. Tidak ada tombol ubah, dan Data Pribadi Sensitif tidak ditampilkan. |

Siapa jadi apa diatur di halaman **Pengguna** (khusus admin). Akun tidak dibuat
sendiri: seseorang harus **diundang** dulu oleh admin (bagian 8b), dan setiap
orang yang baru pertama kali masuk otomatis menjadi **viewer**.

---

## 2. Mencari Karyawan

Halaman **Karyawan** adalah beranda aplikasi.

- Kotak pencarian menerima **nama**, **NIP**, atau **Personnel Number** —
  sebagian saja sudah cukup.
- Penyaring (filter) di sebelahnya mempersempit daftar: Unit Organisasi,
  Jabatan, status, dan daftar pilihan lain seperti Person Grade atau Job Grade.
- Klik satu baris untuk membuka halaman detail orang tersebut.

Halaman detail menampilkan seluruh kolom, termasuk kolom yang dihitung sendiri
oleh sistem (usia, masa kerja, masa sejak promosi). Kolom hitungan itu tidak
bisa diketik — ia selalu ikut tanggalnya.

---

## 3. Mengubah data seorang Karyawan

1. Buka halaman detail Karyawan-nya.
2. Tekan **Ubah data Karyawan** di bagian atas (tombol ini hanya muncul untuk
   admin).
3. Perbaiki isian yang perlu, lalu **Simpan**.

Yang perlu diketahui saat mengisi:

- **Unit Organisasi, Jabatan, dan daftar pilihan (grade, band, dsb.) dipilih
  dari daftar, tidak diketik.** Itu disengaja: mengetik bebas adalah asal-usul
  semua nama kembar di Excel dulu. Kalau pilihan yang Anda butuhkan belum ada,
  tambahkan dulu di halaman **Struktur Organisasi**, **Jabatan**, atau **Master
  Data**, baru kembali ke sini.
- **Pilih Unit Organisasi yang paling bawah** tempat orang itu duduk (misalnya
  sub bagian atau proyek). Divisi dan direktoratnya diisi sendiri oleh sistem
  dari hierarki — Anda tidak perlu mengisinya lagi.
- **Status dan Tanggal Keluar tidak ada di form ini.** Keduanya diatur di kotak
  **Status Karyawan** di halaman yang sama, supaya tanggal keluar dan status
  tidak pernah berbeda cerita.
- **Data Pribadi Sensitif** punya form sendiri di bawah, khusus admin. Kolomnya
  boleh dikosongkan, dan isinya tidak pernah keluar lewat API.

### Menandai Karyawan keluar

Di kotak **Status Karyawan**, tekan **Nonaktifkan**, isi **Tanggal Keluar**,
lalu simpan. Orangnya tetap ada di sistem dengan status nonaktif dan tetap bisa
dicari (ubah penyaring status ke "nonaktif" atau "semua").

Salah ketik tanggal keluar? Jalankan lagi langkah yang sama pada orang yang
sudah nonaktif — tanggalnya saja yang bergeser, tanpa perlu diaktifkan dulu.

---

## 4. Membatalkan kesalahan

Ini bagian yang membuat HC Core berbeda dari Excel. **Tidak ada perubahan yang
hilang, dan setiap perubahan bisa dikembalikan.** Satu catatan yang jujur:
"dikembalikan" selalu berarti menulis keadaan lama kembali, tidak pernah
menghapus. Mengembalikan sebuah **penambahan** berarti barisnya ditandai
nonaktif, bukan lenyap — lihat catatan di bagian 8c untuk satu-satunya tempat
di mana bedanya terasa.

Dua istilah yang dipakai di layar:

- **Revisi** — satu perubahan pada satu baris. Berisi keadaan **sebelum** dan
  **sesudah**, siapa, dan kapan.
- **Batch** — sekumpulan Revisi yang terjadi karena **satu tindakan**. Satu
  penyimpanan, satu penggabungan, satu seed awal — masing-masing satu Batch.

### Mengembalikan satu perubahan pada seorang Karyawan

1. Buka halaman detail Karyawan yang salah.
2. Lihat panel **Riwayat Revisi** di sebelah kanan. Setiap baris menunjukkan
   kolom apa yang bergerak, dari nilai apa ke nilai apa.
3. Tekan **Kembalikan** pada Revisi yang mau dibatalkan, lalu konfirmasi.

Datanya kembali ke keadaan sebelum Revisi itu — dan pengembaliannya sendiri
**tercatat sebagai Revisi baru**. Riwayat tidak pernah dihapus, jadi salah
mengembalikan pun masih bisa dikembalikan lagi.

> Panel **Riwayat Revisi** dengan tombol **Kembalikan** yang sama ada di
> halaman detail **Unit Organisasi**, **Jabatan**, dan **Lookup** juga — klik
> namanya di halaman daftarnya. Jadi salah mengganti nama satu divisi
> dikembalikan di halaman divisi itu, dengan cara yang persis sama seperti di
> atas. Halaman **Log Perubahan** di bawah adalah untuk tindakan yang lebih
> besar dari satu baris.

### Mengembalikan satu tindakan utuh

Kalau yang salah bukan satu kolom melainkan satu tindakan besar — satu
penggabungan yang keliru, atau seed awal yang salah file:

1. Buka halaman **Log Perubahan**.
2. Cari barisnya (paling baru di atas; setiap baris menyebutkan jenis tindakan,
   pelakunya, waktunya, dan berapa Revisi yang dimuatnya). Penyaring di atas
   mempersempit daftar menurut jenis tindakan, kata kunci, dan apakah Batch-nya
   sudah pernah dikembalikan.
3. Tekan **Lihat Revisi** pada baris itu untuk memeriksa isinya — kolom apa
   yang bergerak pada baris mana, dari nilai apa ke nilai apa.
4. Tekan **Kembalikan seluruh Batch**.

Seluruh isi tindakan itu kembali sekaligus. Satu Batch hanya bisa dikembalikan
sekali; percobaan kedua ditolak dengan penjelasan.

---

## 5. Membereskan nama yang kembar

Data awal sengaja dimasukkan **apa adanya**, lengkap dengan varian penulisan dan
salah ketik yang terbawa dari Excel. Membereskannya dilakukan di aplikasi, dan
tempatnya adalah halaman **Perlu Dibereskan**.

Halaman itu menghitung sendiri daftar **Temuan** setiap kali dibuka:

- **Nama mirip** — "Divisi QHSSE" dan "DIVISI QHSSE", "Umum dan Personalia" dan
  "Umum & Personalia".
- **Belum punya induk** — Unit Organisasi yang menggantung di luar hierarki.
- **Namanya sama dengan induknya** — sub bagian yang bernama persis seperti
  bagian di atasnya.
- **Karyawan tanpa Unit Organisasi atau tanpa Jabatan.**

Setiap Temuan membawa tombol perbaikannya sendiri, jadi Anda tidak perlu pindah
halaman:

**Kalau dua nama itu sebenarnya satu hal yang sama → Gabungkan (Merge).**
Tekan **Merge…** (atau **Gabungkan ke induk…** pada Temuan sub bagian yang
senama dengan induknya), pilih mana yang menjadi **tujuan** (nama yang dipakai
seterusnya), baca ringkasan "berapa Karyawan akan dipindahkan", lalu tekan
**Gabungkan sekarang**. Semua Karyawan pindah ke tujuan, dan yang asal menjadi
nonaktif — tidak dihapus. Seluruh penggabungan tercatat sebagai **satu** Batch,
jadi kalau ternyata salah, satu tombol **Kembalikan seluruh Batch** di halaman
Log Perubahan mengembalikan keadaannya persis seperti semula.

**Kalau yang salah cuma ejaannya → Ganti nama.**
Tekan **Ganti nama**, perbaiki tulisannya, simpan. Nama baru langsung berlaku
untuk semua Karyawan yang memegangnya — tidak ada satu pun baris Karyawan yang
perlu disentuh satu per satu.

**Kalau Temuan itu memang bukan masalah** (dua unit yang kebetulan bernama
mirip tapi memang berbeda), biarkan saja. Halaman ini memang boleh menyisakan
kasus yang sengaja dibiarkan.

Temuan yang sudah dibereskan hilang sendiri dari halaman ini begitu Anda muat
ulang — tidak ada yang perlu ditandai selesai.

---

## 6. Membuat API Key untuk aplikasi lain

Aplikasi HC lain (misalnya aplikasi KPI atau survei) tidak menyimpan salinan
data Karyawan sendiri; mereka mengambilnya dari HC Core memakai sebuah **API
Key**. Satu aplikasi satu key.

1. Buka halaman **API Key** (khusus admin).
2. Tekan **Tambah API Key**.
3. Isi **nama Konsumen** — nama aplikasi yang akan memakainya, misalnya "Perf
   App". Nama ini hanya untuk Anda sendiri mengenali key-nya nanti.
4. Centang **kolom apa saja yang boleh diambil** aplikasi itu. Centang
   seperlunya: kolom yang tidak dicentang akan ditolak, dengan menyebut kolom
   mana yang tidak diizinkan. Kolom Data Pribadi Sensitif tidak ada di daftar
   sama sekali — ia tidak pernah bisa keluar lewat API.
5. Simpan.

> **Key-nya hanya ditampilkan satu kali, saat itu juga.** Salin dan kirimkan ke
> pemilik aplikasinya sebelum menutup kotak dialognya. Sistem menyimpan sidik
> jarinya saja, bukan key-nya, jadi tidak ada seorang pun — termasuk Anda —
> yang bisa membacanya kembali nanti. Kalau terlanjur tertutup: buat key baru
> dan nonaktifkan yang lama.

**Menghentikan akses sebuah aplikasi:** nonaktifkan key-nya di halaman yang
sama. Aplikasi itu langsung ditolak pada permintaan berikutnya. Key tidak pernah
dihapus, jadi jejaknya tetap ada di Log Perubahan.

Kolom **Terakhir dipakai** di tabel menunjukkan aplikasi mana yang masih hidup
dan mana yang sebenarnya sudah tidak memanggil apa-apa lagi.

---

## 7. Halaman lain, sekilas

| Halaman | Isinya |
|---|---|
| **Karyawan** | Daftar, pencarian, penyaring, dan pintu ke setiap halaman detail. |
| **Struktur Organisasi** | Hierarki Unit Organisasi (direktorat → divisi → departemen → bagian → sub bagian, plus proyek), beserta jumlah Karyawan aktif di tiap unit. Tempat menambah, mengganti nama, dan menggabungkan unit. Klik nama unit untuk membuka halaman detailnya: rantai induknya, jumlah Karyawan, dan Riwayat Revisinya. |
| **Jabatan** | Daftar nama pekerjaan. Satu Jabatan boleh dipegang banyak orang sekaligus — ini bukan daftar kursi. Klik namanya untuk detail dan Riwayat Revisi. |
| **Master Data** | Semua daftar pilihan: work contract, person grade, job grade, band jabatan, BoD range, kategori penempatan, kategori fungsi, klasifikasi rekrutmen, teknik/non teknik, gender, legal entity. Klik labelnya untuk detail dan Riwayat Revisi. |
| **Perlu Dibereskan** | Temuan data kotor beserta tombol perbaikannya (bagian 5). |
| **Log Perubahan** | Semua Batch, terbaru di atas, dengan tombol kembalikan (bagian 4). |
| **API Key** | Kredensial aplikasi Konsumen (bagian 6). |
| **Pengguna** | Siapa saja yang bisa masuk, dan sebagai admin atau viewer. |

---

## 8. Yang perlu orang teknis, sekali saja

Langkah-langkah berikut dilakukan **satu kali di awal**, oleh orang yang
memasang aplikasinya. Semuanya ditulis di sini supaya tidak hilang bersama
orang yang memasangnya. Urutannya penting: 8a dulu (memasang), lalu 8b (admin
pertama), lalu 8c (Seed).

### 8a. Memasang aplikasi

Aplikasi ini terdiri dari dua bagian yang dipasang terpisah: **database** di
Supabase dan **aplikasi web** di Vercel. Tidak ada alat baris perintah Supabase
yang dipakai — semuanya lewat layar web keduanya.

**Di Supabase**

1. Buat satu project baru. Catat tiga hal dari **Settings → API**: *Project
   URL*, *anon key*, dan *service_role key*. Yang terakhir **rahasia** — jangan
   pernah ditempel ke mana pun selain langkah Vercel di bawah.
2. Buka **SQL Editor**. Tempel seluruh isi file
   `supabase/migrations/0001_init.sql`, jalankan, tunggu selesai. Lalu tempel
   seluruh isi `supabase/migrations/0002_batch_operations.sql`, jalankan.
   **Urutannya harus begitu.** Keduanya aman dijalankan ulang kalau ragu sudah
   jalan atau belum. Harus lewat SQL Editor, bukan dari aplikasi: file pertama
   memasang penjaga di tabel pengguna Supabase, dan hanya SQL Editor yang punya
   izin untuk itu.
3. Masih di SQL Editor, jalankan satu baris ini supaya database tahu domain
   email kantor:

   ```sql
   alter database postgres set app.allowed_email_domain = 'hutamakarya.com';
   ```

   Nilainya harus **sama persis** dengan `ALLOWED_EMAIL_DOMAIN` di langkah
   Vercel. Kalau lupa, database memakai `hutamakarya.com` sebagai bawaan.
4. Buka **Authentication**:
   - **URL Configuration → Site URL**: alamat aplikasi di Vercel, misalnya
     `https://hc-core.vercel.app`.
   - **URL Configuration → Redirect URLs**: hanya satu,
     `https://<alamat-vercel>/login/callback`. Daftar ini adalah pintu
     keamanan sungguhan — tautan masuk hanya boleh mendarat di alamat yang
     tercantum di sini. Jangan diisi `*`.
   - **Email Templates**: pada template **Magic Link** dan **Invite user**,
     ganti tautan di dalamnya supaya menuju halaman pendaratan aplikasi:
     `{{ .SiteURL }}/login/callback?token_hash={{ .TokenHash }}&type=magiclink`
     untuk Magic Link, dan `…&type=invite` untuk Invite user. Tanpa ini,
     tautan di email mendarat di halaman depan tanpa membawa sesi.
   - **Sign In / Providers → Email**: pastikan *Email* aktif, dan **matikan**
     *Allow new users to sign up*. Aplikasi ini memakai **undangan**: akun
     dibuat oleh admin, bukan oleh orang yang mendaftar sendiri. Cara
     mengundang ada di 8b.

**Di Vercel**

5. Import repositori ini sebagai project baru. Vercel mengenali Next.js
   sendiri; tidak ada pengaturan build khusus.
6. Isi **Environment Variables** — persis empat ini, tidak lebih:

   | Nama | Isi |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | *Project URL* dari langkah 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *anon key* dari langkah 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | *service_role key* dari langkah 1 |
   | `ALLOWED_EMAIL_DOMAIN` | `hutamakarya.com` (sama dengan langkah 3) |

   `HC_SEED_DB_URL` (bagian 8c) **tidak** dipasang di Vercel — itu hanya untuk
   komputer yang menjalankan Seed.
7. Deploy, lalu buka `https://<alamat-vercel>/login`. Halaman **Masuk** harus
   tampil. Kalau yang tampil adalah kalimat "belum dikonfigurasi", periksa
   kembali keempat variabel di langkah 6.

Sesudah ini, lanjut ke 8b: orang pertama diundang, masuk sekali, lalu
dinaikkan jadi admin.

### 8b. Mengundang pengguna, dan admin pertama harus dinaikkan lewat SQL

Karena pendaftaran sendiri dimatikan (8a langkah 4), setiap pengguna baru
**diundang** dulu: di Supabase, buka **Authentication → Users → Invite user**,
isi email kantornya. Email di luar domain kantor ditolak otomatis. Orang itu
menerima email undangan, membuka tautannya, dan masuk. Sesudah admin pertama
ada, undangan tetap dari layar Supabase itu; halaman **Pengguna** di aplikasi
hanya mengatur *siapa jadi apa*, bukan membuat akun.

> Orang yang belum diundang lalu mencoba "Kirim tautan masuk ke email" akan
> melihat kalimat *"Masuk lewat email sedang dimatikan di Supabase. Hubungi
> admin HC Core."* Kalimatnya kurang tepat tetapi arahnya benar: ia memang
> harus minta diundang.

Setiap orang yang baru pertama kali masuk otomatis menjadi **viewer** — termasuk
orang pertama. Artinya, setelah pemasangan selesai, orang pertama yang masuk
tidak bisa melakukan apa pun: tidak ada tombol ubah, halaman Pengguna tertutup,
dan tidak ada siapa pun yang bisa menaikkannya.

Jadi admin pertama dinaikkan langsung di database, satu kali:

```sql
update public.profiles
set role = 'admin'
where email = 'nama.anda@hutamakarya.com';
```

Jalankan di SQL editor Supabase (menu **SQL Editor**) **setelah** orang itu
berhasil masuk sekali — barisnya baru ada setelah masuk pertama. Sesudah itu
admin pertama bisa menaikkan admin berikutnya lewat halaman **Pengguna**, dan
SQL tidak diperlukan lagi selamanya.

> Sebaiknya segera buat **admin kedua** lewat halaman Pengguna. Kalau hanya ada
> satu admin dan akun itu hilang, jalan satu-satunya kembali ke SQL di atas.

### 8c. Menjalankan Seed awal dari Excel

Seed adalah pemasukan data awal dari file Excel "Demografi Karyawan - Posisi",
**sekali jalan**. Sesudahnya Excel pensiun.

Berbeda dari 8a dan 8b, langkah ini **tidak bisa dari peramban**: ia dijalankan
dari satu komputer yang punya Node.js, salinan repositori ini, dan sudah
menjalankan `npm ci` sekali. Kalau tidak ada komputer seperti itu, ini
pekerjaan orang teknis — mintalah, jangan dipaksa.

Seed membutuhkan **sambungan Postgres langsung**, bukan alamat API yang dipakai
aplikasi. Di Supabase: **Settings → Database → "Direct connection"**. Salin
teks sambungannya ke variabel `HC_SEED_DB_URL`:

```
HC_SEED_DB_URL=postgresql://postgres:....@db.xxxxxxxx.supabase.co:5432/postgres
```

Alamat `https://xxxxxxxx.supabase.co` yang dipakai aplikasi **tidak akan
bekerja** di sini, dan itu bukan kesalahan pengetikan Anda — Seed perlu
memasukkan ±1.475 Karyawan sebagai **satu** tindakan yang bisa dibatalkan utuh,
dan hanya sambungan langsung yang bisa melakukannya.

Lalu, dengan urutan ini:

**1. Coba dulu tanpa menulis apa pun.**

```
npx tsx scripts/seed-from-excel.ts "Demografi Karyawan - Posisi.xlsx" --dry-run
```

Perintah ini tidak menyentuh database sama sekali. Ia melaporkan berapa Unit
Organisasi, Jabatan, Lookup, dan Karyawan yang akan dibuat.

**2. Baca daftar "Tidak dikenal".** Di bagian *Kolom*, ada tiga angka:
*Dipetakan*, *Diabaikan (rumus)*, dan **Tidak dikenal**. Kolom rumus memang
sengaja diabaikan (No, Age, Range, Gen, semua "Masa", PG-JG, Keterangan Naik
PG/JG) — itu normal. Tapi setiap kolom yang disebut **Tidak dikenal** adalah
kolom yang **tidak akan masuk sama sekali**. Periksa daftarnya satu per satu:
kalau ada kolom penting di situ, berhenti dan minta bantuan teknis sebelum
lanjut. Baca juga daftar *Peringatan* di bawahnya — Karyawan tanpa unit atau
tanpa jabatan akan muncul di halaman Perlu Dibereskan, dan itu memang disengaja.

**3. Jalankan sungguhan** (perintah yang sama, tanpa `--dry-run`).

**4. Catat "Batch id" yang dicetak di akhir.** Perintahnya menutup dengan
ringkasan seperti:

```
  Batch id        : e64a1e19-3221-4185-9956-f007808b5c0f
  Keterangan      : Seed awal dari Demografi Karyawan - Posisi.xlsx
  Karyawan        : 1475
```

Simpan baris **Batch id** itu. Kalau hasil Seed ternyata salah, buka halaman
**Log Perubahan**, cari Batch tersebut, dan tekan **Kembalikan seluruh Batch**.

> **Yang dilakukan pengembalian itu, tepatnya:** seluruh isi Seed ditandai
> **nonaktif** — bukan dihapus. Di aplikasi ini memang tidak ada yang pernah
> dihapus, jadi setelah dikembalikan, daftar Karyawan terlihat kosong pada
> penyaring "aktif" tetapi ±1.475 orangnya masih ada di penyaring "nonaktif".
> Isi Data Pribadi Sensitif juga tetap tersimpan apa adanya.
>
> Akibat praktisnya: **Seed tidak bisa dijalankan ulang dengan file lain begitu
> saja.** Perintah Seed menolak berjalan kalau tabel Karyawan sudah berisi, dan
> memaksanya akan bentrok dengan Personnel Number yang sudah terpakai. Kalau
> file yang salah terlanjur masuk dan Anda perlu mengulang dari nol, itu
> pekerjaan teknis — hubungi yang memasang aplikasi; jangan dipaksa sendiri.
>
> Karena itu langkah 1 dan 2 di atas (`--dry-run` dan membaca daftar "Tidak
> dikenal") bukan formalitas: **di situlah tempat membatalkan yang murah.**

Kalau Seed gagal di tengah jalan, tidak ada satu baris pun yang tertulis;
perintahnya membatalkan seluruhnya sendiri dan mengatakannya. Yang perlu
kehati-hatian adalah Seed yang **berhasil** dengan file yang keliru.

---

## 9. Kalau ada yang tidak beres

- **"Hanya admin yang boleh…"** — Anda sedang masuk sebagai viewer. Minta admin
  menaikkan role Anda di halaman Pengguna.
- **Halaman bilang "Gagal memuat…"** — tekan **Coba lagi**. Kalau tetap gagal,
  laporkan kalimat yang tertulis di kotak abu-abu, apa adanya; kalimat itu yang
  dibutuhkan orang teknis.
- **Daftar pilihan bilang "belum lengkap"** — database membatasi jumlah baris
  per permintaan, jadi ada pilihan yang benar-benar ada tapi tidak muncul.
  Periksa dulu sebelum menyimpan, dan laporkan.
- **Salah simpan** — jangan diperbaiki dengan mengetik ulang dari ingatan.
  Buka Riwayat Revisi dan tekan **Kembalikan** (bagian 4); itu selalu
  mengembalikan nilai yang benar-benar ada sebelumnya.
- **Perlu menghapus seseorang** — tidak bisa, dan memang tidak seharusnya.
  Tandai nonaktif beserta tanggal keluarnya (bagian 3).
