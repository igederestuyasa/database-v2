/**
 * Row → `EntityOption` mappers, and the option shape itself.
 *
 * WHY THIS IS A SEPARATE FILE FROM `EntityPicker.tsx`.
 *
 * These functions are pure, and they were written to be called from a Server
 * Component before handing rows to the picker — their old home said so in a
 * comment. But their old home is `EntityPicker.tsx`, which starts with
 * `"use client"`, and that directive applies to the **module**, not to the
 * component: every export of a client module that a server module imports
 * becomes a client *reference*, a stub the server may pass along but must never
 * call. In a dev build nothing complains. In a production build the call throws
 *
 *     Attempted to call toOrgUnitOptions() from the server but
 *     toOrgUnitOptions is on the client.
 *
 * which is how `app/(app)/bereskan/_lib/data.ts` took down `/bereskan` — but
 * only once the page actually had a Temuan to build Merge candidates for, since
 * the call sits behind that condition. A page whose whole job is finding dirty
 * data worked perfectly until it found some.
 *
 * So the mappers live here in `lib/`, with no directive, and
 * `components/shared/EntityPicker.tsx` re-exports them unchanged: client
 * components keep importing from either module, and server code (pages,
 * `lib/db/referenceOptions.ts`) imports from this one.
 *
 * KODE HANYA MUNCUL KALAU IA MEMBEDAKAN SESUATU.
 *
 * Dulu setiap baris membawa kodenya — "OU-BAGIAN-HUMAN-CAPITAL-SERVICES" di
 * bawah "Bagian Human Capital Services". Untuk nama yang sudah unik itu cuma
 * mengeja ulang baris di atasnya dengan huruf besar dan tanda hubung, dan satu
 * daftar pilih jadi penuh untaian yang tidak menjawab apa pun.
 *
 * Tapi kodenya TIDAK BOLEH hilang begitu saja: data seed memang masuk kotor
 * (ADR-002), dan dua Unit Organisasi betul-betul bisa punya nama yang sama —
 * "Divisi Human Capital" dengan kode `…HUMAN-CAPITAL` dan `…HUMAN-CAPITAL-2`
 * hidup berdampingan sampai ada yang me-Merge-nya. Di halaman detail,
 * kehilangan kode cuma berarti tidak tahu yang mana. Di sebuah PICKER, salah
 * pilih berarti menulis penempatan yang salah pada seseorang.
 *
 * Jadi kodenya ditampilkan tepat pada baris yang labelnya kembar di daftar
 * yang sama, dan disembunyikan pada yang tidak. Pembandingnya dinormalkan —
 * "Divisi QHSSE" dan "Divisi QHSSE " adalah dua nama yang juga tidak bisa
 * dibedakan mata, dan justru pasangan seperti itulah yang paling sering lahir
 * dari Excel.
 */

/** One choosable row. `id` is what gets stored; everything else is display. */
export type EntityOption = {
  id: string;
  /** What the user reads and searches: a nama, a label, a kode + nama. */
  label: string;
  /**
   * Baris kedua: tingkat unit, dan kodenya HANYA kalau labelnya kembar di
   * daftar yang sama. Lihat catatan di kepala berkas.
   */
  keterangan?: string;
  /** Nonaktif options are shown greyed and sorted last, never hidden. */
  status?: "aktif" | "nonaktif";
  /** Indent level, for a Unit Organisasi tree flattened into a list. */
  depth?: number;
  disabled?: boolean;
};

/**
 * Label mana yang muncul lebih dari sekali — dinormalkan, dibandingkan tanpa
 * huruf besar-kecil dan tanpa spasi berlebih.
 */
function labelKembar(labels: readonly string[]): ReadonlySet<string> {
  const hitung = new Map<string, number>();
  for (const label of labels) {
    const kunci = normalkan(label);
    hitung.set(kunci, (hitung.get(kunci) ?? 0) + 1);
  }
  return new Set(
    [...hitung].filter(([, jumlah]) => jumlah > 1).map(([kunci]) => kunci),
  );
}

function normalkan(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

type OrgUnitLike = {
  id: string;
  kode: string;
  nama: string;
  tipe: string;
  status: string;
  depth?: number;
};

export function toOrgUnitOptions(
  rows: readonly OrgUnitLike[],
  labels?: Record<string, string>,
): EntityOption[] {
  const kembar = labelKembar(rows.map((row) => row.nama));
  return rows.map((row) => {
    // Tingkatnya selalu ditulis — "Bagian", "Proyek" — karena itu bukan ejaan
    // ulang namanya melainkan letaknya di hierarki. Kodenya hanya menyusul
    // kalau namanya memang kembar.
    const tipe = labels?.[row.tipe] ?? row.tipe;
    return {
      id: row.id,
      label: row.nama,
      keterangan: kembar.has(normalkan(row.nama))
        ? `${tipe} · ${row.kode}`
        : tipe,
      status: row.status === "nonaktif" ? "nonaktif" : "aktif",
      depth: row.depth,
    };
  });
}

type JabatanLike = { id: string; kode: string; nama: string; status: string };

export function toJabatanOptions(rows: readonly JabatanLike[]): EntityOption[] {
  const kembar = labelKembar(rows.map((row) => row.nama));
  return rows.map((row) => ({
    id: row.id,
    label: row.nama,
    keterangan: kembar.has(normalkan(row.nama)) ? row.kode : undefined,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}

type LookupLike = { id: string; kode: string; label: string; status: string };

export function toLookupOptions(rows: readonly LookupLike[]): EntityOption[] {
  const kembar = labelKembar(rows.map((row) => row.label));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    keterangan: kembar.has(normalkan(row.label)) ? row.kode : undefined,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  }));
}
