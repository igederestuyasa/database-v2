/**
 * One group of Karyawan fields as a Card with a definition list.
 *
 * A Server Component: it renders text that was already resolved on the server
 * and has no state, so it ships no JavaScript to the browser. Anything
 * interactive on this page (the Riwayat Revisi panel) is its own client
 * component.
 */
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { DetailField } from "./employeeDetailFields";

/**
 * A derived column is marked wherever it appears, because the first question
 * staf HC ask about "Masa Kerja" is why they cannot edit it (PRD #6).
 */
function TandaTurunan() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 font-normal normal-case tracking-normal"
      title="Dihitung otomatis dari tanggal; tidak disimpan dan tidak bisa diubah."
    >
      dihitung otomatis
    </Badge>
  );
}

export function FieldList({ fields }: { fields: readonly DetailField[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.label}
          className={field.lebar ? "min-w-0 sm:col-span-2" : "min-w-0"}
        >
          <dt className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {field.label}
            {field.turunan ? <TandaTurunan /> : null}
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
            {field.value}
          </dd>
          {field.catatan ? (
            <dd className="mt-0.5 break-words text-xs text-muted-foreground">
              {field.catatan}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export type DetailCardProps = {
  judul: string;
  keterangan?: string;
  fields: readonly DetailField[];
  /** Rendered under the fields — an access note, an "belum diisi" line. */
  catatan?: React.ReactNode;
};

export default function DetailCard({
  judul,
  keterangan,
  fields,
  catatan,
}: DetailCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-base">{judul}</CardTitle>
        {keterangan ? <CardDescription>{keterangan}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList fields={fields} />
        {catatan ? (
          <p className="text-xs text-muted-foreground">{catatan}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
