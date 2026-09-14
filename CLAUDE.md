# CLAUDE.md — HC Core

## Project
Database central data karyawan PT Hutama Karya (±1.500 orang) dengan UI CRUD, log revisi yang bisa di-revert, dan REST API untuk aplikasi HC lain. Aplikasi ini **sumber kebenaran** — tidak ada import dari sistem lain; Excel hanya dipakai sekali untuk seed. Dipakai staf HC (admin/viewer) dan akan di-handover ke orang non-teknis.

## Dokumen
- `PRD.md` — scope, non-goals, fitur bernomor; baca sebelum menambah/mengubah fitur.
- `ARCHITECTURE.md` — data model, data flow, aturan verifiable; baca sebelum membuat file/tabel baru.
- `API-CONTRACT.md` — kontrak `/api/v1`; jangan ubah bentuk response v1.
- `ROADMAP.md` — fase & exit criteria; kerjakan fase berurutan.
- `CONTEXT.md` — glosarium; pakai istilah di sana di UI, nama file, dan diskusi.
- `docs/adr/` — keputusan yang tidak boleh "diperbaiki" tanpa ADR baru.

## Stack
Next.js 15 App Router + TypeScript · Supabase (Postgres, Auth, RLS) · Vercel · Tailwind + shadcn/ui · TanStack Table · react-hook-form + zod · SheetJS (seed saja). Tanpa ORM.

## Commands
- `npm run dev` — dev server
- `npm run lint` · `npm run typecheck` — wajib hijau sebelum commit
- `npm test` — cek nama kolom (`check:columns`) + unit test (`lib/cleaning`, `lib/revisions/revert`, `lib/api/fields`)
- `npm run db:local` — start Postgres lokal, pasang `db/local/00-shim.sql` + `supabase/migrations/0001_init.sql`, jalankan `scripts/verify-schema.sql`
- `npm run gen:types` — regenerate `lib/types/db.ts` & `lib/schema/columns.generated.ts` dari database lokal (menggantikan `supabase gen types`, yang tidak bisa jalan di sini — lihat ADR-005)
- `npx tsx scripts/seed-from-excel.ts <file.xlsx>` — seed awal, sekali saja

Supabase CLI (`supabase db push`, `supabase gen types`) **tidak tersedia** dan `supabase.com` diblokir proxy. Skema diverifikasi terhadap PostgreSQL 16 lokal; lihat ADR-005.

## Struktur
```
app/(auth)/login · app/(app)/{karyawan,struktur,jabatan,master-data,bereskan,log,api-keys,pengguna}
app/api/v1/{employees,org-units,jabatan,lookups}
lib/{supabase,db,actions,revisions,cleaning,api,derived,validation}
components/ · scripts/seed-from-excel.ts · supabase/migrations/ · docs/adr/
```

## Aturan
- Semua tulisan ke DB dari UI lewat Server Action di `lib/actions/`, dibungkus `withBatch({ jenis, keterangan })`. Tidak ada insert/update di Client Component.
- **Tidak ada `DELETE`** ke tabel data (`employees`, `employee_private`, `org_units`, `jabatan`, `lookups`, `api_keys`) — di kode maupun migration. Pakai `status = 'nonaktif'`.
- Log revisi ditulis oleh **trigger**, bukan kode. Tabel data baru wajib dipasangi trigger `log_revision` di migration yang sama.
- Revert selalu membuat revisi baru. Jangan pernah `UPDATE`/`DELETE` tabel `revisions` atau `batches` selain mengisi `reverted_by_batch_id`.
- `lib/supabase/admin.ts` (service role) hanya boleh di-import oleh `app/api/v1/**` dan `scripts/**`.
- Route `api/v1` hanya membaca `v_employees_api`, `org_units`, `jabatan`, `lookups`. Tidak pernah `employee_private` / `v_employees_private`.
- Kolom referensi di `employees` selalu FK (uuid) ke `org_units` / `jabatan` / `lookups`. Jangan tambah kolom teks bebas untuk hal yang punya daftar.
- Kolom turunan (usia, masa kerja) dihitung di view atau `lib/derived/`; jangan disimpan.
- Skema hanya berubah lewat file di `supabase/migrations/` — jangan ubah dari dashboard Supabase. **`0001_init.sql` adalah satu-satunya file migration**; ubah di dalamnya, jangan tambah `0002_*.sql` (ADR-005).
- `lib/types/db.ts` dan `lib/schema/columns.generated.ts` **auto-generated** — jangan diedit tangan; ubah migration lalu `npm run db:local && npm run gen:types`.
- `components/ui/*` beku — pakai, jangan ubah.
- Jangan menambah dependency. Semua yang dibutuhkan sudah ada di `package.json` (ADR-005).
- Setiap `page.tsx` di `app/(app)/**` dan `route.ts` di `app/api/v1/**` wajib `export const dynamic = "force-dynamic"` (ADR-005 §6).
- Daftar `tipe` lookup harus sama di `lib/validation/lookupTypes.ts` dan CHECK constraint migration.
- Error API memakai satu envelope `{ error: { code, message, details } }` (lihat API-CONTRACT).
- Cek role di Server Action **dan** RLS — keduanya, bukan salah satu.
- Penamaan: tabel/kolom `snake_case`; file TS `camelCase.ts`; komponen `PascalCase.tsx`. Bahasa UI Indonesia.
- Jangan pernah commit data karyawan sungguhan — fixture dan test pakai data dummy.
- Sebelum fitur baru: cek nomornya ada di PRD §4. Kalau tidak ada, itu scope creep — tanya dulu.

## Konteks Penting
- Business key karyawan = `personnel_number` (bukan `nip`); FK internal tetap `id` uuid.
- `org_units` satu tabel berhierarki; **proyek** adalah tipe unit di bawah divisi. Karyawan menunjuk unit **terendah**; direktorat/divisi/bagian diturunkan lewat view.
- **Jabatan ≠ formasi/kursi.** Banyak orang boleh punya jabatan yang sama. Formasi sengaja ditunda (ADR-002).
- Data seed sengaja masuk **kotor** (varian nama, typo). Pembersihan lewat halaman Bereskan + Merge, bukan lewat script.
- `keterangan_rangkap_1/2`, `nomor_surat_pg/jg` berasal dari kolom Excel yang headernya duplikat — jangan digabung.
- Excel sumber punya ±12 kolom rumus (No, Age, Range, Gen, semua "Masa", PG-JG, Keterangan Naik PG/JG) yang **diabaikan** saat seed; Jurusan & Teknik/Non Teknik adalah VLOOKUP dari sheet lain — diisi manual atau kosong.
- Env wajib: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `ALLOWED_EMAIL_DOMAIN`.
- Penyimpanan di Supabase bersifat sementara & perlu konfirmasi kebijakan; jaga skema tetap Postgres standar.
