# PRD — HC Core (Database Central Karyawan)

## 1. Problem Statement

Data karyawan PT Hutama Karya (Persero) — sekitar 1.400–1.500 orang — hari ini hidup di file Excel yang dikelola divisi Human Capital. File itu sering kececer versinya, nama divisi/bagian/jabatan ditulis bebas sehingga penuh varian dan typo, tidak ada catatan siapa mengubah apa, dan kalau salah edit tidak bisa dibalikkan. Setiap aplikasi HC yang butuh data karyawan akhirnya menyalin Excel sendiri-sendiri, sehingga versi data antar aplikasi tidak pernah sama.

## 2. Target User

| Role | Siapa | Kebutuhan utama |
|---|---|---|
| **Admin** | Staf HC yang memegang data karyawan (awalnya Rie, lalu di-handover ke HC) | Menambah/mengubah data karyawan, unit organisasi, jabatan, dan daftar pilihan; membereskan data kotor; membalikkan perubahan yang salah; mengelola API key |
| **Viewer** | Staf HC lain yang perlu melihat data | Mencari dan membaca data karyawan tanpa bisa mengubah |
| **Konsumen** (aplikasi) | Aplikasi HC lain milik Rie/HC (perf/KPI app, survei EMX-EE, WLA, dll.) | Mengambil sebagian kolom data karyawan lewat API tanpa menyimpan salinan sendiri |

## 3. Solusi (ringkas)

Satu aplikasi web internal yang menjadi **satu-satunya sumber kebenaran** data karyawan: data disimpan di database terpusat, diubah lewat UI CRUD (bukan query manual), setiap perubahan tercatat sebagai revisi yang bisa dibalikkan, dan aplikasi lain mengambil data lewat REST API dengan hak akses per kolom. Excel dipakai sekali saja untuk seed awal, lalu pensiun; pembersihan data dilakukan di dalam aplikasi, bukan di Excel.

## 4. Fitur Must-Have (MVP)

**Data karyawan**
1. Admin bisa melakukan seed awal dari file Excel format "Demografi Karyawan - Posisi" (kolom rumus diabaikan, kolom input dipetakan ke skema).
2. User bisa melihat daftar karyawan dalam tabel dengan pencarian (nama, NIP, Personnel Number) dan filter (unit organisasi, jabatan, status, lookup apa pun).
3. Admin bisa menambah karyawan baru lewat form.
4. Admin bisa mengubah data seorang karyawan lewat form; kolom pilihan (unit, jabatan, grade, dsb.) dipilih dari daftar, bukan diketik bebas.
5. Admin bisa menandai karyawan sebagai nonaktif beserta tanggal keluar; data karyawan tidak pernah dihapus permanen.
6. Sistem otomatis menghitung kolom turunan (usia, masa kerja, masa sejak promosi PG/JG) dari data mentah — kolom ini tidak bisa diedit.

**Data referensi**
7. Admin bisa mengelola unit organisasi sebagai hierarki berkode (direktorat → divisi → departemen → bagian → sub bagian, plus proyek); mengganti nama sebuah unit otomatis berlaku untuk semua karyawan di bawahnya.
8. Admin bisa mengelola daftar jabatan berkode; mengganti nama jabatan otomatis berlaku untuk semua pemegangnya.
9. Admin bisa mengelola daftar pilihan (lookup) untuk kolom: work contract, person grade, job grade, band jabatan, BoD range, kategori penempatan, kategori fungsi, klasifikasi rekrutmen, teknik/non-teknik, gender, legal entity.
10. Admin bisa menggabungkan (merge) dua unit / jabatan / lookup menjadi satu: semua karyawan pindah ke entitas tujuan, entitas asal menjadi nonaktif.

**Pembersihan data**
11. User bisa membuka halaman "Perlu Dibereskan" yang otomatis mendaftar: nama unit/jabatan/lookup yang mirip (beda kapitalisasi, spasi, "dan" vs "&"), unit tanpa induk, karyawan tanpa unit atau jabatan, dan sub bagian yang namanya sama dengan induknya.
12. Dari halaman tersebut admin bisa langsung merge atau rename tanpa pindah halaman.

**Log & revert**
13. Sistem otomatis mencatat setiap perubahan pada tabel mana pun sebagai revisi: sebelum, sesudah, siapa, kapan, dan batch mana.
14. User bisa melihat riwayat revisi seorang karyawan (atau unit/jabatan/lookup) di halaman detailnya.
15. Admin bisa membalikkan satu revisi ("kembalikan ke versi ini") — hasilnya tercatat sebagai revisi baru, bukan menghapus log.
16. User bisa melihat halaman log global berisi semua batch, dan admin bisa membalikkan satu batch utuh (misalnya satu merge atau satu seed).

**API untuk konsumen**
17. Aplikasi konsumen bisa mengambil daftar karyawan lewat REST API dengan memilih kolom yang dibutuhkan dan memfilter (unit, jabatan, status).
18. Aplikasi konsumen bisa mengambil daftar unit organisasi, jabatan, dan lookup lewat REST API.
19. Admin bisa membuat, menonaktifkan, dan melihat API key per konsumen; tiap key punya daftar kolom yang boleh diambil.
20. Sistem menolak permintaan API tanpa key valid, dan menolak kolom di luar daftar yang diizinkan key tersebut.

**Akses**
21. User login dengan email kantor; ada dua role: admin (semua aksi) dan viewer (hanya baca).
22. Tabel data pribadi sensitif (agama, tanggal & tempat lahir, status pernikahan) disiapkan terpisah, kolomnya boleh kosong, hanya bisa dibaca dan diubah oleh admin, dan tidak pernah keluar lewat API.

**Impor lewat web**
23. Admin bisa menjalankan seed awal (#1) dari halaman web tanpa alat teknis: memilih file Excel, membaca pratinjau (apa yang akan dibuat, kolom tidak dikenal, peringatan), lalu menjalankannya; hasilnya satu batch `seed` yang bisa dibalikkan utuh (#16). Hanya berjalan sekali, selama tabel karyawan masih kosong.
24. Admin bisa mengunggah Excel **berulang kali** di atas data yang sudah ada, lewat halaman yang sama: personnel number jadi kuncinya — yang belum ada ditambah, yang sudah ada diperbarui pada kolom yang berubah saja, dan sel Excel yang dikosongkan tidak menghapus isi yang sudah ada. Satu unggahan = satu batch `impor` yang bisa dibalikkan utuh (#16). Templat Excel bisa diunduh dari halaman itu, dan nama kolomnya dijamin sama dengan yang dibaca aplikasi.

## 5. Nice-to-Have (bukan MVP)

- SSO Microsoft Entra (menggantikan login email) — diselesaikan di level portal HC, bukan per aplikasi.
- Formasi/kursi: jabatan × unit dengan kuota, sebagai dasar FTE dan WLA.
- Rumus kelayakan kenaikan PG/JG ("Memenuhi Syarat") dari Excel dipindahkan menjadi aturan bisnis di aplikasi.
- Export ke Excel.
- Endpoint API selain GET (konsumen menulis balik).
- Riwayat posisi eksplisit (valid_from / valid_to per penugasan) — untuk MVP histori diturunkan dari log revisi.

## 6. Non-Goals

- **Tidak ada import berkala dari sistem lain** — tidak ada SAP/HRIS yang menjadi sumber; aplikasi ini sendiri sumber kebenarannya.
- **Tidak ada hapus permanen** untuk karyawan maupun data referensi — hanya status nonaktif; ini yang membuat revert dan referensi dari aplikasi konsumen selalu aman.
- **Tidak menyimpan gaji, penilaian kinerja, sanksi, atau data kesehatan** — di luar lingkup "data demografi & posisi".
- **Tidak ada mobile app** — user internal memakai desktop.
- **Tidak ada workflow persetujuan** (maker–checker) — jumlah admin sedikit dan setiap perubahan bisa dibalikkan.
- **Tidak ada mesin AI/LLM** di dalam aplikasi — deteksi data mirip memakai normalisasi string biasa.

## 7. Ukuran Keberhasilan

- HC berhenti mengedit file Excel "Demografi Karyawan - Posisi" sebagai sumber; semua perubahan dilakukan di aplikasi.
- Minimal satu aplikasi HC lain (mis. perf/KPI app) mengambil data karyawan lewat API dan tidak menyimpan salinan master sendiri.
- Halaman "Perlu Dibereskan" kosong (atau hanya berisi kasus yang sengaja dibiarkan) setelah pembersihan pertama.
- Ada minimal satu kasus revert yang dipakai sungguhan dan berhasil tanpa perlu menyentuh database langsung.

## 8. Constraint

- **Waktu:** dibangun secepatnya; scope dipotong ketat ke must-have di atas.
- **Handover:** akan diserahkan ke staf HC setelah masa magang Rie; dokumen dan UI harus bisa dipahami orang non-teknis.
- **Privasi:** data karyawan adalah data pribadi (UU PDP). Kolom sensitif dipisah dan dibatasi (fitur 22). Penyimpanan di Supabase (cloud pihak ketiga) bersifat sementara dan perlu dikonfirmasi ke atasan; skema harus bisa dipindah ke Postgres mana pun.
- **Lingkungan kerja:** coding sepenuhnya di cloud (Claude Code browser, Git, Vercel) — tidak ada instalasi lokal.
- **Stack:** Next.js + Supabase + Vercel (stack standar semua aplikasi HC Rie, lihat ARCHITECTURE.md).
