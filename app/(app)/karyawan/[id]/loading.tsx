import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state shaped like the detail page it stands in for: a header, a wide
 * column of field cards and a narrow column for Data Pribadi Sensitif and
 * Riwayat Revisi. The shared `RouteLoading` draws a list, which would make the
 * page appear to change layout the moment the data lands.
 */
export default function Loading() {
  return (
    <div className="space-y-6 py-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Sedang memuat…</span>

      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-4 rounded-lg border p-6">
              <Skeleton className="h-5 w-44" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((field) => (
                  <Skeleton key={field} className="h-10 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6 lg:col-span-2">
          {[0, 1].map((index) => (
            <div key={index} className="space-y-4 rounded-lg border p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
