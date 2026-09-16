import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Satu keluarga huruf untuk seluruh app (docs/DESIGN.md §Tipografi).
 *
 * Variabel `--font-sans` baru berarti sesuatu sejak `tailwind.config.ts`
 * memetakan `fontFamily.sans` ke sana; sebelum itu `font-sans` di bawah jatuh
 * ke tumpukan bawaan Tailwind dan huruf yang dimuat di sini tidak pernah
 * benar-benar terpakai. Jangan lepaskan salah satu dari keduanya.
 *
 * Plus Jakarta Sans adalah huruf variabel, jadi satu berkas ini melayani
 * seluruh skala tebal yang dipakai HC Panel — termasuk 650 untuk judul item.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "HC Core",
    template: "%s · HC Core",
  },
  description:
    "Database central data Karyawan PT Hutama Karya (Persero) — sumber kebenaran data Karyawan, Unit Organisasi, dan Jabatan.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={`${jakarta.variable} font-sans antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
