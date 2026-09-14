import { Skeleton } from "@/components/ui/skeleton";

/** Shared loading UI. Every route ships a `loading.tsx` that renders this. */
export default function RouteLoading() {
  return (
    <div className="space-y-4 py-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuat…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="space-y-2 pt-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
