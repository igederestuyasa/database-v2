"use client";

/**
 * The Pengguna list, with the role picker on each row.
 *
 * A plain `Table` rather than `components/shared/DataTable`: this list is the
 * staf HC who can open the app, not the ~1.500 Karyawan, so sorting and paging
 * would be furniture nobody uses.
 *
 * The search column stays, though, and it is the one thing on this screen that
 * carries a shadow — docs/DESIGN.md asks every screen for exactly one elevated
 * element, its primary control, and without it this page had none. It earns its
 * place twice over: the list grows by one row every time somebody at the
 * allowed domain signs in for the first time, so "a handful" is a description
 * of today rather than a property of the table; and `/` already focuses the
 * search column on every other list in HC Core, API Key included, which is the
 * same size. A screen that ignores the shortcut everyone else honours is the
 * more expensive kind of exception.
 *
 * No write happens here — the picker calls `setUserRole()` in
 * `lib/actions/profiles.ts` (CLAUDE.md: no insert/update in a Client
 * Component), and the Revisi is written by the `log_revision` trigger.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import {
  indeksBerikutnya,
  type KotakItem,
} from "@/components/hc/navigasiDaftar";
import SearchField from "@/components/hc/SearchField";
import StatusLabel from "@/components/hc/StatusLabel";
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
  const [cari, setCari] = React.useState("");

  // Email saja. Role sudah terbaca sekilas dari kolomnya sendiri, dan tanggal
  // terdaftar bukan sesuatu yang orang ketik untuk mencari seseorang.
  const barisTampil = React.useMemo(() => {
    const kunci = cari.trim().toLowerCase();
    if (kunci === "") return rows;
    return rows.filter((row) => row.email.toLowerCase().includes(kunci));
  }, [rows, cari]);

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

  /*
    Panah antarbaris — docs/DESIGN.md §Aksesibilitas, memakai perhitungan yang
    sama dengan pola daftar-detail (`indeksBerikutnya`).

    Bukan `useDaftarDetail`: hook itu juga menulis `?pilih=<id>` ke URL supaya
    panel detail bisa dibagikan alamatnya, dan layar ini memang tidak punya
    panel. Yang dibutuhkan cuma separuh papan ketiknya, jadi hanya itu yang
    dipasang — tanpa parameter URL yang tidak menunjuk apa pun.
  */
  const refBody = React.useRef<HTMLTableSectionElement | null>(null);

  const elemenBaris = React.useCallback(
    () =>
      Array.from(
        refBody.current?.querySelectorAll<HTMLElement>("[data-item-daftar]") ??
          [],
      ),
    [],
  );

  const fokusBarisPertama = React.useCallback(() => {
    elemenBaris()[0]?.focus();
  }, [elemenBaris]);

  const panahAntarbaris = (event: React.KeyboardEvent) => {
    // Fokus sedang di pemilih role: di sana panah bawah MEMBUKA daftar
    // pilihannya, dan itu perilaku Radix yang tidak boleh direbut daftar ini.
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[role="combobox"]')
    ) {
      return;
    }

    const elemen = elemenBaris();
    if (elemen.length === 0) return;

    const aktif = document.activeElement;
    const sekarang = elemen.findIndex(
      (el) => el === aktif || (aktif instanceof Node && el.contains(aktif)),
    );

    const kotak: KotakItem[] = elemen.map((el) => {
      const kotakEl = el.getBoundingClientRect();
      return { kiri: kotakEl.left, atas: kotakEl.top };
    });

    const tujuan = indeksBerikutnya(kotak, sekarang, event.key);
    if (tujuan === null) return;

    event.preventDefault();
    elemen[tujuan]?.focus();
  };

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
      <p className="rounded-kartu border border-dashed border-garis-putus p-8 text-center text-pendukung text-muted-foreground">
        {UI.tidakAdaData}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <SearchField
        id="cari-pengguna"
        label={`${UI.cari} pengguna`}
        nilai={cari}
        onNilaiChange={setCari}
        placeholder="Alamat email…"
        className="max-w-subjudul"
        onPanahBawah={fokusBarisPertama}
      />

      {barisTampil.length === 0 ? (
        /*
          Kosong KARENA filter, bukan karena datanya belum ada — jadi bukan
          kotak putus-putus. Di HC Panel garis putus-putus berarti "belum ada
          isinya", dan mengatakan itu pada daftar yang sebenarnya berisi hanya
          membuat admin mengira akunnya hilang. Karena itu kalimatnya menyebut
          kata kunci yang dipakai dan jalan keluarnya.
        */
        <p
          role="status"
          className="hc-permukaan rounded-kartu border border-border bg-card px-6 py-8 text-center text-pendukung text-muted-foreground"
        >
          Tidak ada pengguna dengan email yang memuat &laquo;{cari.trim()}
          &raquo;. Ubah kata kuncinya atau kosongkan kolom cari.
        </p>
      ) : (
        <div className="hc-permukaan overflow-x-auto rounded-kartu border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-11 text-mikro">Email</TableHead>
                <TableHead className="h-11 w-[11rem] text-mikro">
                  Role
                </TableHead>
                <TableHead className="h-11 w-[11rem] text-mikro">
                  Terdaftar
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={refBody} onKeyDown={panahAntarbaris}>
              {barisTampil.map((row) => {
                const isSelf = row.id === currentUserId;
                return (
                  <TableRow
                    key={row.id}
                    data-item-daftar=""
                    tabIndex={0}
                    className="text-pendukung transition-colors duration-150 ease-standar hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
                  >
                    <TableCell className="font-medium">
                      <span className="break-all">{row.email}</span>
                      {isSelf ? (
                        <StatusLabel
                          nada="sukses"
                          className="ml-2 align-middle"
                        >
                          Anda
                        </StatusLabel>
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
                        <SelectTrigger
                          className="h-11 text-isi"
                          aria-label={`Role untuk ${row.email}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">
                            {ROLE_LABELS.admin}
                          </SelectItem>
                          {/* Demoting yourself locks you out of the only page that
                          could undo it; the action refuses it too. */}
                          <SelectItem value="viewer" disabled={isSelf}>
                            {ROLE_LABELS.viewer}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {isSelf ? (
                        <p className="mt-1 text-mikro font-normal text-muted-foreground">
                          Role sendiri tidak bisa diturunkan.
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-pendukung tabular-nums text-muted-foreground">
                      {row.dibuat}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default PenggunaTable;
