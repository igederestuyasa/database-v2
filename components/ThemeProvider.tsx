"use client";

/**
 * Mode gelap HC Panel.
 *
 * `next-themes` sudah ada di `package.json` sejak awal dan
 * `components/ui/sonner.tsx` sudah memanggil `useTheme()` — tapi tidak ada
 * satu pun Provider yang dipasang, jadi `darkMode: ["class"]` di Tailwind
 * tidak pernah mendapat kelas `.dark`-nya dan seluruh blok gelap di
 * `app/globals.css` belum pernah aktif sekali pun. Ini yang memasangnya.
 *
 * TANPA TOMBOL, dan itu disengaja. docs/DESIGN.md meminta mode gelap memakai
 * mekanisme yang sudah ada di app; `defaultTheme="system"` membuatnya ikut
 * setelan sistem operasi, jadi tidak ada kontrol baru di UI yang nomornya
 * harus dicari di PRD §4. Kalau nanti staf HC memang perlu memilih sendiri,
 * `setTheme()` dari `useTheme()` sudah siap tanpa mengubah file ini.
 *
 * `disableTransitionOnChange` mematikan transisi warna tepat pada detik
 * pergantian tema, supaya seluruh halaman tidak ikut memudar bersamaan.
 */
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

export default ThemeProvider;
