# ROADMAP — HC Core

Aturan main: fase berikutnya baru mulai setelah exit criteria fase sekarang bisa didemokan. Nomor fitur merujuk ke PRD.md §4.

## Fase 0 — Setup
**Scope:** repo GitHub, project Supabase, project Vercel, skeleton Next.js + Tailwind + shadcn, `lib/supabase/{client,server,admin}.ts`, environment variable, migration pertama kosong.
**Exit criteria:** `npm run dev` jalan; kedua file `supabase/migrations/*.sql` terpasang lewat SQL Editor Supabase (prosedurnya di README-HC §8a — Supabase CLI tidak dipakai, ADR-005) dan `npm run db:local` lulus; deploy kosong di Vercel bisa dibuka; halaman `/login` tampil.

## Fase 1 — Skema, seed, dan baca
**Scope:** fitur **1, 2, 6, 21, 22** (skema penuh + RLS + trigger revisi & profiles; seed dari Excel; login 2 role; daftar karyawan dengan search/filter; halaman detail read-only dengan kolom turunan).
Termasuk: migration semua tabel dan view, trigger `log_revision` (walaupun UI belum bisa menulis — supaya seed sudah tercatat sebagai batch), `scripts/seed-from-excel.ts`.
**Exit criteria:** seed dari Excel asli berhasil masuk ~1.475 karyawan dalam satu batch `seed` (lewat halaman `/karyawan/impor`, PRD #23/#24, atau skrip `scripts/seed-from-excel.ts`); viewer bisa login dan mencari karyawan berdasarkan nama/NIP; admin bisa melihat kolom private, viewer tidak; `select` langsung dari `employee_private` sebagai viewer ditolak RLS.

## Fase 2 — Tulis & revert
**Scope:** fitur **3, 4, 5, 7, 8, 9, 13, 14, 15** (form tambah/edit/nonaktifkan karyawan; CRUD unit organisasi berhierarki, jabatan, lookups; riwayat revisi di halaman detail; revert satu revisi).
Termasuk: semua Server Action (satu statement, tanpa membuka Batch sendiri — ADR-006), komponen `EntityPicker` (pilih unit/jabatan/lookup), `RevisionList`.
**Exit criteria:** admin mengubah divisi seorang karyawan → muncul di riwayat dengan before/after → klik "kembalikan" → data kembali dan riwayat bertambah satu revisi `revert`; rename sebuah divisi → semua karyawan di bawahnya menampilkan nama baru tanpa ada baris karyawan yang berubah; viewer tidak melihat tombol edit dan Server Action-nya menolak jika dipanggil paksa.

## Fase 3 — Pembersihan & log global
**Scope:** fitur **10, 11, 12, 16** (merge unit/jabatan/lookup; halaman "Perlu Dibereskan"; halaman log global; revert per batch).
Termasuk: `lib/cleaning/*` dengan unit test untuk normalisasi, `MergeDialog`, halaman `/log`.
**Exit criteria:** halaman Bereskan menampilkan pasangan "Divisi QHSSE" / "DIVISI QHSSE" sebagai mirip → merge dari halaman itu → semua karyawan pindah, unit lama nonaktif, satu batch `merge` muncul di log → revert batch → keadaan kembali persis, termasuk status unit lama. Setelah pembersihan pertama pada data asli, halaman Bereskan kosong atau hanya berisi kasus yang sengaja dibiarkan.

## Fase 4 — API konsumen
**Scope:** fitur **17, 18, 19, 20** (endpoint `api/v1/*`, halaman API Keys dengan whitelist kolom, validasi key & kolom).
Termasuk: `lib/api/*` dengan unit test untuk pemotongan `fields`, view `v_employees_api`.
**Exit criteria:** key baru dibuat untuk "Perf App" dengan whitelist 4 kolom → `curl` dengan key itu mengembalikan tepat 4 kolom → minta kolom kelima → 403 dengan nama kolomnya → key dinonaktifkan → 401. Satu aplikasi HC lain sungguhan sudah mengganti salinan Excel-nya dengan panggilan ke endpoint ini.

## Fase 5 — Handover
**Scope:** bukan fitur; menjadikan aplikasi bisa dijalankan tanpa Rie.
Termasuk: `README-HC.md` berbahasa Indonesia non-teknis (cara login, cara ganti data, cara membalikkan kesalahan, cara bikin API key), akun admin untuk staf HC, penambahan admin kedua, cek `CLAUDE.md` masih cocok dengan kode.
**Exit criteria:** seorang staf HC (bukan Rie) berhasil: mengubah jabatan satu karyawan, membalikkannya, dan membuat API key — hanya dengan membaca README.

## Setelah MVP (parkiran, bukan komitmen)

- Batch add karyawan **berulang** via upload Excel (seed awal sekali-jalan lewat web sudah ada: PRD #23, ADR-008).
- SSO Microsoft Entra — di level portal HC.
- Formasi/kursi (jabatan × unit × kuota) untuk FTE & WLA.
- Rumus kelayakan kenaikan PG/JG sebagai aturan bisnis.
- Export Excel.
- Riwayat posisi eksplisit (`valid_from/valid_to`) jika query histori dari `revisions` terasa lambat/ribet.
- Rate limiting API.
- Webhook ke konsumen saat data berubah. (Parameter `updated_since` untuk tarik-inkremental **sudah ada** — lihat API-CONTRACT.)
- Pindah dari Supabase ke Postgres yang dikelola HK jika kebijakan mewajibkan.
