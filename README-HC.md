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
3. Isi kata sandi, lalu tekan **Masuk**. Belum punya kata sandi? Akun dibuatkan
   admin lebih dulu — lihat §8b. Tidak ada pendaftaran sendiri dan tidak ada
   "kirim tautan masuk ke email".
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
- **Email Kantor adalah alamat kantor, bukan email pribadi dan bukan akun
  login HC Core.** Kolom ini ikut keluar lewat API, dan biasanya justru inilah
  yang dipakai aplikasi HC lain untuk mencocokkan orang ini dengan akun
  Microsoft-nya. Boleh dikosongkan, tapi satu alamat hanya boleh dimiliki satu
  orang — kalau alamatnya sudah dipakai orang lain, simpan akan ditolak.
- **Data Pribadi Sensitif** punya form sendiri di bawah, khusus admin. Kolomnya
  boleh dikosongkan, dan isinya tidak pernah keluar lewat API. Email **pribadi**
  tidak punya tempat di HC Core sama sekali — jangan menuliskannya di kolom
  Email Kantor.

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
  penyimpanan, satu penggabungan, satu impor Excel — masing-masing satu Batch.

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
penggabungan yang keliru, atau impor yang salah file:

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
pertama), lalu 8c (Impor data Karyawan dari Excel).

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
3. Domain email kantor **sudah tertanam** di file pertama: fungsi
   `handle_new_user` di `0001_init.sql` memakai `hutamakarya.com` kalau tidak
   ada pengaturan lain. **Tidak ada yang perlu dijalankan** di langkah ini.
   Versi lama panduan ini menyuruh menjalankan
   `alter database postgres set app.allowed_email_domain = …`; di Supabase
   perintah itu ditolak dengan `42501: permission denied to set parameter`,
   karena akun `postgres` di sana bukan superuser. Aplikasi tidak
   membutuhkannya — kalau pesan itu muncul, abaikan dan lanjut ke langkah 4.

   Kalau domain kantornya **bukan** `hutamakarya.com`, ganti di tiga tempat
   dan pastikan ketiganya **sama persis**: kata `hutamakarya.com` di dalam
   fungsi `handle_new_user` pada `0001_init.sql` (lalu tempel ulang file itu;
   aman dijalankan ulang), `DEFAULT_ALLOWED_EMAIL_DOMAIN` di
   `lib/auth/domain.ts` (`npm test` menolak kalau keduanya berbeda), dan
   `ALLOWED_EMAIL_DOMAIN` di langkah 6.
4. Buka **Authentication**:
   - **URL Configuration → Site URL**: alamat aplikasi di Vercel, misalnya
     `https://hc-core.vercel.app`.
   - **URL Configuration → Redirect URLs**: hanya satu,
     `https://<alamat-vercel>/login/callback`. Daftar ini adalah pintu
     keamanan sungguhan — tautan masuk hanya boleh mendarat di alamat yang
     tercantum di sini. Jangan diisi `*`.
   - **Email Templates**: pada template **Reset Password** (dan **Invite user**
     kalau Anda memakainya), ganti tautan di dalamnya supaya menuju halaman
     pendaratan aplikasi:
     `{{ .SiteURL }}/login/callback?token_hash={{ .TokenHash }}&type=recovery`
     untuk Reset Password, dan `…&type=invite` untuk Invite user. Tanpa ini,
     tautan di email mendarat di halaman depan tanpa membawa sesi.
   - **Sign In / Providers → Email**: pastikan *Email* aktif, dan **matikan**
     *Allow new users to sign up*. Akun dibuat admin, bukan oleh orang yang
     mendaftar sendiri — caranya di 8b. Aplikasi sendiri sudah tidak punya
     tombol "kirim tautan masuk", jadi ini lapis keduanya di sisi Supabase.

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
   komputer yang menjalankan skrip seed.
7. Deploy, lalu buka `https://<alamat-vercel>/login`. Halaman **Masuk** harus
   tampil. Kalau yang tampil adalah kalimat "belum dikonfigurasi", periksa
   kembali keempat variabel di langkah 6.

Sesudah ini, lanjut ke 8b: orang pertama diundang, masuk sekali, lalu
dinaikkan jadi admin.

### 8b. Mengundang pengguna, dan admin pertama harus dinaikkan lewat SQL

Halaman **Masuk** hanya menerima **email kantor + kata sandi**. Tidak ada
pendaftaran sendiri dan tidak ada "kirim tautan masuk ke email" — keduanya
sengaja tidak ada, karena database ini memuat tanggal lahir, agama, dan status
pernikahan 1.475 orang. Punya alamat @hutamakarya.com tidak sama dengan berhak
membacanya.

Akun karena itu **dibuat admin**, satu per satu, di Supabase:

1. Buka **Authentication → Users → Add user → Create new user**.
2. Isi email kantornya dan sebuah kata sandi awal. Centang *Auto Confirm User*
   supaya ia tidak perlu mengklik apa pun.
3. Serahkan kata sandi itu ke orangnya lewat jalur yang wajar (bukan grup
   WhatsApp bersama).

Email di luar domain kantor tetap ditolak otomatis oleh database, jadi salah
ketik domain gagal saat itu juga, bukan nanti.

Setelah akunnya ada, halaman **Pengguna** di aplikasi mengatur *siapa jadi
apa* — ia tidak pernah membuat atau menghapus akun.

> **Kalau seseorang lupa kata sandinya:** di layar **Authentication → Users**
> yang sama, buka menu titik tiga di barisnya dan pilih *Send password
> recovery*. Tautannya mendarat di aplikasi dan memberinya sesi. (Aplikasi ini
> belum punya halaman ganti kata sandi sendiri; menggantinya untuk sementara
> juga dari layar Supabase itu.)

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

### 8c. Memasukkan data Karyawan dari Excel (Impor)

Impor adalah cara memasukkan data Karyawan dari file Excel. **Boleh dijalankan
berkali-kali** — untuk memasukkan data pertama kali, dan seterusnya setiap kali
ada karyawan baru atau perubahan massal.

**Tiga hal yang menentukan, baca ini dulu:**

- **Personnel Number adalah kuncinya.** Nomor yang belum ada di database akan
  **ditambah**. Nomor yang sudah ada akan **diperbarui** — hanya pada kolom yang
  isinya memang berbeda. Orang yang tidak ada di file sama sekali tidak
  disentuh.
- **Kolom yang Anda kosongkan di Excel TIDAK menghapus data yang sudah ada.**
  File berisi tiga kolom tidak akan mengosongkan kolom-kolom lain. Untuk
  benar-benar mengosongkan sebuah kolom, pakai tombol **Ubah** di halaman
  Karyawan orang itu.
- **Memperbarui orang yang sudah ada? Isi Personnel Number dan kolom yang
  berubah saja — kolom Nama pun boleh dikosongkan.** Namanya sudah ada di
  database dan tidak akan tersentuh. Nama hanya **wajib** untuk Personnel
  Number yang belum ada di database, karena Karyawan baru harus punya nama.
  Jadi untuk mengisi email seluruh perusahaan, cukup dua kolom: Personnel
  Number dan Email Kantor.
- **Nama kolom yang menentukan, bukan urutannya.** Kolom boleh digeser,
  dibuang, atau ditambah. Yang tidak boleh salah adalah nama di baris header.
- **Email Kantor boleh ikut diimpor.** Template punya kolomnya, dan judul
  seperti "Email", "Email Kantor", atau "Work Email" sama-sama dikenali — jadi
  daftar yang dikirim IT biasanya bisa langsung dipakai. Satu alamat hanya
  boleh milik satu orang: kalau ada alamat kembar, impor dibatalkan seluruhnya
  dan tidak ada yang tertulis.

#### Langkahnya

1. Masuk sebagai **admin** (8b). Buka halaman **Karyawan**, lalu tombol
   **Impor dari Excel**. (Kalau daftar Karyawan masih kosong, tombolnya ada di
   kotak besar di tengah halaman.)
2. **Belum punya filenya? Tekan «Unduh template Excel» dulu.** Template itu
   sudah berisi nama-nama kolom yang persis dikenali aplikasi, plus satu baris
   contoh yang boleh Anda hapus atau timpa. Memakai template menghilangkan
   seluruh tebak-tebakan di langkah 4.
3. **Pilih file Excel**-nya. File dibaca di peramban Anda dan **tidak diunggah
   ke mana pun**; yang dikirim ke server nanti hanya daftar yang akan dibuat,
   setelah Anda memeriksanya. Sheet «Demografi Karyawan - Posisi» dipilih
   otomatis; kalau tidak ada, halaman menyebutkan sheet yang tersedia dan Anda
   memilih.
4. **Baca pratinjaunya.** Belum ada yang ditulis.
   - Baris **Dicocokkan ke database** memberi tahu berapa orang di file ini
     yang baru dan berapa yang sudah terdaftar. Kalau angkanya jauh dari
     dugaan Anda — misalnya semuanya "baru" padahal harusnya perbaikan data
     lama — berhenti: kemungkinan besar kolom Personnel Number-nya salah.
   - Di bagian *Kolom* ada tiga angka: *dipetakan*, *diabaikan (rumus)*, dan
     **tidak dikenal**. Kolom rumus memang sengaja diabaikan (No, Age, Range,
     Gen, semua "Masa", PG-JG, Keterangan Naik PG/JG) — itu normal. Tapi setiap
     kolom yang disebut **tidak dikenal** adalah kolom yang **tidak akan masuk
     sama sekali**. Periksa daftarnya satu per satu: kalau ada kolom penting di
     situ, perbaiki nama headernya agar sama dengan template, lalu pilih ulang
     filenya.
   - Baca juga daftar *Peringatan* — Karyawan tanpa unit atau tanpa jabatan
     akan muncul di halaman Perlu Dibereskan, dan itu memang disengaja.
   - Kalau halaman menulis **GAGAL** dengan daftar masalah, tidak ada tombol
     Jalankan: perbaiki Excel-nya dulu.
5. Isi **Keterangan** kalau mau (bawaannya "Impor dari <nama file>"), centang
   **Saya paham**, lalu tekan **Jalankan Impor**. Semuanya masuk sebagai
   **satu** tindakan: gagal di tengah berarti tidak ada satu baris pun yang
   tertulis, dan halaman mengatakannya.
6. **Baca layar selesai.** Ada tiga angka: berapa Karyawan **baru**, berapa
   **diperbarui**, berapa **tidak berubah**. Catat **Batch id**-nya. Kalau
   hasilnya ternyata salah, buka halaman **Log Perubahan**, cari Batch
   tersebut, dan tekan **Kembalikan seluruh Batch** — yang dibalikkan hanya
   perubahan dari Impor itu, bukan yang lain.

> **Kalau file yang sama diunggah dua kali** tidak terjadi apa-apa: halaman
> menolak dengan kalimat "File ini tidak mengubah apa pun", dan tidak ada yang
> tertulis. Mengulang Impor itu aman.
>
> **Yang dilakukan pengembalian Batch, tepatnya:** baris yang ditambahkan Impor
> ditandai **nonaktif** — bukan dihapus — dan baris yang diperbarui
> dikembalikan ke nilai sebelumnya. Di aplikasi ini memang tidak ada yang
> pernah dihapus. Isi Data Pribadi Sensitif juga tetap tersimpan.
>
> Karena itu langkah 4 di atas (membaca pratinjau) bukan formalitas: **di
> situlah tempat membatalkan yang murah.**

**Alternatif untuk orang teknis: skrip.** Logika yang sama tersedia sebagai
perintah di komputer yang punya Node.js dan salinan repositori ini. Butuh
**sambungan Postgres langsung** (Supabase: **Connect → Session pooler**, port
5432, bukan alamat API aplikasi) di variabel `HC_SEED_DB_URL`, lalu:

```
npx tsx scripts/seed-from-excel.ts "Demografi Karyawan - Posisi.xlsx" --dry-run
npx tsx scripts/seed-from-excel.ts "Demografi Karyawan - Posisi.xlsx"
```

Laporan `--dry-run` berisi angka yang sama dengan pratinjau di halaman, dan
hasilnya sama: satu Batch `seed` yang bisa dikembalikan utuh.

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
