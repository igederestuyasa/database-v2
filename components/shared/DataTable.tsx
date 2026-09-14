"use client";

/**
 * DataTable — the one table in HC Core.
 *
 * FROZEN CONTRACT (Wave 1). Built on TanStack Table v8 (pinned, ADR-005 §1) on
 * top of the frozen `components/ui/table` primitives. Karyawan, Jabatan, Unit
 * Organisasi, Master Data, API Key and Log Perubahan all render through this,
 * so sorting, filtering, paging and the empty state behave the same everywhere.
 *
 * Two modes:
 *
 *   * **client** (default) — the caller passes every row; this component sorts,
 *     filters and pages them. Right for a few hundred rows: Jabatan, Unit
 *     Organisasi, Master Data.
 *   * **server** — the caller passes one page plus `pagination`, and this
 *     component only renders it and reports page changes. Right for ~1.500
 *     Karyawan, where the query already pages (see `lib/db/employees.ts`).
 *
 * Client-side search is deliberately off in server mode: filtering the 50 rows
 * you can see, while calling it a search over 1.500, is worse than no search.
 * Supply your own control through `toolbar` instead.
 */
import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UI } from "@/lib/i18n/terms";
import { cn } from "@/lib/utils";

/** Server-side paging. Supply all four to switch the table into server mode. */
export type DataTableServerPagination = {
  /** 1-based, as `lib/db` returns it. */
  page: number;
  perPage: number;
  /** Total matching rows, not the length of `data`. */
  total: number;
  onPageChange: (page: number) => void;
};

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /**
   * Show the search box. Default `true`, and **ignored in server mode**: a box
   * that filtered the 50 rows already on screen while looking like a search
   * over 1.500 Karyawan would be worse than no box at all. Pass your own
   * control through `toolbar` and filter in the query instead.
   */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Filters and buttons rendered on the same row as the search box. */
  toolbar?: React.ReactNode;
  /** Shown instead of rows when there are none. Default "Belum ada data.". */
  emptyMessage?: string;
  initialSorting?: SortingState;
  /** Client mode only. Default 25. */
  initialPageSize?: number;
  /** Supply to switch to server mode. */
  pagination?: DataTableServerPagination;
  /** Hide the pager entirely — a short list inside a dialog. */
  hidePagination?: boolean;
  /** Renders a "sedang memuat" row instead of the empty state. */
  isLoading?: boolean;
  /** Makes rows clickable; keep a real link in a cell too, for keyboard users. */
  onRowClick?: (row: TData) => void;
  /** Stable row identity, e.g. `(row) => row.id`. */
  getRowId?: (row: TData, index: number) => string;
  /** Extra classes on the outer wrapper. */
  className?: string;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  searchable,
  searchPlaceholder,
  toolbar,
  emptyMessage,
  initialSorting,
  initialPageSize = 25,
  pagination,
  hidePagination = false,
  isLoading = false,
  onRowClick,
  getRowId,
  className,
}: DataTableProps<TData, TValue>) {
  const serverMode = pagination !== undefined;
  // Never in server mode, whatever the caller asked for — see the prop doc.
  const showSearch = serverMode ? false : (searchable ?? true);

  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // In server mode the caller already paged the rows; paging them again here
    // would hide most of the page it just fetched.
    ...(serverMode ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    manualPagination: serverMode,
    manualFiltering: serverMode,
    getRowId,
    initialState: serverMode ? undefined : { pagination: { pageSize: initialPageSize } },
  });

  const rows = table.getRowModel().rows;
  // Leaf columns, not column defs: a grouped or hidden column would make
  // `columns.length` the wrong colSpan for the placeholder rows.
  const colSpan = table.getVisibleLeafColumns().length || 1;

  const pageInfo = serverMode
    ? {
        page: pagination.page,
        pageCount: Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.perPage))),
        total: pagination.total,
      }
    : {
        page: table.getState().pagination.pageIndex + 1,
        pageCount: Math.max(1, table.getPageCount()),
        total: table.getFilteredRowModel().rows.length,
      };

  const goTo = (page: number) => {
    if (serverMode) pagination.onPageChange(page);
    else table.setPageIndex(page - 1);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {(showSearch || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && (
            <Input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder ?? `${UI.cari}…`}
              aria-label={UI.cari}
              className="h-9 max-w-xs"
            />
          )}
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} aria-sort={ariaSort(sorted)}>
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden="true" className="text-muted-foreground">
                            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  {UI.sedangMemuat}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage ?? UI.tidakAdaData}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!hidePagination && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {pageInfo.total} baris · Halaman {pageInfo.page} dari {pageInfo.pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goTo(pageInfo.page - 1)}
              disabled={pageInfo.page <= 1}
            >
              Sebelumnya
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goTo(pageInfo.page + 1)}
              disabled={pageInfo.page >= pageInfo.pageCount}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ariaSort(
  sorted: false | "asc" | "desc",
): "ascending" | "descending" | undefined {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return undefined;
}

export default DataTable;
