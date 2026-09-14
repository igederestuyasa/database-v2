# ADR-003 — Log revisi generik lewat trigger database; revert = revisi baru; tidak ada hapus permanen

Status: Diterima
Tanggal: 2026-09-14

## Konteks
Kebutuhan inti: setiap perubahan pada data apa pun tercatat dan bisa dibalikkan, termasuk perubahan pada data referensi dan operasi massal (merge, seed). Aplikasi dibangun dengan AI-assisted coding lintas banyak sesi, sehingga aturan "setiap jalur tulis harus mencatat log" gampang terlewat kalau bergantung pada disiplin kode.

## Keputusan
Satu tabel `revisions` (table_name, row_id, before, after, batch_id, actor, waktu) diisi oleh **trigger `AFTER INSERT OR UPDATE`** di semua tabel data. Perubahan dikelompokkan dalam `batches` lewat session variable `app.batch_id`; jika tidak di-set, trigger membuat batch otomatis. Revert dilakukan dengan menulis keadaan `before` sebagai revisi baru — log tidak pernah diubah atau dihapus. Tidak ada `DELETE` pada tabel data; entitas dinonaktifkan lewat `status`.

## Alternatif yang Ditolak
- **Log ditulis oleh kode aplikasi di tiap Server Action** — satu Server Action yang lupa memanggil logger berarti perubahan tanpa jejak; trigger tidak bisa dilewati.
- **Tabel histori terpisah per entitas (`employees_history`, `org_units_history`, ...)** — lebih "rapi" secara tipe, tapi setiap tabel baru butuh tabel histori dan UI riwayat baru; satu tabel generik + `jsonb` membuat halaman riwayat dan log global sama untuk semua entitas.
- **Revert dengan menghapus revisi / mengubah log** — memutus jejak audit; kalau revert-nya sendiri salah, tidak ada jalan kembali.
- **Soft delete dengan `deleted_at` + hard delete berkala** — Konsumen menyimpan ID karyawan; hapus permanen memecahkan referensi mereka dan tidak bisa di-revert.

## Konsekuensi
- Lebih mudah: satu mekanisme untuk riwayat per baris, log global, revert per revisi, revert per batch, dan seed yang bisa dibatalkan utuh.
- Lebih mudah: menambah tabel baru = pasang satu trigger, langsung ikut ter-log.
- Lebih susah: `before`/`after` adalah `jsonb` — revert harus memetakan kembali ke kolom; kalau skema tabel berubah (kolom dihapus), revisi lama bisa berisi kolom yang tidak ada lagi. Aturan: migration yang menghapus kolom harus menyertakan cara revert menanganinya (abaikan kolom tak dikenal).
- Lebih susah: tabel `revisions` tumbuh terus; untuk ~1.500 karyawan ini tidak masalah bertahun-tahun, tapi tidak ada mekanisme arsip.
- Lebih susah: histori posisi (siapa di mana kapan) harus diturunkan dari log, bukan dibaca dari tabel khusus.
