"use client";

/**
 * Resolve the uuids inside a set of Revisi to names, once, and keep them.
 *
 * A Revisi is a jsonb snapshot of a row, so its interesting columns are
 * foreign keys: `org_unit_id`, `jabatan_id`, eleven Lookup columns, plus
 * `actor_id`. Rendered raw they are useless to staf HC, so both screens that
 * show Revisi — `RevisionPanel` and the Log Perubahan page — run everything
 * they are about to render through here first.
 *
 * Two details worth keeping:
 *
 *   * **The effect depends on a serialised id list, not on the array of
 *     Revisi.** A parent that re-renders hands over a new array identity every
 *     time; keying on the ids themselves means one request per actual change,
 *     instead of one per render.
 *   * **Labels are merged, never replaced.** A uuid's name does not stop being
 *     true when a second batch of Revisi arrives, and dropping the map would
 *     flash "(tidak dikenal)" across a list that was already readable.
 *
 * Unresolved ids are normal: `profiles` is readable only by an admin or its
 * owner, so a viewer cannot turn a colleague's `actor_id` into an email. That
 * is RLS working, not a failure — `actorLabel()` falls back to a short id.
 */
import { useEffect, useMemo, useState } from "react";

import { resolveRevisionLabels } from "@/lib/actions/revisions";

import {
  collectReferenceIds,
  isEmptyReferenceIds,
  mergeReferenceIds,
  type ReferenceIds,
  type ReferenceLabels,
  type RevisionLike,
} from "./revisionDiff";

const EMPTY_LABELS: ReferenceLabels = {};

export type UseReferenceLabels = {
  labels: ReferenceLabels;
  /** True when a lookup failed, so the UI can admit some names are missing. */
  gagal: boolean;
};

export function useReferenceLabels(
  revisions: readonly RevisionLike[],
  options?: {
    /** Ids that are not inside a Revisi — Batch actors, for instance. */
    extra?: ReferenceIds;
    /** Names already resolved on the server; used as the starting map. */
    initial?: ReferenceLabels;
  },
): UseReferenceLabels {
  const initial = options?.initial;
  const extra = options?.extra;

  const [labels, setLabels] = useState<ReferenceLabels>(initial ?? EMPTY_LABELS);
  const [gagal, setGagal] = useState(false);

  // A stable *value* for a set of ids, so the effect below fires when the ids
  // change rather than when the caller re-renders.
  const idsKey = useMemo(() => {
    const collected = collectReferenceIds(revisions);
    return JSON.stringify(extra ? mergeReferenceIds(collected, extra) : collected);
  }, [revisions, extra]);

  useEffect(() => {
    const ids = JSON.parse(idsKey) as ReferenceIds;
    if (isEmptyReferenceIds(ids)) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await resolveRevisionLabels({ ids });
        if (cancelled) return;
        if (result.ok) {
          setLabels((previous) => ({ ...previous, ...result.data.labels }));
          setGagal(false);
        } else {
          setGagal(true);
        }
      } catch (error) {
        // A Server Action can reject before it ever returns a result — offline,
        // a 500, a deploy that moved the action id. Without this the flag stays
        // false and every reference renders "(tidak dikenal)" while the UI
        // insists the names are fine.
        if (cancelled) return;
        console.error("[useReferenceLabels]", error);
        setGagal(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return { labels, gagal };
}
