"use client";

/**
 * The Pengguna list, with the role picker on each row.
 *
 * A plain `Table` rather than `components/shared/DataTable`: this list is the
 * handful of staf HC who can open the app, not the ~1.500 Karyawan, so sorting,
 * paging and a search box would be furniture nobody uses.
 *
 * No write happens here — the picker calls `setUserRole()` in
 * `lib/actions/profiles.ts` (CLAUDE.md: no insert/update in a Client
 * Component), and the Revisi is written by the `log_revision` trigger.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { setUserRole } from "@/lib/actions/profiles";
import type { AppRole } from "@/lib/auth/session";
import { ROLE_LABELS, UI } from "@/lib/i18n/terms";

export type PenggunaRow = {
  id: string;
  email: string;
  role: AppRole;
  /** `created_at`, already formatted on the server to avoid a locale mismatch. */
  dibuat: string;
};

export function PenggunaTable({
  rows,
  currentUserId,
}: {
  rows: readonly PenggunaRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();

  // Per row, not one flag for the table: two role changes can be in flight at
  // once, and the first to finish must not re-enable the other one's picker.
  const [pendingIds, setPendingIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // What the picker shows between a successful write and the refreshed server
  // render landing. Cleared whenever fresh `rows` arrive.
  const [savedRoles, setSavedRoles] = React.useState<
    Readonly<Record<string, AppRole>>
  >({});
  React.useEffect(() => {
    setSavedRoles({});
  }, [rows]);

  const markPending = (id: string, pending: boolean) => {
    setPendingIds((previous) => {
      const next = new Set(previous);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const roleOf = (row: PenggunaRow): AppRole => savedRoles[row.id] ?? row.role;

  const ubahRole = (row: PenggunaRow, role: AppRole) => {
    if (role === roleOf(row) || pendingIds.has(row.id)) return;

    markPending(row.id, true);
    startTransition(async () => {
      const result = await setUserRole({ id: row.id, role });
      markPending(row.id, false);

      if (!result.ok) {
        toast.error(result.error.message);
        // Put the picker back where the data still is.
        router.refresh();
        return;
      }

      setSavedRoles((previous) => ({
        ...previous,
        [result.data.id]: result.data.role,
      }));
      toast.success(
        `${result.data.email} sekarang ${ROLE_LABELS[result.data.role]}.`,
      );
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {UI.tidakAdaData}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead className="w-[9rem]">Role</TableHead>
            <TableHead className="w-[11rem]">Terdaftar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelf = row.id === currentUserId;
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <span className="break-all">{row.email}</span>
                  {isSelf ? (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      Anda
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Select
                    value={roleOf(row)}
                    disabled={pendingIds.has(row.id)}
                    onValueChange={(value) =>
                      ubahRole(row, value === "admin" ? "admin" : "viewer")
                    }
                  >
                    <SelectTrigger aria-label={`Role untuk ${row.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                      {/* Demoting yourself locks you out of the only page that
                          could undo it; the action refuses it too. */}
                      <SelectItem value="viewer" disabled={isSelf}>
                        {ROLE_LABELS.viewer}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Role sendiri tidak bisa diturunkan.
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.dibuat}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default PenggunaTable;
