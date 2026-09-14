# API CONTRACT — HC Core (v1)

API ini hanya untuk **Konsumen** (aplikasi HC lain). UI internal tidak memakai endpoint ini — UI memakai Server Actions.

## Konvensi Umum

- **Base path:** `/api/v1`
- **Auth:** header `Authorization: Bearer <api_key>`. Key dibuat admin di halaman API Keys, format `hck_` + 40 karakter acak, hanya ditampilkan sekali. Server menyimpan SHA-256-nya.
- **Hanya GET** di v1. Method lain → `405`.
- **Response sukses:**
  ```json
  { "data": [...] | {...}, "meta": { "page": 1, "per_page": 100, "total": 1475 } }
  ```
  `meta` hanya ada pada endpoint daftar.
- **Response error (satu format untuk semua endpoint):**
  ```json
  { "error": { "code": "FIELD_NOT_ALLOWED", "message": "Kolom tidak diizinkan untuk key ini", "details": { "fields": ["person_grade_label"] } } }
  ```
- **Status code:** `200` ok · `400` query tidak valid · `401` key tidak ada/tidak dikenal/nonaktif · `403` kolom di luar whitelist · `404` tidak ditemukan · `405` method salah · `500` error server.
- **Tanggal:** `YYYY-MM-DD`. Timestamp: ISO 8601 UTC.
- **Pagination:** `page` (default 1), `per_page` (default 100, max 500).
- **Pemilihan kolom:** `fields=a,b,c`. Wajib pada `/employees`. Kolom harus ada di `v_employees_api` **dan** di `allowed_fields` key. Kalau ada satu saja yang tidak boleh → `403`, tidak dieksekusi sebagian.
- **Kolom yang tidak pernah tersedia lewat API:** semua kolom `employee_private` (`date_of_birth`, `place_of_birth`, `religion`, `marital_status`, `usia`).
- **Versi:** perubahan yang memecah bentuk response → `/api/v2`; `v1` tidak diubah bentuknya setelah ada konsumen.

## Kolom `v_employees_api` yang bisa diminta

Identitas: `id`, `personnel_number`, `nip`, `full_name`, `status`, `tanggal_keluar`
Posisi: `org_unit_id`, `org_unit_kode`, `org_unit_nama`, `org_unit_tipe`, `direktorat_nama`, `divisi_nama`, `departemen_nama`, `bagian_nama`, `sub_bagian_nama`, `proyek_nama`, `jabatan_id`, `jabatan_kode`, `jabatan_nama`, `keterangan_pj_plt`, `keterangan_rangkap_1`, `keterangan_rangkap_2`
Lookup (tiap satu `*_kode` dan `*_label`): `gender`, `work_contract`, `person_grade`, `job_grade`, `legal_entity`, `klasifikasi_rekrutmen`, `teknik_non_teknik`, `bod_range`, `band_jabatan`, `kategori_penempatan`, `kategori_fungsi`
Tanggal & surat: `original_start_date`, `tanggal_diangkat`, `tanggal_promosi_pg`, `nomor_surat_pg`, `tanggal_promosi_jg`, `nomor_surat_jg`
Turunan: `masa_kerja_tahun`, `masa_kerja_bulan`, `masa_pg_tahun`, `masa_jg_tahun`
Lain: `jurusan`, `keterangan`, `updated_at`

## Endpoints

### GET /api/v1/employees — daftar karyawan
**Auth:** API key aktif
**Request (query):**
- `fields` string, **wajib** — daftar kolom dipisah koma
- `status` `aktif` | `nonaktif` | `semua`, default `aktif`
- `org_unit_id` uuid, opsional — termasuk semua unit di bawahnya (`include_children=true`, default true)
- `jabatan_id` uuid, opsional
- `updated_since` timestamp, opsional — hanya baris yang berubah setelah waktu ini (untuk konsumen yang mau sync inkremental)
- `search` string, opsional — cocok sebagian pada `full_name`, `nip`, `personnel_number`
- `page`, `per_page`
**Response 200:**
```json
{
  "data": [
    { "personnel_number": "00000001", "full_name": "…", "divisi_nama": "Divisi Infrastruktur I", "jabatan_nama": "Site Operations Manager" }
  ],
  "meta": { "page": 1, "per_page": 100, "total": 1475 }
}
```
**Error:** `400 FIELDS_REQUIRED` kalau `fields` kosong; `400 UNKNOWN_FIELD` kalau kolom tidak ada di view; `403 FIELD_NOT_ALLOWED` kalau ada di view tapi di luar whitelist key.

### GET /api/v1/employees/{personnel_number} — satu karyawan
**Auth:** API key aktif
**Request:** path `personnel_number`; query `fields` (opsional — default semua kolom di whitelist key)
**Response 200:** `{ "data": { ...kolom } }`
**Error:** `404 NOT_FOUND`. Karyawan nonaktif tetap dikembalikan (dengan `status: "nonaktif"`).

### GET /api/v1/org-units — daftar unit organisasi
**Auth:** API key aktif (tidak dibatasi whitelist — struktur organisasi bukan data pribadi)
**Request:** `status` (default `aktif`), `tipe` opsional, `parent_id` opsional
**Response 200:**
```json
{ "data": [ { "id": "…", "kode": "DIV-HC", "nama": "Divisi Human Capital", "tipe": "divisi", "parent_id": "…", "status": "aktif" } ] }
```

### GET /api/v1/jabatan — daftar jabatan
**Auth:** API key aktif
**Request:** `status` (default `aktif`)
**Response 200:** `{ "data": [ { "id", "kode", "nama", "status" } ] }`

### GET /api/v1/lookups — daftar pilihan
**Auth:** API key aktif
**Request:** `tipe` **wajib** (mis. `job_grade`), `status` default `aktif`
**Response 200:** `{ "data": [ { "id", "tipe", "kode", "label", "urutan", "status" } ] }`
**Error:** `400 UNKNOWN_LOOKUP_TYPE`.

## Yang tidak ada di v1 (sengaja)

- Tidak ada endpoint tulis (POST/PATCH). Konsumen yang butuh mengubah data mengarahkan user ke UI HC Core.
- Tidak ada endpoint riwayat/revisi untuk konsumen.
- Tidak ada webhook.
