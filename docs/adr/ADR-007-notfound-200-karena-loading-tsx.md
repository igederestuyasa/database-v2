# ADR-007 — `notFound()` menjawab HTTP 200 di halaman yang punya `loading.tsx`, dan itu dibiarkan

Status: Diterima
Tanggal: 2026-09-15
Terkait: ADR-005 §6 (`force-dynamic`), PRD §2 (pemakai internal), PRD §6 (tidak ada mobile app, tidak ada SEO)

## Konteks

Membuka `/karyawan/<id yang tidak ada>` menampilkan halaman "Halaman tidak
ditemukan" yang benar, tetapi **status HTTP-nya `200`, bukan `404`**.

Dugaan pertama — "ini akibat `export const dynamic = "force-dynamic"`, jadi
mengenai semua halaman" — **salah**, dan itu penting karena dugaan itu akan
membuat orang berikutnya mencoba membatalkan ADR-005 §6. Perilakunya diukur
langsung terhadap `next start` (Next.js 15.5.25, build produksi, bukan `next
dev`), dengan halaman-halaman percobaan sekali pakai:

| Halaman percobaan | `dynamic` | `loading.tsx` | Status |
|---|---|---|---|
| `notFound()` langsung | `force-dynamic` | tidak ada | **404** |
| `await` 120 ms lalu `notFound()` | `force-dynamic` | tidak ada | **404** |
| idem, di dalam `(app)` + layout async | `force-dynamic` | tidak ada | **404** |
| idem, segmen dinamis `[id]` | `force-dynamic` | tidak ada | **404** |
| `await` 120 ms lalu `notFound()` | `force-dynamic` | **ada** | **200** |
| `loading.tsx` di segmen **induk** | `force-dynamic` | **ada** | **200** |
| `/karyawan/<bukan uuid>` apa adanya | `force-dynamic` | ada (dua) | **200** |
| `/karyawan/<bukan uuid>`, kedua `loading.tsx` dibuang | `force-dynamic` | tidak ada | **404** |

Jadi penyebabnya satu hal saja: **`loading.tsx`**. File itu memasang batas
`<Suspense>` di sekeliling segmen, Next langsung mengalirkan kerangka halaman
beserta skeleton-nya, dan begitu byte pertama terkirim baris status sudah
terkunci pada `200`. `notFound()` yang datang sesudahnya tetap merender halaman
yang benar — ia dikirim sebagai bagian dari stream yang sama — tapi tidak bisa
lagi mengubah status. `force-dynamic` tidak ada hubungannya: tanpa
`loading.tsx`, halaman `force-dynamic` yang menunggu 120 ms pun tetap menjawab
`404`.

Yang terkena hanya dua halaman, karena hanya dua halaman yang memanggil
`notFound()`: `/karyawan/[id]` dan `/karyawan/[id]/edit`.

## Keputusan

**Dibiarkan.** `loading.tsx` tetap ada di semua halaman, dan kedua halaman itu
tetap menjawab `200` sambil menampilkan halaman "tidak ditemukan".

Alasannya, berurutan dari yang paling menentukan:

1. **Tidak ada pembaca status di jalur itu.** Pemakai HC Core adalah staf HC
   yang membuka aplikasi di browser (PRD §2). Mereka membaca halaman, bukan
   header. Tidak ada mesin pencari (aplikasi internal di balik login), tidak ada
   aplikasi konsumen (Konsumen memakai `/api/v1`, bukan halaman HTML), dan tidak
   ada mobile app (PRD §6).
2. **Tempat yang status-nya memang dibaca sudah benar.** `/api/v1/**` adalah
   Route Handler, bukan halaman: ia menyusun `NextResponse` sendiri lengkap
   dengan status, jadi `404 NOT_FOUND` di API-CONTRACT.md tetap `404` betulan.
   Itu dijaga `tests/apiV1Routes.test.ts`. Kontrak yang punya pembaca mesin
   tidak ikut cacat ini.
3. **Harga memperbaikinya nyata, dan dibayar di halaman yang paling sering
   dibuka.** Satu-satunya perbaikan yang berhasil dalam pengukuran di atas
   adalah menghapus `loading.tsx` — dari `/karyawan/[id]` **dan** dari induknya
   `/karyawan`. Artinya Daftar Karyawan (±1.500 baris, `force-dynamic`, satu
   putaran penuh ke database setiap kali dibuka) kehilangan skeleton-nya dan
   berganti jadi layar kosong sampai datanya tiba. Menukar layar-kosong di
   halaman yang dibuka setiap hari demi tiga digit yang tidak dibaca siapa pun
   adalah pertukaran yang salah arah.
4. **Tidak ada jalan tengah.** Memindahkan pencarian "Karyawan ini ada tidak?"
   ke lebih awal tidak menolong: yang mengunci status adalah batas `<Suspense>`
   itu sendiri, bukan urutan `await` di dalam halaman — halaman percobaan yang
   `notFound()` di baris pertama pun menjawab `200` begitu `loading.tsx` ada.
   Menangkapnya di `middleware.ts` menuntut middleware menanyakan ke database
   apakah satu baris ada, untuk setiap permintaan.

## Alternatif yang Ditolak

- **Membuang `loading.tsx` dari `/karyawan` dan `/karyawan/[id]`** — satu-satunya
  perbaikan yang terbukti bekerja, dan harganya persis poin 3 di atas.
- **Membuang `export const dynamic = "force-dynamic"`** — ditolak dua kali:
  pengukuran menunjukkan itu bukan penyebabnya, dan ADR-005 §6 memasangnya
  karena `next build` gagal tanpa itu.
- **Mengganti `notFound()` dengan `redirect("/karyawan?...")`** — `redirect()`
  dari segmen yang sudah mengalir kena batasan yang sama, dan menukar halaman
  "tidak ditemukan" yang jelas dengan daftar yang tiba-tiba muncul kembali.
- **Merender halaman "tidak ditemukan" sendiri (bukan `notFound()`) lalu
  memasang status lewat header** — status sudah terkirim; tidak ada API Next
  yang bisa menariknya kembali.

## Konsekuensi

- Sebuah pemantau uptime atau pemeriksa tautan yang diarahkan ke URL Karyawan
  yang sudah tidak ada akan melaporkannya "sehat". Kalau nanti benar-benar ada
  yang memantau per-Karyawan, arahkan ke `/api/v1/employees/{personnel_number}`
  yang memang menjawab `404`.
- Kalau suatu hari Next.js memperbaiki ini di hulu (atau HC Core pindah ke
  Partial Prerendering), status akan berubah sendiri jadi `404` tanpa ada yang
  perlu disunting. Tidak ada kode yang bergantung pada `200` di sini.
- Jangan "memperbaiki" ini dengan menghapus `loading.tsx` tanpa ADR baru:
  hasilnya benar, tapi yang dibayar adalah halaman yang paling sering dibuka.
