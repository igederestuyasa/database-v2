import Link from "next/link";

import { cn } from "@/lib/utils";
import { LOOKUP_TYPES, LOOKUP_TYPE_LABELS, type LookupType } from "@/lib/validation/lookupTypes";

export type LookupTypeTabsProps = {
  active: LookupType;
  /** How many Lookup each tipe holds, aktif dan nonaktif digabung. */
  counts: Readonly<Record<LookupType, number>>;
};

/**
 * One tab per Lookup tipe, as links rather than client-side tab state.
 *
 * The open tab lives in the URL (`/master-data?tipe=job_grade`), so it can be
 * bookmarked, shared with a colleague, reached from "Perlu Dibereskan", and
 * survives the browser Back button — none of which a `useState` tab index
 * gives. It also keeps this a Server Component: only the rows of the tipe
 * being looked at are handed to the browser.
 */
export function LookupTypeTabs({ active, counts }: LookupTypeTabsProps) {
  return (
    <nav aria-label="Tipe daftar Lookup" className="overflow-x-auto">
      <ul className="flex w-max min-w-full flex-wrap gap-1 rounded-md bg-muted p-1">
        {LOOKUP_TYPES.map((tipe) => {
          const aktif = tipe === active;
          return (
            <li key={tipe}>
              <Link
                href={`/master-data?tipe=${tipe}`}
                aria-current={aktif ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                  aktif
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {LOOKUP_TYPE_LABELS[tipe]}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    aktif ? "bg-muted text-muted-foreground" : "bg-background/70",
                  )}
                >
                  {counts[tipe]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default LookupTypeTabs;
