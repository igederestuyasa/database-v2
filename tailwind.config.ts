import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tailwind 3 (classic JS config) — see ADR-005 for why v4 was rejected.
 *
 * Every visual value here resolves to a token defined in `app/globals.css`
 * (sistem UI "HC Panel", docs/DESIGN.md). Nothing in this file carries a
 * literal colour, radius or shadow of its own: the two modes live in one place
 * — `:root` and `.dark` — and this file only gives those tokens Tailwind names.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      // Tepi halaman: 20px di HP, 40px mulai 1024px (docs/DESIGN.md §Spasi).
      padding: { DEFAULT: "1.25rem", lg: "2.5rem" },
      screens: { "2xl": "1240px" },
    },
    extend: {
      /**
       * Satu keluarga huruf: Plus Jakarta Sans, dimuat `app/layout.tsx` lewat
       * `next/font/google` sebagai `--font-sans`.
       *
       * Pemetaan ini sebelumnya TIDAK ADA, jadi `font-sans` jatuh ke tumpukan
       * bawaan Tailwind dan huruf yang susah payah dimuat itu tidak pernah
       * benar-benar dipakai. Tanpa baris ini, ganti huruf apa pun percuma.
       */
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },

      /** Skala huruf docs/DESIGN.md §Tipografi — ukuran, tinggi baris, dan
       *  tebal ikut dalam satu nama, supaya peran tidak bisa dipakai separuh. */
      fontSize: {
        "judul-halaman": [
          "clamp(2.25rem, 1.5rem + 2.2vw, 3rem)",
          { lineHeight: "1.05", letterSpacing: "-0.04em", fontWeight: "700" },
        ],
        "judul-panel": [
          "1.5rem",
          { lineHeight: "1.2", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        "judul-bagian": [
          "1.3125rem",
          { lineHeight: "1.25", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        subjudul: ["1.125rem", { lineHeight: "1.5", fontWeight: "400" }],
        "judul-item": [
          "1rem",
          { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "650" },
        ],
        isi: ["1rem", { lineHeight: "1.5", fontWeight: "400" }],
        label: ["0.875rem", { lineHeight: "1.4", fontWeight: "600" }],
        pendukung: ["0.875rem", { lineHeight: "1.45", fontWeight: "400" }],
        mikro: ["0.75rem", { lineHeight: "1.3", fontWeight: "600" }],
      },

      /** 650 untuk judul item dan label kelompok — tidak ada di skala bawaan. */
      fontWeight: { 650: "650" },

      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--tinta-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /**
         * Aksen merek dan warna status, di luar peran shadcn.
         *
         * `brand-latar` membawa alpha-nya sendiri di mode gelap
         * (`rgb(240 72 78 / .24)`), jadi jangan pernah ditulis dengan pengubah
         * opasitas — `bg-brand-latar/50` menghasilkan CSS yang tidak sah.
         */
        brand: {
          DEFAULT: "hsl(var(--merah))",
          ikon: "hsl(var(--merah-ikon))",
          latar: "hsl(var(--merah-latar))",
        },
        sukses: "hsl(var(--sukses))",
        peringatan: "hsl(var(--peringatan))",
        /** Hanya untuk item yang belum tersedia dan kotak keadaan kosong. */
        "garis-putus": "hsl(var(--garis-putus))",
      },

      /**
       * `lg` dan `md` sengaja dipetakan ke radius kartu (16) dan bidang isian
       * (12): seluruh `components/ui/*` yang beku memakai `rounded-md` dan
       * `rounded-lg`, jadi pemetaan inilah yang membuat primitif shadcn ikut
       * bentuk HC Panel tanpa satu pun file di sana disentuh.
       */
      borderRadius: {
        panel: "var(--radius-panel)",
        kartu: "var(--radius-kartu)",
        bidang: "var(--radius-bidang)",
        lg: "var(--radius-kartu)",
        md: "var(--radius-bidang)",
        sm: "calc(var(--radius-bidang) - 4px)",
      },

      /** Satu elevasi per layar: `shadow-kontrol` hanya untuk kontrol utama. */
      boxShadow: {
        kontrol: "var(--bayangan-kontrol)",
        popover: "var(--bayangan-popover)",
      },

      maxWidth: {
        /** Lebar maksimum wadah, termasuk tepi halaman. */
        wadah: "1240px",
        /** Subjudul halaman berhenti di 44ch (docs/DESIGN.md §Tipografi). */
        subjudul: "44ch",
      },

      transitionTimingFunction: {
        keluar: "var(--kurva-keluar)",
        standar: "var(--kurva-standar)",
        pantul: "var(--kurva-pantul)",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        /** Muat halaman: salam, h1, subjudul, kontrol utama. */
        "naik-muncul": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "none" },
        },
        /** Bentuk di ikon generatif, dirakit satu per satu. */
        "bentuk-masuk": {
          from: { opacity: "0", transform: "scale(0.2)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        /** Ganti isi panel detail. */
        "panel-masuk": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "naik-muncul": "naik-muncul 700ms var(--kurva-keluar) both",
        "bentuk-masuk": "bentuk-masuk 420ms var(--kurva-pantul) both",
        "panel-masuk": "panel-masuk 240ms var(--kurva-keluar) both",
      },
    },
  },
  plugins: [animate],
};

export default config;
