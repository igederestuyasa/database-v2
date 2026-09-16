"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { indeksBerikutnya, type KotakItem } from "./navigasiDaftar";

/**
 * Perilaku pola daftar-detail — docs/DESIGN.md §Pola daftar-detail.
 *
 * Satu hook untuk kedelapan layar daftar, supaya "arahkan kursor lalu lihat
 * detailnya" berarti hal yang sama persis di Karyawan, Jabatan, dan Log.
 *
 * KENAPA `history.replaceState`, BUKAN `router.replace`. Spesifikasi menulis
 * `router.replace`, dan di portal tempat spesifikasi ini lahir itu murah:
 * daftarnya statis. Di HC Core setiap halaman `force-dynamic` dan datanya dari
 * Supabase, jadi `router.replace` memicu pengambilan ulang RSC — satu kali
 * setiap kursor berhenti 120ms di atas sebuah baris. Menyorot daftar Karyawan
 * dari atas ke bawah akan menghujani database dengan puluhan permintaan yang
 * tidak satu pun mengubah isi layar. `window.history.replaceState` adalah cara
 * yang memang disediakan Next untuk memperbarui URL tanpa navigasi; hasil yang
 * dijanjikan spesifikasi — URL bisa dibagikan dan bertahan saat reload — tetap
 * utuh.
 */
const TUNDA_SOROT = 120;
const PANEL_TERLIHAT = "(min-width: 1024px)";

export type OpsiDaftarDetail<T> = {
  /** Item yang sedang terlihat, sesudah pencarian dan filter. */
  items: readonly T[];
  idDari: (item: T) => string;
  /**
   * Item yang belum tersedia tidak boleh jadi pilihan awal. Kosongkan kalau
   * semua item di layar ini tersedia — di HC Core, selalu.
   */
  tersedia?: (item: T) => boolean;
  /**
   * Kata kunci pencarian. Saat berubah dan tidak kosong, panel kembali
   * mengikuti hasil teratas.
   */
  kunciPencarian?: string;
  /** Nama parameter URL. Default "pilih". */
  param?: string;
};

export type DaftarDetail<T> = {
  /** Item yang isinya sedang ditampilkan panel, atau `null` kalau daftar kosong. */
  terpilih: T | null;
  idTerpilih: string | null;
  /** Panel hanya ada mulai 1024px; di bawah itu penandanya juga tidak tampil. */
  panelTerlihat: boolean;
  /** Item teratas — yang dijalankan Enter dari kolom cari. */
  teratas: T | null;
  pilih: (id: string | null) => void;
  /** Dipasang ke wadah daftar: menangani panah, Home, dan End. */
  propsDaftar: () => {
    ref: (el: HTMLElement | null) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
  /** Dipasang ke tiap item daftar. */
  propsItem: (item: T) => {
    "data-item-daftar": string;
    "data-terpilih"?: string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
  };
  /** Untuk `onPanahBawah` di kolom cari. */
  fokusItemPertama: () => void;
};

export function useDaftarDetail<T>({
  items,
  idDari,
  tersedia,
  kunciPencarian,
  param = "pilih",
}: OpsiDaftarDetail<T>): DaftarDetail<T> {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Nilai awal dibaca sekali dari URL supaya tautan yang dibagikan dan reload
  // sama-sama mendarat di item yang benar.
  const [idDiminta, setIdDiminta] = React.useState<string | null>(() =>
    searchParams.get(param),
  );

  const [panelTerlihat, setPanelTerlihat] = React.useState(false);
  const refDaftar = React.useRef<HTMLElement | null>(null);
  const penunda = React.useRef<number | null>(null);

  const idTersedia = React.useMemo(() => new Set(items.map(idDari)), [items, idDari]);

  const idPertama = React.useMemo(() => {
    const awal = (tersedia ? items.find(tersedia) : undefined) ?? items[0];
    return awal === undefined ? null : idDari(awal);
  }, [items, tersedia, idDari]);

  /**
   * Diturunkan, bukan disimpan. Begitu filter menyembunyikan item terpilih,
   * pilihannya jatuh sendiri ke item pertama yang terlihat — tanpa effect yang
   * berpacu dengan render dan tanpa satu frame memperlihatkan panel kosong.
   */
  const idTerpilih =
    idDiminta !== null && idTersedia.has(idDiminta) ? idDiminta : idPertama;

  const terpilih = React.useMemo(
    () => items.find((item) => idDari(item) === idTerpilih) ?? null,
    [items, idDari, idTerpilih],
  );

  // Pencarian baru: panel kembali mengikuti hasil teratas.
  const kunciSebelumnya = React.useRef(kunciPencarian);
  React.useEffect(() => {
    if (kunciPencarian === undefined || kunciSebelumnya.current === kunciPencarian) return;
    kunciSebelumnya.current = kunciPencarian;
    if (kunciPencarian.trim() !== "") setIdDiminta(null);
  }, [kunciPencarian]);

  React.useEffect(() => {
    const media = window.matchMedia(PANEL_TERLIHAT);
    const perbarui = () => setPanelTerlihat(media.matches);
    perbarui();
    media.addEventListener("change", perbarui);
    return () => media.removeEventListener("change", perbarui);
  }, []);

  React.useEffect(() => {
    const sekarang = new URLSearchParams(window.location.search);
    if ((sekarang.get(param) ?? null) === idTerpilih) return;
    if (idTerpilih === null) sekarang.delete(param);
    else sekarang.set(param, idTerpilih);
    const sisa = sekarang.toString();
    window.history.replaceState(null, "", sisa ? `${pathname}?${sisa}` : pathname);
  }, [idTerpilih, param, pathname]);

  const batalSorot = React.useCallback(() => {
    if (penunda.current === null) return;
    window.clearTimeout(penunda.current);
    penunda.current = null;
  }, []);

  React.useEffect(() => batalSorot, [batalSorot]);

  const setRefDaftar = React.useCallback((el: HTMLElement | null) => {
    refDaftar.current = el;
  }, []);

  const elemenItem = React.useCallback(
    () =>
      Array.from(
        refDaftar.current?.querySelectorAll<HTMLElement>("[data-item-daftar]") ?? [],
      ),
    [],
  );

  const propsDaftar = React.useCallback(
    () => ({
      ref: setRefDaftar,
      onKeyDown: (event: React.KeyboardEvent) => {
        const elemen = elemenItem();
        if (elemen.length === 0) return;

        const aktif = document.activeElement;
        const sekarang = elemen.findIndex(
          (el) => el === aktif || (aktif instanceof Node && el.contains(aktif)),
        );

        const kotak: KotakItem[] = elemen.map((el) => {
          const kotakEl = el.getBoundingClientRect();
          return { kiri: kotakEl.left, atas: kotakEl.top };
        });

        const tujuan = indeksBerikutnya(kotak, sekarang, event.key);
        if (tujuan === null) return;

        event.preventDefault();
        elemen[tujuan]?.focus();
      },
    }),
    [elemenItem, setRefDaftar],
  );

  const propsItem = React.useCallback(
    (item: T) => {
      const id = idDari(item);
      return {
        "data-item-daftar": "",
        // Penanda terpilih hanya berarti kalau panelnya memang terlihat.
        "data-terpilih": panelTerlihat && id === idTerpilih ? "" : undefined,
        onMouseEnter: () => {
          if (!panelTerlihat) return;
          batalSorot();
          penunda.current = window.setTimeout(() => setIdDiminta(id), TUNDA_SOROT);
        },
        onMouseLeave: batalSorot,
        onFocus: () => {
          if (!panelTerlihat) return;
          batalSorot();
          setIdDiminta(id);
        },
      };
    },
    [idDari, idTerpilih, panelTerlihat, batalSorot],
  );

  const fokusItemPertama = React.useCallback(() => {
    elemenItem()[0]?.focus();
  }, [elemenItem]);

  const pilih = React.useCallback((id: string | null) => {
    batalSorot();
    setIdDiminta(id);
  }, [batalSorot]);

  return {
    terpilih,
    idTerpilih,
    panelTerlihat,
    teratas: items[0] ?? null,
    pilih,
    propsDaftar,
    propsItem,
    fokusItemPertama,
  };
}

export default useDaftarDetail;
