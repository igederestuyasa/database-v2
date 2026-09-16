import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Tombol HC Panel — docs/DESIGN.md §Komponen.
 *
 * KENAPA BUKAN MEMBUNGKUS `components/ui/button.tsx`. Yang beku itu memulai
 * dari `rounded-md h-10 px-4 text-sm font-medium`; setiap tombol HC Panel harus
 * mengalahkan kelima-limanya lewat twMerge, dan satu saja yang terlewat
 * hasilnya tombol yang hampir benar — paling sulit dilihat, paling mudah
 * menyebar. Jadi tombol ini berdiri sendiri di atas `<button>` biasa, dan
 * `ui/button.tsx` tetap utuh, tidak disentuh, dan tetap dipakai di tempat lain.
 *
 * `asChild` memakai `Slot` yang sama seperti shadcn, jadi pola
 * `<Tombol asChild><Link …/></Tombol>` tetap jalan.
 *
 * Satu tombol utama per tampilan. Kalau di satu layar ada dua `nada="utama"`,
 * yang salah hampir pasti layarnya, bukan tombolnya.
 */
export const kelasTombol = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full",
    "transition duration-150 ease-standar active:scale-[0.99]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      nada: {
        utama: "bg-primary text-primary-foreground hover:bg-primary-hover",
        sekunder:
          "hc-permukaan border border-input bg-card text-foreground hover:bg-accent",
        halus: "text-muted-foreground hover:bg-accent hover:text-foreground",
      },
      ukuran: {
        /** Tinggi 40 — tombol di dalam halaman. */
        biasa: "h-10 px-5 text-label",
        /** Tinggi 48 selebar panel — aksi utama di panel detail. */
        panel: "h-12 w-full px-6 text-label",
        /** Tinggi 36 — aksi per baris tabel, tetap di atas target sentuh 44
         *  karena baris tabelnya sendiri yang setinggi 48. */
        ringkas: "h-9 px-4 text-mikro",
      },
    },
    defaultVariants: { nada: "utama", ukuran: "biasa" },
  },
);

export type TombolProps = React.ComponentProps<"button"> &
  VariantProps<typeof kelasTombol> & { asChild?: boolean };

export const Tombol = React.forwardRef<HTMLButtonElement, TombolProps>(
  ({ className, nada, ukuran, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        // Tanpa ini sebuah tombol di dalam <form> diam-diam jadi submit.
        type={asChild ? undefined : (type ?? "button")}
        className={cn(kelasTombol({ nada, ukuran }), className)}
        {...props}
      />
    );
  },
);
Tombol.displayName = "Tombol";

export default Tombol;
