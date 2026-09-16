/**
 * lib/seed/template.ts — template Excel untuk halaman Impor (PRD #24).
 *
 * KENAPA INI ADA. Kolom yang ejaannya tidak dikenal TIDAK menghentikan impor:
 * ia dilaporkan sebagai Peringatan dan datanya dibuang. Itu perilaku yang
 * benar — menebak lebih berbahaya — tapi artinya seorang admin bisa mengunggah
 * file yang "berhasil" sambil kehilangan satu kolom penuh tanpa sadar. Template
 * ini menghapus tebak-tebakan itu: unduh, isi, unggah.
 *
 * MURNI. Menghasilkan `unknown[][]`, bukan file. Yang mengubahnya jadi .xlsx
 * adalah SheetJS di peramban admin (`TombolTemplate`), sama seperti sisi baca:
 * `xlsx` tidak pernah dijalankan di server (ADR-005 §5).
 *
 * TIDAK BOLEH MELESET DARI PEMETAAN. Setiap `header` di bawah wajib dikenali
 * `buildHeaderPlan()`, dan setiap tujuan yang bisa diisi Excel wajib punya
 * wakil di sini — dua-duanya dipatok `template.test.ts`. Template yang
 * menjanjikan kolom yang tidak dibaca kode adalah bug yang lebih buruk
 * daripada tidak punya template sama sekali.
 */
import { HEADER_ROW, SHEET_NAME } from "./excelMapping";

export type KolomTemplate = {
  /** Ejaan yang ditulis di baris header. Harus dikenali `buildHeaderPlan()`. */
  header: string;
  /** Satu nilai contoh, untuk memperlihatkan bentuk yang diharapkan. */
  contoh: string;
  /** `true` kalau impor menolak file yang tidak punya kolom ini. */
  wajib?: true;
};

/**
 * Urutannya urutan baca manusia — identitas, penempatan, lalu selebihnya —
 * bukan urutan kolom di workbook HC yang mana pun. Impor mencocokkan lewat
 * nama header, tidak pernah lewat posisi, jadi kolom boleh digeser, dibuang,
 * atau ditambahi sesuka pengisinya.
 *
 * `Email Kantor` tidak ada di workbook HC sumber — kolomnya lahir belakangan
 * (PRD #25) — jadi template inilah ejaan bakunya. Ejaan lain yang wajar
 * ("Email", "Work Email", "Email Perusahaan") tetap dikenali `HEADER_TARGETS`,
 * supaya daftar yang dikirim IT bisa dipakai tanpa diganti judulnya dulu.
 */
export const TEMPLATE_KOLOM: readonly KolomTemplate[] = [
  { header: "Personnel Number", contoh: "90000001", wajib: true },
  { header: "Nama", contoh: "Budi Santoso", wajib: true },
  { header: "NIP", contoh: "1990001" },
  { header: "Email Kantor", contoh: "budi.santoso@hutamakarya.com" },
  { header: "Status", contoh: "aktif" },

  { header: "Business Unit", contoh: "Direktorat Operasi" },
  { header: "Divisi", contoh: "Divisi QHSSE" },
  { header: "Bagian", contoh: "Bagian K3" },
  { header: "Sub Bagian", contoh: "" },
  { header: "Jabatan", contoh: "Manager" },

  { header: "Gender", contoh: "Laki-laki" },
  { header: "Work Contract", contoh: "Pegawai Tetap" },
  { header: "Person Grade", contoh: "Pratama III - 13" },
  { header: "Job Grade", contoh: "Pratama III - 13" },
  { header: "Band Jabatan", contoh: "Band IV" },
  { header: "Legal Entity", contoh: "PT Hutama Karya (Persero)" },
  { header: "Klasifikasi Rekrutmen", contoh: "Rekrutmen Umum" },
  { header: "Teknik Non Teknik", contoh: "Teknik" },
  { header: "BoD Range", contoh: "BoD-2" },
  { header: "Kategori Penempatan", contoh: "Kantor Pusat" },
  { header: "Kategori Fungsi", contoh: "Fungsi Operasi" },

  { header: "Original Start Date", contoh: "2015-03-01" },
  { header: "Tanggal Diangkat", contoh: "2017-01-01" },
  { header: "Tanggal Promosi PG", contoh: "2022-07-01" },
  { header: "Tanggal Promosi JG", contoh: "2022-07-01" },
  { header: "Tanggal Keluar", contoh: "" },

  { header: "No Surat PG", contoh: "001/PG/2022" },
  { header: "No Surat JG", contoh: "002/JG/2022" },
  { header: "Keterangan Rangkap 1", contoh: "" },
  { header: "Keterangan Rangkap 2", contoh: "" },
  { header: "Keterangan PJ/PLT", contoh: "" },
  { header: "Keterangan", contoh: "" },
  { header: "Jurusan", contoh: "Teknik Sipil" },

  { header: "Tanggal Lahir", contoh: "1990-05-17" },
  { header: "Tempat Lahir", contoh: "Surabaya" },
  { header: "Agama", contoh: "Islam" },
  { header: "Status Pernikahan", contoh: "Menikah" },
];

/** Nama file yang diunduh. */
export const TEMPLATE_NAMA_FILE = "Template Impor Karyawan - HC Core.xlsx";

/** Nama sheet di dalam template — sama dengan yang dicari halaman Impor. */
export const TEMPLATE_SHEET = SHEET_NAME;

/**
 * Isi sheet sebagai array-of-arrays, siap diserahkan ke
 * `XLSX.utils.aoa_to_sheet()`.
 *
 * Baris headernya sengaja diletakkan di `HEADER_ROW` yang sama dengan workbook
 * HC, dengan baris-baris judul di atasnya — supaya template yang diisi lalu
 * diunggah balik terbaca oleh jalur yang persis sama, tanpa perlakuan khusus.
 */
export function buildTemplateRows(): unknown[][] {
  const rows: unknown[][] = [
    ["TEMPLATE IMPOR KARYAWAN — HC Core"],
    [
      "Isi mulai baris " +
        String(HEADER_ROW + 2) +
        ". Baris contoh di bawah header boleh dihapus atau ditimpa.",
    ],
    [
      "Kolom dicocokkan lewat NAMA header, bukan posisi — kolom boleh digeser, dibuang, atau ditambah. " +
        "Personnel Number adalah kuncinya: nomor yang sudah ada diperbarui, yang belum ada ditambah. " +
        "Sel yang dikosongkan TIDAK menghapus isi yang sudah ada di database. " +
        // Satu-satunya aturan di berkas ini yang bisa MEMBATALKAN seluruh
        // unggahan, jadi tempatnya di sini — bukan cuma di README yang belum
        // tentu dibuka orang yang sedang mengisi kolomnya.
        "Email Kantor boleh dikosongkan, tapi satu alamat hanya boleh milik satu orang: " +
        "kalau ada alamat kembar, seluruh impor dibatalkan dan tidak ada yang tertulis. " +
        "Isi email KANTOR, bukan email pribadi — kolom ini terbaca aplikasi lain lewat API. " +
        // Aturan yang paling sering salah dikira: untuk MEMPERBARUI orang yang
        // sudah ada, file cukup memuat Personnel Number dan kolom yang berubah.
        "Untuk MEMPERBARUI orang yang sudah ada, isi Personnel Number dan kolom yang ingin diubah saja — " +
        "kolom Nama pun boleh dikosongkan. Nama hanya wajib untuk Personnel Number yang BELUM ada di database.",
    ],
  ];
  // Persis `HEADER_ROW - 1` baris judul: `buildTemplateRows` menaruh header di
  // HEADER_ROW supaya template yang diisi terbaca jalur baca biasa, jadi baris
  // judul keempat akan menggeser headernya dan membuat template ini tidak
  // terbaca oleh kodenya sendiri. Tambahkan kalimat ke baris yang sudah ada,
  // jangan tambah baris.
  while (rows.length < HEADER_ROW - 1) rows.push([]);

  rows.push(TEMPLATE_KOLOM.map((kolom) => kolom.header));
  rows.push(TEMPLATE_KOLOM.map((kolom) => kolom.contoh));
  return rows;
}

/** Lebar kolom untuk `ws["!cols"]`, supaya headernya terbaca tanpa dilebarkan. */
export function templateColWidths(): { wch: number }[] {
  return TEMPLATE_KOLOM.map((kolom) => ({
    wch: Math.max(kolom.header.length, kolom.contoh.length, 10) + 2,
  }));
}
