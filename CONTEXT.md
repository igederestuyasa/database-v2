# HC Core

Konteks tunggal: data master karyawan PT Hutama Karya (Persero) dan segala yang merujuk padanya. Aplikasi ini adalah sumber kebenaran; tidak ada sistem lain yang menyuplai data ke dalamnya.

## Language

**Karyawan**:
Satu orang pegawai HK, diidentifikasi secara bisnis oleh Personnel Number. Tetap ada di sistem setelah keluar, dengan status nonaktif.
_Avoid_: employee (di UI), pegawai, staf, user

**Personnel Number**:
Kode unik dan stabil seorang Karyawan; kunci yang dipakai Konsumen untuk merujuk seseorang.
_Avoid_: PERNR, NIP (NIP adalah kode kedua yang berbeda)

**Status Karyawan**:
Keadaan seorang Karyawan: `aktif` atau `nonaktif`. Nonaktif menggantikan penghapusan.
_Avoid_: dihapus, resign (sebagai status), deleted

**Unit Organisasi**:
Satu simpul dalam hierarki organisasi HK (direktorat, divisi, departemen, bagian, sub bagian, atau proyek), punya kode tetap dan nama yang boleh berubah.
_Avoid_: org unit (di UI), departemen (sebagai istilah umum), business unit

**Jabatan**:
Nama pekerjaan yang bisa dipegang banyak Karyawan sekaligus di banyak Unit Organisasi. Bukan kursi.
_Avoid_: posisi, position, role, formasi

**Formasi**:
Kursi spesifik: satu Jabatan di satu Unit Organisasi dengan kuota. Belum ada di sistem; istilah ini dicadangkan agar tidak tertukar dengan Jabatan.
_Avoid_: posisi, seat, slot

**Lookup**:
Satu nilai pilihan berkode di dalam satu tipe daftar (mis. `job_grade` → "Pratama III - 13"). Punya kode tetap dan label yang boleh berubah.
_Avoid_: enum, master (sendirian), opsi, dropdown

**Master Data**:
Nama halaman UI yang memuat semua tipe Lookup. Bukan istilah untuk data karyawan.
_Avoid_: master (untuk data karyawan), referensi

**Data Referensi**:
Istilah payung untuk Unit Organisasi, Jabatan, dan Lookup — hal-hal yang dirujuk Karyawan lewat ID.
_Avoid_: master data (yang itu nama halaman), kamus

**Data Pribadi Sensitif**:
Kolom yang disimpan terpisah dan hanya boleh dilihat admin: agama, tanggal & tempat lahir, status pernikahan. Tidak pernah keluar lewat API.
_Avoid_: data rahasia, PII (di UI)

**Revisi**:
Satu versi tersimpan dari satu baris tabel, lengkap dengan keadaan sebelum dan sesudah, pelaku, waktu, dan Batch-nya.
_Avoid_: log (untuk satu perubahan), history entry, audit row, versi

**Batch**:
Sekumpulan Revisi yang terjadi karena satu tindakan (satu simpan, satu merge, satu seed, satu revert). Satuan yang bisa dibalikkan utuh.
_Avoid_: transaksi, commit, sesi

**Revert**:
Tindakan mengembalikan satu Revisi atau satu Batch ke keadaan sebelumnya dengan membuat Revisi baru; log tidak pernah dihapus atau diubah.
_Avoid_: undo, rollback, hapus perubahan, restore

**Merge**:
Menggabungkan satu Data Referensi (asal) ke yang lain (tujuan): semua Karyawan yang merujuk asal dipindah ke tujuan, asal menjadi nonaktif dan mencatat tujuan.
_Avoid_: gabung (di kode), dedup, hapus duplikat

**Seed**:
Batch sekali jalan yang memasukkan data awal dari file Excel, waktu database masih kosong. Istilah historis: sejak Impor ada, ini nama untuk unggahan pertama saja.
_Avoid_: migrasi data, sync

**Impor**:
Mengunggah Excel ke database yang sudah berisi, berulang kali. Personnel Number adalah kuncinya: yang belum ada ditambah, yang sudah ada diperbarui pada kolom yang berubah. Sel Excel yang kosong tidak mengosongkan data yang sudah ada. Satu Impor = satu Batch jenis `impor` yang bisa dikembalikan utuh.
_Avoid_: sinkronisasi, migrasi data, upload massal, update massal

**Perlu Dibereskan**:
Halaman yang mendaftar temuan data kotor (nama mirip, unit tanpa induk, karyawan tanpa unit/jabatan). Istilah untuk temuannya: **Temuan**.
_Avoid_: anomali, data quality issue, error data

**Konsumen**:
Aplikasi lain yang mengambil data lewat API dengan satu API Key.
_Avoid_: client, aplikasi eksternal, integrasi

**API Key**:
Kredensial satu Konsumen; menyimpan daftar kolom yang boleh diambil (whitelist).
_Avoid_: token, secret, credential

**Admin / Viewer**:
Dua role pengguna UI: admin boleh mengubah apa pun dan melihat Data Pribadi Sensitif; viewer hanya membaca.
_Avoid_: superuser, editor, read-only user
