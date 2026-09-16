import { cn } from "@/lib/utils";

/**
 * Label status HC Panel — docs/DESIGN.md §Komponen.
 *
 * Pil tinggi 22, padding 0 8, 12px 600, border garis. Statusnya selalu
 * dinyatakan dengan TEKS, tidak pernah dengan warna saja: `sukses` dan
 * `peringatan` hanya menguatkan kata yang sudah terbaca, supaya label ini tetap
 * berarti buat yang tidak membedakan warna dan di mode kontras paksa.
 *
 * Menggantikan `Badge` di layar-layar HC Panel. `components/ui/badge.tsx` tetap
 * ada dan tidak disentuh — yang beku tetap beku.
 */
export type NadaStatus = "netral" | "sukses" | "peringatan";

const NADA: Record<NadaStatus, string> = {
  netral: "text-muted-foreground",
  sukses: "text-sukses",
  peringatan: "text-peringatan",
};

export function StatusLabel({
  children,
  nada = "netral",
  className,
  ...props
}: {
  children: React.ReactNode;
  nada?: NadaStatus;
  className?: string;
} & Omit<React.ComponentProps<"span">, "children" | "className">) {
  return (
    <span
      className={cn(
        "hc-permukaan inline-flex h-status shrink-0 items-center rounded-full border border-border bg-transparent px-2 text-mikro",
        NADA[nada],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default StatusLabel;
