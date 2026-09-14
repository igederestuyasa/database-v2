import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type PagePlaceholderProps = {
  /** Page name in CONTEXT.md vocabulary, e.g. "Perlu Dibereskan". */
  judul: string;
  /** One line about what the finished page will do. */
  keterangan: string;
  /** PRD.md §4 feature numbers this page delivers. */
  fitur?: readonly number[];
};

/**
 * Stub body for a route whose real page has not been built yet.
 *
 * Every route in the app exists from day one so the sidebar never 404s and so
 * smoke tests can walk the whole app. Replacing this placeholder with the real
 * page is exactly what each downstream unit does.
 */
export default function PagePlaceholder({
  judul,
  keterangan,
  fitur,
}: PagePlaceholderProps) {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{judul}</CardTitle>
          <CardDescription>{keterangan}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Halaman ini sedang dibangun.</p>
          {fitur && fitur.length > 0 ? (
            <p>
              Fitur PRD §4 nomor {fitur.join(", ")} akan tampil di sini.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
