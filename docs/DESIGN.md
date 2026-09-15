# Sistem UI "HC Panel"

## Prinsip
- Satu elevasi: hanya kontrol utama layar (biasanya kolom cari) yang diberi bayangan.
- Netral dengan satu aksen: semua warna abu-abu netral, merah HK sebagai aksen merek.
- Daftar-detail: daftar di kiri, panel detail menempel di kanan (desktop).
- Putus-putus berarti belum tersedia.
- Gerak menjelaskan perubahan: animasi hanya untuk muat halaman, pergantian panel, dan umpan balik hover.

## Token warna
| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| latar | #F3F4F6 | #0D0F12 | kanvas halaman, hover baris |
| kartu | #FDFDFD | #15181D | kartu, panel, input |
| tinta | #121418 | #E9ECF0 | teks utama, tombol utama, cincin fokus |
| tinta-hover | #2B2F37 | #F7F8FA | hover tombol utama |
| redup | #5D636E | #9AA1AB | teks pendukung |
| garis | #E0E3E8 | #252A31 | border kartu, pemisah |
| garis-kuat | #C6CBD3 | #3A414B | border input |
| garis-putus | #BCC2CB | #3E4550 | item belum tersedia |
| merah | #C41115 | #F0484E | aksen merek, panah hover, caret, pesan error |
| merah-ikon | #DD2A30 | #F0484E | aksen di ikon generatif dan logo |
| merah-latar | #FBE3E3 | rgb(240 72 78 / .24) | sorotan kata hasil cari |
| sukses | #1E7A4C | #4CC38A | status data, selalu bersama teks atau ikon |
| peringatan | #8A5A00 | #E0A33B | status data, selalu bersama teks atau ikon |

Bayangan kontrol utama: terang `0 1px 2px rgb(18 20 24/.05), 0 12px 28px -16px rgb(18 20 24/.28)`; gelap `0 1px 2px rgb(0 0 0/.4), 0 12px 28px -16px rgb(0 0 0/.9)`. Tooltip dan popover: `0 14px 34px -14px rgb(18 20 24/.35)`.

Pemetaan shadcn/ui: background=latar, card dan popover=kartu, foreground=tinta, muted=latar, muted-foreground=redup, border=garis, input=garis-kuat, primary=tinta, primary-foreground=kartu, secondary=kartu, accent=latar, destructive=merah, ring=tinta. Tambahkan `brand`=merah. Mode gelap memakai mekanisme yang sudah ada di app (next-themes atau prefers-color-scheme) dengan nilai dari kolom Gelap.

## Tipografi
Satu keluarga huruf: Plus Jakarta Sans (variable, subset latin). Angka di tabel pakai `tabular-nums`.

| Peran | Ukuran | Tebal | Catatan |
|---|---|---|---|
| Judul halaman (h1) | clamp(36px, 24px + 2.2vw, 48px) | 700 | line-height 1.05, letter-spacing -0.04em, text-wrap balance, maks 2 baris |
| Judul di panel detail | 24px | 700 | line-height 1.2, -0.025em |
| Judul bagian (h2) | 21px | 700 | line-height 1.25, -0.02em |
| Subjudul halaman | 18px | 400 | warna redup, maks 44ch |
| Judul item | 16px | 650 | line-height 1.35, -0.01em |
| Isi | 16px | 400 | line-height 1.5 |
| Label kelompok, panel, form | 14px | 600-650 | |
| Teks pendukung | 14px | 400-500 | warna redup |
| Mikro (label status, kbd, header tabel) | 12px | 600 | |

## Spasi, bentuk, tata letak
- Skala spasi: 4, 8, 12, 16, 24, 32, 48, 64. Tepi halaman 20px di HP dan 40px mulai 1024px. Lebar maksimum wadah 1240px termasuk tepi.
- Radius: panel 24, kartu dan kolom cari 16, input form 12. Tombol, label, dan chip berbentuk pil.
- Border 1px. Dalam satu kolom, tepi kanan kolom cari, tab, dan kartu sejajar.
- Bar atas: tinggi 64 di HP, 72 di desktop. Kiri: logo 28px dan nama app (16px, 700). Kanan: nama unit (14px, redup, disembunyikan di bawah 640px).
- Pembuka layar: salam opsional (16px, 500, redup), h1, subjudul (maks 20 kata), lalu kontrol utama. Maksimal 4 elemen teks; informasi tambahan masuk ke subjudul.
- Judul bagian: keterangannya ditumpuk di bawah judul (14px, redup).
- Desktop (mulai 1024px): grid `minmax(0,1fr) minmax(320px,400px)`, jarak kolom 64, area `"pembuka panel" "konten panel"`, padding atas 32. Panel `position: sticky; top: 24px`, sejajar dengan baris salam.
- Di bawah 1024px: satu kolom (pembuka lalu konten), jarak antarblok 48, padding atas 24.

## Komponen
- Kolom cari (kontrol utama): label di atas (14px, 600). Input tinggi 60, radius 16, border garis-kuat, latar kartu, bayangan kontrol, teks 16px 500. Ikon kaca pembesar 20px di kiri (padding kiri 52), petunjuk `/` di kanan untuk perangkat berkursor, tombol hapus bulat 36px saat terisi, caret merah. Hover: border redup. Fokus: border tinta dan cincin 1px tinta.
- Tab filter: tombol teks 14px 500 warna redup, tinggi 44, jarak 16, `aria-pressed`. Tab aktif: teks tinta dengan garis bawah 2px tinta di atas garis dasar 1px garis. Satu baris; di HP bisa digeser, dengan tepi memudar (mask-image) saat meluap.
- Kelompok: judul 14px 650 dan jumlah (500, redup). Jarak judul ke kartu 12, antarkelompok 32.
- Kartu item: grid kolom `auto 1fr auto`, area `"ikon nama ujung" "ikon desk desk"`, jarak 4 dan 16, padding 16, radius 16, border garis, latar kartu.
  - Isi: ikon generatif 40px; nama 16px 650; ujung kanan setinggi 22 berisi label status dan panah arrow-up-right 18px; deskripsi 14px redup, maksimal 3 baris.
  - Grid kartu: 1 kolom, 2 kolom mulai 640px, jarak 12.
  - Hover: border tinta, panah jadi merah dan bergeser 2px ke kanan atas.
  - Terpilih (desktop): border tinta. Saat ditekan: scale .99.
- Item belum tersedia: border putus-putus garis-putus, latar transparan, nama redup, ikon versi rencana, label "Segera".
- Label status: pil tinggi 22, padding 0 8, 12px 600, border garis.
- Tombol utama: pil tinggi 48 (di panel) atau 40, latar tinta, teks kartu 600, hover tinta-hover, saat ditekan scale .99. Satu tombol utama per tampilan.
- Tombol sekunder: pil, latar kartu, border garis-kuat, teks tinta.
- Input form: label di atas (14px 600), tinggi 44, radius 12, border garis-kuat. Teks bantuan di bawah (14px redup). Pesan error di bawah (14px merah dengan ikon warning-circle).
- Tabel: header 12px 600 redup, baris 14px setinggi 48, pemisah 1px antarbaris, angka rata kanan, hover baris berlatar latar. Baris terpilih berlatar latar dengan teks 600, dan isinya tampil di panel detail.
- Keadaan kosong: kotak border putus-putus radius 16, padding 32 dan 24, judul 18px 700, satu kalimat ajakan, satu tombol aksi.
- Kaki halaman: garis atas 1px, padding 24 0 48, teks 14px redup (tanggal diperbarui, kontak).
- Ikon UI: Phosphor Icons gaya regular. Ikon item selalu dari GenerativeIcon.
- Logo (warna lewat token):
  `<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="tinta"/><path d="M9 9H24A15 15 0 0 1 9 24Z" fill="latar"/><circle cx="31.5" cy="16.5" r="7.5" fill="merah-ikon"/><rect x="9" y="24" width="15" height="15" fill="latar"/><path d="M24 39H39A7.5 7.5 0 0 0 24 39Z" fill="latar"/></svg>`

## Pola daftar-detail
Dipakai di setiap layar yang menampilkan daftar entitas (aplikasi, karyawan, proses, KPI, survei, dan sejenisnya).

Panel detail (radius 24, padding 24, border garis, latar kartu):
1. Kepala: label "Detail <entitas>" (14px 650) dan petunjuk "Arahkan kursor ke item untuk melihat detailnya." (14px redup).
2. Garis pemisah, lalu isi berupa flex kolom dengan min-height tetap (460px untuk susunan di bawah), supaya posisi tombol tidak berpindah.
3. Urutan isi:
   - ikon generatif 96px;
   - kategori dan label status (14px 500 redup);
   - judul 24px 700;
   - deskripsi 16px redup;
   - daftar `dl` dua kolom (label redup, nilai 500), hanya baris yang ada datanya.
4. Area aksi menempel di bawah (margin-top auto, padding atas 32), berisi tombol utama selebar panel. Untuk item yang belum tersedia, tombol diganti catatan berbingkai putus-putus.

Perilaku:
- Desktop: item terpilih saat kursor berhenti 120ms di atasnya (hover intent). Fokus keyboard langsung memilih item.
- Klik item menjalankan aksi utama item (buka link atau buka halaman detail). Tombol di panel menjalankan aksi yang sama.
- Saat mencari, panel mengikuti hasil teratas, dan Enter menjalankan aksi hasil teratas.
- Kalau filter menyembunyikan item terpilih, pilih item pertama yang terlihat. Pilihan awal: item tersedia pertama.
- Id item terpilih disimpan di URL (`?pilih=<id>`, pakai `router.replace`) supaya bisa dibagikan dan bertahan saat reload.
- Tanda terpilih di daftar hanya tampil saat panel terlihat.
- Di bawah 1024px panel disembunyikan. Ketuk item menjalankan aksi utama, atau membuka halaman detail `/<entitas>/<id>` kalau ada.

## Ikon generatif
Satu nama selalu menghasilkan ikon yang sama di semua app, jadi fungsi berikut disalin persis.

```ts
const BENTUK = ["kotak", "bulat", "seperempat", "setengah", "segitiga", "kosong"] as const;
type Bentuk = (typeof BENTUK)[number];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function hash(teks: string) {
  let h = 2166136261;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pengacak(benih: number) {
  let a = benih;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rancangIkon(nama: string) {
  const acak = pengacak(hash(norm(nama)));
  const pilih = (tanpaKosong: boolean): Bentuk => BENTUK[Math.floor(acak() * (tanpaKosong ? 5 : 6))];
  const gelap = acak() < 0.55;
  const isi: Bentuk[] = [pilih(false), pilih(false), pilih(false), pilih(false)];
  for (let i = 0; i < 4 && isi.filter((b) => b !== "kosong").length < 3; i++) {
    if (isi[i] === "kosong") isi[i] = pilih(true);
  }
  const aksen = acak() < 0.5 ? Math.floor(acak() * 4) : -1;
  const sel = isi.map((jenis, i) => ({ jenis, i, putar: Math.floor(acak() * 4) * 90, aksen: i === aksen }));
  return { gelap, sel: sel.filter((s) => s.jenis !== "kosong") };
}
```

Aturan render (viewBox `0 0 48 48`, `aria-hidden`):
- Latar: `rect x=0.75 y=0.75 width=46.5 height=46.5 rx=12`.
  - Kalau `gelap`: isi tinta.
  - Kalau tidak: isi kartu, stroke garis-kuat 1.25 dengan `vector-effect: non-scaling-stroke`.
- Sel ke-i: x = 9 + (i % 2) × 15, y = 9 + floor(i / 2) × 15, sisi 15. Tiap sel dibungkus `<g transform="rotate(putar, x+7.5, y+7.5)">`.
- Bentuk:
  - kotak: `rect`
  - bulat: `circle r=7.5`
  - seperempat: `M x y H x+15 A 15 15 0 0 1 x y+15 Z`
  - setengah: `M x y H x+15 A 7.5 7.5 0 0 1 x y Z`
  - segitiga: `M x y H x+15 L x y+15 Z`
- Warna bentuk: tinta di latar terang, kartu di latar gelap, merah-ikon untuk sel aksen.
- Versi rencana (belum tersedia): latar tanpa isi dengan stroke garis-putus bergaris putus `3 3`; semua bentuk berwarna garis-putus.
- Ukuran: 40 di kartu, 96 di panel.

## Gerak
- Kurva:
  - keluar: `cubic-bezier(0.16, 1, 0.3, 1)`
  - standar: `cubic-bezier(0.33, 1, 0.68, 1)`
  - pantul: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Muat halaman (sekali):
  - Salam, h1, subjudul, dan kontrol utama naik 14px sambil muncul dalam 700ms dengan kurva keluar. Tundanya 0, 60, 110, dan 170ms.
  - Bentuk di ikon membesar dari 0.2 ke 1 dalam 420ms dengan kurva pantul. Tundanya 260ms, ditambah 40ms per item (maksimal 16 item) dan 55ms per bentuk.
- Ganti isi panel: naik 6px sambil muncul dalam 240ms, dan ikon panel dirakit ulang.
- Hover dan fokus: warna dan border berganti dalam 150ms; panah bergeser dalam 200ms dengan kurva standar.
- `prefers-reduced-motion: reduce`: semua animasi dan transisi dimatikan.

## Aksesibilitas
- Cincin fokus: outline 2px tinta dengan offset 2px (di tab, offset -2px).
- Pintasan keyboard:
  - `/` dan Ctrl/Cmd+K: fokus ke kolom cari.
  - Esc: mengosongkan pencarian.
  - Panah bawah dari kolom cari: pindah ke item pertama.
  - Panah antaritem: mengikuti posisi visual.
  - Home/End: ke item pertama/terakhir.
- Hasil cari diumumkan lewat `role="status"`, dan teksnya terlihat hanya saat mencari.
- Sediakan link "Lewati ke konten". Target sentuh minimal 44px, kontras teks minimal 4.5:1.
- Dalam `forced-colors`, kartu, panel, dan input diberi border CanvasText.

## Tulisan
- Bahasa Indonesia, sentence case. Label tanpa titik; kalimat bantuan diakhiri titik.
- Tombol diawali kata kerja: "Buka aplikasi", "Simpan perubahan".
- Jeda kalimat memakai koma, titik dua, atau kurung.
- Kata ulang berhubung seperti "masing-masing" dibungkus `white-space: nowrap`.
- Keadaan kosong ditulis sebagai ajakan beserta langkah berikutnya.

## Batas gaya
- Permukaan datar dengan warna solid.
- Satu warna aksen (merah HK). Warna sukses dan peringatan hanya untuk status data.
- Status ditunjukkan dengan label teks.
- Keterangan judul selalu di bawah judul.
- Ikon hanya dari Phosphor, GenerativeIcon, dan logo.

## Checklist selesai
- [ ] Semua warna, ukuran huruf, spasi, radius, dan bayangan berasal dari token.
- [ ] Setiap layar punya tepat satu elemen berbayangan.
- [ ] h1 maksimal 2 baris, dan pembuka maksimal 4 elemen teks.
- [ ] Layar daftar entitas memakai pola daftar-detail dan tetap berfungsi di HP.
- [ ] Ikon item berasal dari GenerativeIcon dengan fungsi yang sama persis.
- [ ] Mode terang, gelap, reduced motion, dan navigasi keyboard sudah dicek.
- [ ] Tidak ada scroll horizontal di lebar 320, 390, 768, 1024, dan 1440.
- [ ] Semua fitur lama masih berjalan.
