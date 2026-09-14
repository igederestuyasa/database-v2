# ADR-005 — Pinning versi stack, vendoring shadcn/ui, dan harness verifikasi lokal

Status: Diterima
Tanggal: 2026-09-14

## Konteks

ARCHITECTURE.md §1 memilih stack-nya, tapi tidak menyebut versi. Saat fondasi ini
dibangun, beberapa paket sudah pindah major version, dan lingkungan kerja punya
tiga batasan keras yang mengubah cara kerja:

- **`supabase.com` diblokir egress proxy (403).** Tidak ada project Supabase yang
  bisa dibuat atau dihubungi. `supabase` CLI juga tidak tersedia, jadi
  `supabase db push` dan `supabase gen types` tidak bisa dijalankan.
- **`ui.shadcn.com` tidak bisa dijangkau sama sekali.** `npx shadcn init` dan
  `npx shadcn add` pasti gagal.
- **`vercel.com` tidak bisa dijangkau.** Tidak ada langkah deploy di fase ini.

Yang tersedia: registry npm, PostgreSQL 16 lokal, Node 22, dan Google Fonts.

Fondasi ini dipakai serentak oleh banyak orang yang bekerja paralel. Setiap
dependency yang belum terpasang, setiap tipe yang salah, dan setiap nama kolom
yang cuma hidup di dalam string adalah sumber konflik atau bug diam-diam.

## Keputusan

### 1. Versi di-pin persis (bukan range)

`package.json` menyebut versi eksak untuk semua dependency, dan
`package-lock.json` ikut di-commit. **Tidak ada unit lain yang boleh menambah
dependency** — kalau ada yang kurang, itu kesalahan fondasi dan harus dibetulkan
di sini, bukan ditambal per unit.

| Paket | Pin | Alasan |
|---|---|---|
| `next` | `15.5.25` | ARCHITECTURE.md §1 dan ADR-001 menimbang Next.js **15**. Next 16 sudah rilis, tapi lompat major tanpa ADR baru bukan keputusan yang pernah diambil. |
| `react` / `react-dom` | `19.1.0` | Pasangan yang dites bersama Next 15.5. |
| `typescript` | `5.9.3` | TypeScript 7 adalah compiler baru (rewrite Go). Risiko yang tidak perlu untuk fondasi yang 18 orang pakai serentak. |
| `tailwindcss` | `3.4.19` + `tailwind.config.ts` | **Lihat §2 — ini pembalikan keputusan awal.** |
| `tailwindcss-animate` | `1.0.7` | Plugin animasi untuk Tailwind 3 (padanan `tw-animate-css` di v4). |
| `postcss` / `autoprefixer` | `8.5.28` / `10.6.0` | Rantai PostCSS klasik yang dibutuhkan Tailwind 3. |
| `@supabase/supabase-js` | `2.116.0` | |
| `@supabase/ssr` | `0.12.7` | Client cookie-session untuk App Router. |
| `@tanstack/react-table` | `8.21.3` | v9 baru saja rilis dan mengubah API. Dokumen desain menulis "TanStack Table" saat v8 adalah yang stabil. |
| `react-hook-form` | `7.88.0` | |
| `zod` | `4.6.5` | |
| `@hookform/resolvers` | `5.9.1` | Versi yang mendukung zod v4. |
| `xlsx` (SheetJS) | `0.18.5` | **Lihat §5.** |
| `lucide-react` | `0.577.0` | Ikon untuk komponen shadcn. Tetap di jalur 0.x yang dipakai shadcn. |
| `cmdk` | `1.1.1` | Dipakai `components/ui/command.tsx` (combobox EntityPicker). |
| `sonner` + `next-themes` | `2.0.8` / `0.4.6` | Toast. `next-themes` adalah dependency `components/ui/sonner.tsx`. |
| `date-fns` | `4.4.0` | Format tanggal di `lib/derived/` dan UI. |
| `class-variance-authority` / `clsx` / `tailwind-merge` | `0.7.1` / `2.1.1` / `3.7.0` | Fondasi styling komponen shadcn. |
| Radix primitives | lihat `package.json` | Satu paket per komponen yang di-vendor. |
| `vitest` | `3.2.7` | v4 baru; v3 stabil dan cukup. |
| `eslint` | `9.39.5` | `eslint-config-next@15` belum mendukung ESLint 10. |
| `tsx` | `4.23.13` | Menjalankan script TypeScript (seed, generator tipe). |
| `pg` + `@types/pg` | `8.23.0` / `8.23.1` | **devDependency, harness saja** — lihat §4. |

### 2. Tailwind 3, bukan Tailwind 4 (pembalikan)

Rencana awal adalah Tailwind 4 (CSS-first, tanpa `tailwind.config.js`). Itu
dibatalkan begitu ketahuan `ui.shadcn.com` tidak bisa dijangkau.

Karena primitif shadcn harus **ditulis tangan** (§3), konvensi yang dipakai
adalah konvensi shadcn yang mapan: token warna HSL di `@layer base`, dipetakan
lewat `theme.extend.colors` di `tailwind.config.ts`, plus
`tailwindcss-animate`. Tailwind 4 memindahkan semua itu ke `@theme` di CSS dan
membuat setiap komponen yang di-vendor jadi terjemahan manual — kerja tambahan
tanpa pembaca yang mengecek hasilnya.

Konsekuensi: ada `tailwind.config.ts` di root (tidak disebut di ARCHITECTURE.md
§2, tapi wajib untuk Tailwind 3).

### 3. shadcn/ui di-vendor dengan tangan

`components/ui/*` ditulis langsung di repo di atas Radix +
`class-variance-authority` + `tailwind-merge`, bukan hasil `shadcn add`.
Yang tersedia: `button`, `input`, `textarea`, `label`, `select`, `checkbox`,
`dialog`, `alert-dialog`, `dropdown-menu`, `table`, `tabs`, `badge`, `card`,
`separator`, `popover`, `command`, `form`, `sonner`, `skeleton`, `tooltip`.

**Direktori ini beku.** Unit lain memakainya, tidak mengubahnya.

Yang sengaja **tidak** di-vendor:

- **`calendar` / `react-day-picker`** — komponen calendar shadcn ditulis untuk
  react-day-picker v9, sedangkan npm sekarang di v10 dengan API berbeda.
  Kolom tanggal memakai `<Input type="date">`: lebih sederhana, sudah
  terlokalisasi browser, dan cukup untuk staf HC.
- **`drawer` / `vaul`** — PRD §6 menyatakan tidak ada mobile app; desktop saja.

### 4. Tipe database di-generate dari Postgres lokal, bukan ditulis tangan

`supabase gen types` tidak bisa jalan. Menulis `lib/types/db.ts` dengan tangan
berarti tipe bisa melenceng dari migration tanpa ada yang tahu.

Sebagai gantinya `scripts/gen-types-from-pg.ts` membaca katalog database yang
sudah dipasangi `0001_init.sql` (`information_schema` + `pg_proc`) dan menulis:

- `lib/types/db.ts` — `Database['public']['Tables'][T]['Row'|'Insert'|'Update']`,
  `['Views'][V]['Row']`, dan `['Functions']`, persis bentuk yang diharapkan
  `@supabase/supabase-js`.
- `lib/schema/columns.generated.ts` — daftar nama kolom setiap relasi.

Alurnya: `npm run db:local && npm run gen:types`. Hasilnya di-commit.

`pg` dipakai **hanya** oleh script ini. Bukan ORM, tidak dipakai kode aplikasi,
jadi tidak melanggar ADR-001 ("tanpa ORM").

**Kedua file itu auto-generated — jangan diedit tangan.** Mengubah tipe berarti
mengubah migration lalu regenerate.

Catatan nullability view: PostgreSQL tidak melacak nullability lewat definisi
view, jadi `information_schema` melaporkan semua kolom view sebagai nullable.
Generator punya daftar kecil `VIEW_NOT_NULL` untuk kolom yang datang langsung
dari tabel penggerak view (`employees`, tidak pernah outer-join) — dan generator
gagal keras kalau daftar itu menyebut kolom yang sudah tidak ada.

### 5. `xlsx` 0.18.5 meskipun ada CVE

npm hanya menyediakan SheetJS sampai `0.18.5`, yang punya CVE prototype
pollution dan ReDoS. Build yang sudah dipatch hanya ada di CDN SheetJS sendiri,
dan CDN itu diblokir proxy lingkungan ini.

Penerimaan risiko: `xlsx` **hanya** dipakai `scripts/seed-from-excel.ts`, satu
kali, dijalankan manual oleh admin, atas satu file Excel internal yang
tepercaya. Tidak pernah diimpor kode runtime, tidak pernah menyentuh input dari
pengguna atau Konsumen. Kalau nanti muncul kebutuhan upload Excel dari UI
(PRD §5, di luar MVP), keputusan ini harus ditinjau ulang lebih dulu.

### 6. Aturan tetap: `export const dynamic = "force-dynamic"`

Setiap `page.tsx` di bawah `app/(app)/**` dan setiap `route.ts` di bawah
`app/api/v1/**` **wajib** mengekspor:

```ts
export const dynamic = "force-dynamic";
```

Dua alasan, dan keduanya berlaku:

1. Tanpa itu, `next build` mencoba prerender halaman terhadap URL Supabase yang
   tidak bisa di-resolve dari mesin build, dan build gagal.
2. Secara substansi memang benar: semua data di aplikasi ini adalah data hidup,
   tidak ada satu pun yang layak di-cache saat build.

`app/(app)/layout.tsx` juga mengeksporkannya, jadi seluruh segmen dinamis; tiap
halaman tetap mengulang supaya aturannya ikut pindah kalau file-nya dipindah.

### 7. Nama kolom di dalam string diperiksa mesin

TypeScript tidak melihat ke dalam string
`supabase.from("v_employees").select("personel_number")`. Salah ketik di situ
lolos compile dan baru gagal di database. `scripts/check-select-columns.ts`
memeriksa setiap literal `.select()` dan argumen kolom `.eq()/.order()/...` di
`lib/`, `app/`, dan `components/` terhadap `lib/schema/columns.generated.ts`,
dan ikut jalan di `npm test`.

Kalau pemeriksa itu salah menuduh, tulis komentar `hc-check-columns-ignore` di
baris sebelumnya beserta alasannya.

### 8. Harness verifikasi lokal

- `db/local/00-shim.sql` — tiruan minimal Supabase (schema `auth`, `auth.users`,
  `auth.uid()/jwt()/role()`, role `anon`/`authenticated`/`service_role`).
  **Sengaja di luar `supabase/migrations/`** supaya tidak pernah ikut ke
  produksi. `tests/migrationInvariants.test.ts` menjaga agar isinya tidak bocor
  ke migration.
- `scripts/db-local.sh` — start Postgres, buat ulang database uji, pasang shim,
  pasang migration apa adanya, jalankan verifikasi.
- `scripts/verify-schema.sql` — membuktikan perilaku, bukan sekadar jalan:
  trigger revisi, auto-batch, guard siklus, larangan DELETE, dan RLS yang
  benar-benar menolak viewer.

### 9. Tiga pengetatan keamanan di luar ARCHITECTURE.md §5

Ketiganya menutup lubang yang bukan salah ketik melainkan konsekuensi desain,
jadi dicatat di sini supaya tidak "diperbaiki" balik oleh orang berikutnya.

- **`revisions` tidak boleh dibaca bebas.** `revisions.after` adalah salinan
  jsonb baris yang berubah, jadi policy `select ... using (true)` akan
  menyerahkan persis apa yang RLS tolak di tempat lain: Data Pribadi Sensitif
  lewat `table_name = 'employee_private'`, dan `key_hash` lewat
  `table_name = 'api_keys'`. Policy `revisions_select` karena itu menyembunyikan
  kedua `table_name` itu dari non-admin; sisa log tetap terbaca semua yang login
  sesuai matriks §5. Diuji di `verify-schema.sql` §16.
- **`v_employees_private` tidak pernah di-grant ke `service_role`.**
  `service_role` menembus RLS, jadi `security_invoker` tidak melindungi apa pun
  di sana. Tanpa grant, route `app/api/v1/**` yang salah menyebut view itu gagal
  dengan "permission denied" — bukan diam-diam mengirim tanggal lahir dan agama
  ke Konsumen. Script seed tetap bisa menulis tabel `employee_private`
  langsung.
- **`begin_batch` default `p_local => true`.** Mode sesi (`false`) hanya aman
  kalau pemanggil memegang koneksinya sendiri; di koneksi pooled, satu request
  yang gagal sebelum `end_batch()` mewariskan `app.batch_id` ke request
  berikutnya, sehingga tulisan admin lain ikut masuk ke batch itu — dan
  "kembalikan batch ini" ikut membatalkan pekerjaan mereka. Yang berbahaya
  sekarang harus diminta eksplisit. Gerbang admin di `begin_batch` juga
  memeriksa ada-tidaknya JWT, bukan berhasil-tidaknya `auth.uid()` di-resolve,
  supaya token rusak ditolak alih-alih disangka script tepercaya.

### 10. Dua penyimpangan kecil dari ARCHITECTURE.md §3, dicatat di sini

- **`log_revision` mengabaikan tulisan housekeeping.** UPDATE yang satu-satunya
  perubahannya `updated_at` dan/atau `api_keys.last_used_at` tidak menghasilkan
  Revisi. Tanpa ini, setiap panggilan API dari Konsumen (yang menyentuh
  `last_used_at`) akan menambah satu baris `revisions` dan mengubur perubahan
  yang sungguhan. Perubahan kolom lain apa pun tetap selalu dicatat, jadi janji
  ADR-003 utuh. Diuji dua arah di `verify-schema.sql` §11.
- **`v_employees_private` memakai INNER JOIN.** Untuk viewer, seluruh baris
  `employee_private` tersaring RLS, sehingga view ini mengembalikan **nol
  baris** — bukan baris dengan kolom sensitif NULL. Halaman untuk viewer harus
  memakai `v_employees`.

Juga: `masa_kerja_tahun` adalah tahun penuh dan `masa_kerja_bulan` adalah
**sisa** bulan setelah tahun penuh (0–11), bukan total bulan.

### 11. Yang tidak dibuat di fondasi ini — dan yang WAJIB menyusul

- **`middleware.ts` — belum ada, dan ini lubang yang harus ditutup unit login.**
  Selama file itu belum ada: (a) tidak ada batas otentikasi di depan
  `app/(app)/**`, jadi unit pertama yang mengganti `PagePlaceholder` dengan
  Server Component sungguhan akan merilis halaman tanpa login; (b)
  `@supabase/ssr` hanya bisa me-refresh access token yang kedaluwarsa dari
  middleware, sehingga `catch` di `lib/supabase/server.ts` menelan refresh dan
  tab yang lama terbuka kehilangan sesi tanpa jalan pulih. Unit login harus
  membuat `middleware.ts` yang me-refresh sesi **dan** mengalihkan pengunjung
  tanpa sesi ke `/login`. Fondasi tidak membuatnya supaya tidak bentrok dengan
  unit yang memang memilikinya.
- **`app/api/v1/**`** — milik unit Fase 4. Aturan §6 (`force-dynamic`) berlaku
  untuk mereka.
- **Deploy Vercel** — `vercel.com` tidak bisa dijangkau.

### 12. Kekurangan yang diketahui: perubahan role tidak tercatat

`profiles` tidak dipasangi trigger `log_revision`, karena ARCHITECTURE.md §3
menyebut enam tabel data secara eksplisit dan seluruh pekerjaan paralel
(terutama unit revert) dikodekan terhadap angka enam itu. Akibatnya: admin yang
menaikkan akun lain dari `viewer` ke `admin` tidak meninggalkan jejak di
`revisions`, tidak muncul di halaman Log Perubahan, dan tidak bisa dikembalikan
— padahal justru itu perubahan yang paling layak diaudit (PRD #13 sendiri
berbunyi "perubahan pada tabel mana pun").

Menambah trigger ketujuh adalah perubahan yang benar, tapi menyentuh kontrak
yang sudah dibekukan untuk banyak orang. Karena itu ditunda ke ADR tersendiri,
bukan diselundupkan ke sini. Kalau diambil nanti: pasang `log_revision` di
`profiles`, tambahkan `'profiles'` ke daftar `table_name` yang khusus admin di
policy `revisions_select` (email + role semua orang tidak boleh terbaca viewer),
dan perbarui assertion "6 tabel data" di `scripts/verify-schema.sql` dan
`tests/migrationInvariants.test.ts`.

## Alternatif yang Ditolak

- **Ikut Next.js 16 / TypeScript 7 / Tailwind 4 / TanStack Table 9** — semuanya
  "terbaru", semuanya lompatan major yang tidak pernah ditimbang ADR mana pun,
  dan kegagalannya akan menimpa 18 pekerjaan paralel sekaligus. Mengikuti versi
  yang ditulis dokumen desain lebih murah daripada menjelaskan kenapa build-nya
  rusak.
- **Menunggu akses Supabase sebelum menulis skema** — memblokir semua pekerjaan
  lain tanpa batas waktu. PostgreSQL 16 lokal memverifikasi seluruh permukaan
  SQL: trigger, RLS, view, constraint. Yang tidak terverifikasi hanyalah
  Supabase Auth yang sesungguhnya.
- **Menulis `lib/types/db.ts` dengan tangan** — bisa, tapi langsung melenceng
  dari migration dan tidak ada yang tahu sampai query gagal di produksi.
- **Menyalin komponen shadcn dari mirror pihak ketiga** — sumber tidak
  terverifikasi untuk kode yang jadi seluruh permukaan UI aplikasi.
- **Membiarkan `npm run check:columns` jadi warning saja** — warning di build
  yang sibuk tidak pernah dibaca.

## Konsekuensi

- Lebih mudah: satu `npm install` memberi semua yang dibutuhkan setiap unit;
  tidak ada yang perlu (atau boleh) menambah dependency.
- Lebih mudah: `npm run db:local` memberi database sungguhan dalam hitungan
  detik, tanpa Docker dan tanpa Supabase.
- Lebih mudah: tipe dan daftar kolom tidak bisa melenceng dari migration, karena
  keduanya dibaca dari database yang dibangun oleh migration itu.
- Lebih susah: ada `tailwind.config.ts` yang tidak disebut ARCHITECTURE.md §2,
  dan `components/ui/*` adalah kode yang kita rawat sendiri — memperbarui
  shadcn nanti berarti menulis ulang, bukan `shadcn add`.
- Lebih susah: menambah kolom berarti tiga langkah, bukan satu — ubah
  `0001_init.sql`, `npm run db:local`, `npm run gen:types`.
- Terkunci: `0001_init.sql` adalah satu-satunya file migration. Selama belum ada
  project Supabase, perubahan skema dilakukan **di dalam file itu**, bukan
  dengan menambah `0002_*.sql`. Begitu skema sudah pernah di-push ke database
  yang berisi data, aturan ini harus diganti ADR baru.
