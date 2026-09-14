# ADR-004 — Aplikasi lain mengambil data lewat REST API dengan API key ber-whitelist kolom, bukan akses Supabase langsung

Status: Diterima
Tanggal: 2026-09-14

## Konteks
Beberapa aplikasi HC lain (perf/KPI, survei EMX-EE, WLA, dll.) butuh data karyawan. Sampai sekarang mereka menyalin Excel sendiri-sendiri. Sebagian besar aplikasi itu memakai Supabase juga, sehingga menghubungkan mereka langsung ke database yang sama secara teknis paling gampang.

## Keputusan
Konsumen hanya boleh mengambil data lewat `GET /api/v1/*` dengan API key per konsumen. Setiap key punya `allowed_fields`; permintaan kolom di luar itu ditolak seluruhnya. Kolom Data Pribadi Sensitif tidak pernah tersedia lewat API. Route API membaca dari view `v_employees_api` memakai service-role client — satu-satunya tempat service role dipakai saat runtime.

## Alternatif yang Ditolak
- **Konsumen connect langsung ke Supabase project yang sama (schema/role read-only)** — paling cepat, tapi setiap perubahan skema memecahkan semua konsumen sekaligus, tidak ada cara membatasi kolom per aplikasi selain bikin view/role per aplikasi, dan tidak ada catatan aplikasi mana yang menarik apa.
- **Supabase auto-generated REST (PostgREST) dengan anon key + RLS** — RLS berbasis user login, bukan aplikasi; tidak ada konsep "key milik app X boleh kolom Y".
- **GraphQL** — fleksibilitas pemilihan kolomnya menarik, tapi menambah tooling dan pola baru untuk konsumen yang semuanya cukup dengan `fields=a,b,c`.

## Konsekuensi
- Lebih mudah: skema internal boleh berubah selama `v_employees_api` dan kontrak v1 tetap; whitelist per key membuat kebijakan privasi bisa dilihat di satu halaman.
- Lebih mudah: `last_used_at` per key memberi tahu aplikasi mana yang masih hidup.
- Lebih susah: aplikasi HC yang sudah ada dan sudah terhubung ke Supabase harus dimigrasi ke API (bisa bertahap).
- Lebih susah: satu lapisan kode lagi yang harus dirawat; tanpa rate limiting di fase 1, konsumen yang salah loop bisa membebani database.
- Terkunci: kontrak v1 tidak boleh berubah bentuk setelah ada konsumen; perubahan besar berarti v2.
