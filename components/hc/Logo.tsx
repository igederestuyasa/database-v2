import { cn } from "@/lib/utils";

/**
 * Logo HC — docs/DESIGN.md §Komponen.
 *
 * Bentuknya disalin persis dari spesifikasi; yang diubah hanya cara mewarnai:
 * `fill` literal diganti utility Tailwind supaya logo ikut token dan berbalik
 * sendiri di mode gelap.
 *
 * `aria-hidden` karena di bar atas logo selalu berdampingan dengan nama app
 * sebagai teks — membacakan keduanya hanya mengulang hal yang sama.
 */
export function Logo({ ukuran = 28, className }: { ukuran?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={ukuran}
      height={ukuran}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="48" height="48" rx="12" className="fill-foreground" />
      <path d="M9 9H24A15 15 0 0 1 9 24Z" className="fill-background" />
      <circle cx="31.5" cy="16.5" r="7.5" className="fill-brand-ikon" />
      <rect x="9" y="24" width="15" height="15" className="fill-background" />
      <path d="M24 39H39A7.5 7.5 0 0 0 24 39Z" className="fill-background" />
    </svg>
  );
}

export default Logo;
