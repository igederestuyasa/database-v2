import { describe, expect, it } from "vitest";

import tailwindConfig from "../tailwind.config";
import {
  ANIMASI,
  BAYANGAN,
  cn,
  KURVA,
  LEBAR_MAKS,
  RADIUS,
  SPASI,
  TEBAL_HURUF,
  UKURAN_HURUF,
} from "./utils";

/**
 * Penjaga sebuah kegagalan yang tidak terlihat di mana pun kecuali di layar.
 *
 * tailwind-merge tidak membaca `tailwind.config.ts`; ia menebak arti sebuah
 * kelas dari namanya. Token HC Panel tidak dikenalinya, sehingga (a) ukuran
 * huruf buatan sendiri dianggap warna dan membuang warna pasangannya, dan (b)
 * radius, bayangan, serta tinggi buatan sendiri gagal menimpa kelas bawaan.
 * Dua-duanya lolos lint, typecheck, dan build.
 */
type Extend = {
  fontSize?: Record<string, unknown>;
  borderRadius?: Record<string, unknown>;
  boxShadow?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  transitionTimingFunction?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  fontWeight?: Record<string, unknown>;
  maxWidth?: Record<string, unknown>;
};

const extend = (tailwindConfig.theme?.extend ?? {}) as Extend;
const kunci = (bagian?: Record<string, unknown>) => Object.keys(bagian ?? {}).sort();

describe("cn", () => {
  it("tidak membuang warna saat dipasangkan dengan ukuran huruf HC Panel", () => {
    expect(cn("text-primary-foreground text-label")).toBe(
      "text-primary-foreground text-label",
    );
    expect(cn("text-judul-halaman text-foreground")).toBe(
      "text-judul-halaman text-foreground",
    );
    expect(cn("text-pendukung text-muted-foreground")).toBe(
      "text-pendukung text-muted-foreground",
    );
  });

  it("membuat token HC Panel menimpa kelas bawaan yang sepadan", () => {
    expect(cn("rounded-md rounded-kartu")).toBe("rounded-kartu");
    expect(cn("rounded-lg rounded-panel")).toBe("rounded-panel");
    expect(cn("shadow-sm shadow-kontrol")).toBe("shadow-kontrol");
    expect(cn("h-10 h-kontrol-utama")).toBe("h-kontrol-utama");
    expect(cn("pl-4 pl-kontrol-teks")).toBe("pl-kontrol-teks");
    expect(cn("font-medium font-650")).toBe("font-650");
    expect(cn("max-w-md max-w-wadah")).toBe("max-w-wadah");
    expect(cn("ease-linear ease-keluar")).toBe("ease-keluar");
    expect(cn("animate-none animate-naik-muncul")).toBe("animate-naik-muncul");
  });

  it("dan sebaliknya: kelas bawaan tetap bisa menimpa token HC Panel", () => {
    expect(cn("h-kontrol-utama h-12")).toBe("h-12");
    expect(cn("shadow-kontrol shadow-none")).toBe("shadow-none");
    expect(cn("font-650 font-bold")).toBe("font-bold");
  });

  it("tetap menyelesaikan bentrokan bawaan seperti biasa", () => {
    expect(cn("text-sm text-base")).toBe("text-base");
    expect(cn("text-isi text-label")).toBe("text-label");
    expect(cn("text-red-500 text-blue-500")).toBe("text-blue-500");
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  /**
   * Kalau salah satu test di bawah gagal, sebuah token ditambahkan ke
   * `tailwind.config.ts` tanpa didaftarkan di `lib/utils.ts` — dan bug di atas
   * sudah kembali untuk token itu.
   */
  it("mengenali setiap token yang ada di tailwind.config.ts", () => {
    expect(kunci(extend.fontSize)).toEqual([...UKURAN_HURUF].sort());
    expect(kunci(extend.borderRadius)).toEqual(
      [...RADIUS, "lg", "md", "sm"].sort(),
    );
    expect(kunci(extend.boxShadow)).toEqual([...BAYANGAN].sort());
    expect(kunci(extend.spacing)).toEqual([...SPASI].sort());
    expect(kunci(extend.transitionTimingFunction)).toEqual([...KURVA].sort());
    expect(kunci(extend.fontWeight)).toEqual([...TEBAL_HURUF].sort());
    expect(kunci(extend.maxWidth)).toEqual([...LEBAR_MAKS].sort());
    // Animasi accordion ikut terbawa dari shadcn dan bukan token HC Panel.
    expect(kunci(extend.animation)).toEqual(
      [...ANIMASI, "accordion-down", "accordion-up"].sort(),
    );
  });
});
