# ADR-002 — Unit organisasi, jabatan, dan lookup adalah entitas ber-ID; formasi ditunda

Status: Diterima
Tanggal: 2026-09-14

## Konteks
Di Excel, divisi/bagian/jabatan/grade ditulis sebagai teks bebas, sehingga satu entitas muncul dalam banyak varian dan setiap perubahan nomenklatur harus di-find-replace di ratusan baris. Di sisi lain, aplikasi harus jadi secepatnya, dan kebutuhan FTE/WLA (kursi dengan kuota) belum ada datanya.

## Keputusan
Karyawan merujuk Unit Organisasi, Jabatan, dan setiap nilai pilihan lewat **ID** ke tabel referensi yang punya kode tetap dan nama yang boleh diubah. Unit Organisasi disimpan sebagai satu tabel berhierarki (`parent_id`), proyek termasuk sebagai tipe unit. Jabatan adalah *nama pekerjaan*, bukan kursi — konsep Formasi (jabatan × unit × kuota) **tidak** dibangun di fase ini.

## Alternatif yang Ditolak
- **Tabel karyawan flat persis Excel + log revisi** — paling cepat dibangun, tapi rename nomenklatur tetap harus menyentuh ratusan baris, dan pembersihan data tidak punya konsep "entitas yang sama".
- **Tabel terpisah per level (direktorat, divisi, bagian, ...)** — setiap perubahan struktur HK (yang sering) butuh migration; satu tabel berhierarki menampung semua bentuk.
- **Formasi/kursi dari awal** — benar secara model dan berguna untuk WLA, tapi menggandakan kerja CRUD dan datanya (kuota per kursi) belum ada di Excel; ditolak demi kecepatan, bukan karena salah.

## Konsekuensi
- Lebih mudah: rename satu kali berlaku ke semua; merge dua varian jadi operasi yang jelas; Konsumen bisa merujuk unit/jabatan lewat ID yang stabil.
- Lebih mudah: menambah Formasi nanti tinggal menambah tabel `formasi(jabatan_id, org_unit_id, kuota)` tanpa mengubah `employees`.
- Lebih susah: seed dari Excel harus membuat entitas referensi dari nilai kotor apa adanya, lalu dibereskan di aplikasi — halaman "Perlu Dibereskan" dan Merge menjadi fitur wajib, bukan tambahan.
- Lebih susah: form karyawan tidak bisa mengetik bebas; nilai baru harus dibuat dulu di halaman referensi (bisa lewat tombol "tambah baru" di picker).
