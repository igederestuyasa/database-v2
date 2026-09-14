"use client";

/**
 * One Revisi, rendered for someone who has never seen a database.
 *
 * `revisions.before` / `after` are whole-row jsonb snapshots, so the raw
 * material behind this card looks like `{"org_unit_id":"3f2a…", …}` twice over.
 * Everything here is about turning that into a sentence: what changed, from
 * what to what, who did it, when, and — for an admin — a way to put it back.
 *
 * Only the columns that actually moved are shown (`diffRevision()`); showing
 * all thirty columns of a Karyawan to reveal the one that changed is how an
 * audit log becomes unreadable.
 */
import { Badge } from "@/components/ui/badge";
import { isLoggedTable } from "@/lib/revisions/tables";
import { REVISION_ACTION_LABELS } from "@/lib/i18n/terms";
import type { Revision } from "@/lib/types/db";

import RevertRevisionButton from "./RevertRevisionButton";
import {
  actorLabel,
  diffRevision,
  formatValue,
  formatWaktu,
  revisionRowTitle,
  shortId,
  tableLabel,
  type ReferenceLabels,
} from "./revisionDiff";

export type RevisionCardProps = {
  revision: Revision;
  labels: ReferenceLabels;
  /**
   * Show which row this Revisi is about. On a detail page the reader already
   * knows; on the Log Perubahan it is the whole point.
   */
  showRow?: boolean;
  /** Show "Kembalikan". Admin only — a viewer reads the log, never reverts. */
  canRevert?: boolean;
  onReverted?: (result: { batchId: string; revisionId: number }) => void;
};

export function RevisionCard({
  revision,
  labels,
  showRow = false,
  canRevert = false,
  onReverted,
}: RevisionCardProps) {
  const table = revision.table_name;
  const fields = isLoggedTable(table)
    ? diffRevision(table, revision.before, revision.after)
    : [];
  const isInsert = revision.action === "insert";
  const rowTitle = revisionRowTitle(revision, labels);

  const aksiLabel =
    revision.action === "insert" || revision.action === "update"
      ? REVISION_ACTION_LABELS[revision.action]
      : revision.action;

  return (
    <li className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isInsert ? "secondary" : "outline"}>{aksiLabel}</Badge>
            {showRow ? (
              <span className="text-sm font-medium">
                {tableLabel(table)} · {rowTitle}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatWaktu(revision.created_at)} · oleh{" "}
            {actorLabel(revision.actor_id, labels)} · Revisi #{revision.id}
          </p>
        </div>

        {canRevert ? (
          <RevertRevisionButton
            revision={revision}
            rowTitle={showRow ? `${tableLabel(table)} · ${rowTitle}` : rowTitle}
            kolomBerubah={fields.map((field) => field.label)}
            onReverted={onReverted}
          />
        ) : null}
      </div>

      {fields.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {isLoggedTable(table)
            ? "Tidak ada kolom yang berubah pada Revisi ini."
            : `Tabel "${table}" tidak dikenal, jadi isinya tidak bisa dijabarkan.`}
        </p>
      ) : (
        <dl className="mt-3 space-y-2">
          {fields.map((field) => {
            const sebelum = formatValue(field.kind, field.before, labels);
            const sesudah = formatValue(field.kind, field.after, labels);
            return (
              <div
                key={field.column}
                className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(9rem,14rem)_1fr]"
              >
                <dt className="text-xs font-medium text-muted-foreground sm:text-sm">
                  {field.label}
                </dt>
                <dd className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  {isInsert ? (
                    <span className="font-medium">{sesudah}</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{sebelum}</span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        →
                      </span>
                      <span className="font-medium">{sesudah}</span>
                      <span className="sr-only">
                        berubah dari {sebelum} menjadi {sesudah}
                      </span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {showRow ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          ID baris: {shortId(revision.row_id)}
        </p>
      ) : null}
    </li>
  );
}

export default RevisionCard;
