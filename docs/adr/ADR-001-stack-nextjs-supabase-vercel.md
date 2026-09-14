# ADR-001 — Next.js + Supabase + Vercel, tanpa ORM

Status: Diterima
Tanggal: 2026-09-14

## Konteks
Aplikasi dibangun secepatnya oleh satu orang yang coding sepenuhnya di cloud (tidak bisa install apa pun di laptop kantor), memakai AI-assisted development, dan akan di-handover ke staf HC non-teknis. Semua aplikasi HC lain yang sudah ada memakai Next.js + Supabase + Vercel, dan mereka akan menjadi Konsumen aplikasi ini.

## Keputusan
Memakai Next.js (App Router) di Vercel dengan Supabase sebagai Postgres + Auth + RLS, tanpa ORM — skema dikelola lewat SQL migration polos.

## Alternatif yang Ditolak
- **Postgres self-hosted / VPS** — tidak bisa dikelola dari laptop kantor tanpa instalasi, dan tidak ada yang merawat servernya setelah handover.
- **Airtable / Google Sheets sebagai database** — tidak punya trigger, RLS, dan revisi per baris yang bisa dibalikkan; ini persis masalah Excel yang mau diselesaikan.
- **Prisma / Drizzle** — trigger revisi dan RLS adalah inti sistem dan hidup di SQL; ORM menambah lapisan yang menyembunyikan justru bagian yang paling penting untuk diaudit.
- **Framework lain (Django, Laravel)** — menambah stack baru yang tidak dipakai aplikasi HC lain, mempersulit handover dan integrasi.

## Konsekuensi
- Lebih mudah: setup nol-instalasi, deploy otomatis dari Git, satu stack untuk semua aplikasi HC.
- Lebih mudah: skema tetap Postgres standar, jadi bisa dipindah ke Postgres yang dikelola HK kalau kebijakan mewajibkan.
- Lebih susah: **data karyawan berada di cloud pihak ketiga (Supabase)**. Ini harus dikonfirmasi ke atasan. Mitigasi: kolom paling sensitif dipisah dan bisa dibiarkan kosong; skema portable.
- Lebih susah: logika penting (trigger, RLS, view) hidup di SQL, bukan TypeScript — orang yang meneruskan harus mau membaca migration.
