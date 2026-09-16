/**
 * Kelas bentuk HC Panel yang dipakai lebih dari satu komponen.
 *
 * Berkas ini sengaja TANPA `"use client"` dan tanpa impor apa pun: isinya cuma
 * string. Itu yang membuat `SearchField` (Client Component) dan form GET biasa
 * di halaman Log — yang justru berharga karena jalan tanpa JavaScript — bisa
 * memakai bentuk kolom cari yang sama persis tanpa salah satunya menyeret yang
 * lain ke sisi yang salah.
 */

/** Kolom cari, kontrol utama layar: tinggi 60, radius 16, satu-satunya bayangan. */
export const KELAS_KOLOM_CARI = [
  "hc-permukaan h-kontrol-utama w-full rounded-kartu border border-input bg-card",
  "pl-kontrol-teks pr-14 text-isi font-medium caret-brand shadow-kontrol",
  "transition-colors duration-150 ease-standar",
  "placeholder:font-normal placeholder:text-muted-foreground",
  "hover:border-muted-foreground",
  "focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "[&::-webkit-search-cancel-button]:appearance-none",
].join(" ");

/** Label di atas kolom cari dan di atas bidang isian. */
export const KELAS_LABEL = "block text-label text-foreground";
