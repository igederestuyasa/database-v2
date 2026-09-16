"use client";

/**
 * MergeDialog — the confirmation standing between staf HC and a bulk move of
 * real personnel records (PRD #10).
 *
 * FROZEN CONTRACT (Wave 1). `MergeEntityKind` and `MergeDialogProps` are
 * byte-identical to the Wave 1 stub — Struktur Organisasi, Jabatan, Master
 * Data and "Perlu Dibereskan" (PRD #12) all type against them. Only the body
 * below is new. **Nobody changes these props afterwards.**
 *
 * WHY THIS IS A TWO-STEP DIALOG
 * ---------------------------------------------------------------------------
 * A Merge is not an edit to one row. It moves every Karyawan pointing at the
 * source over to the target, re-parents the source's child Unit Organisasi,
 * and leaves the source `nonaktif` with `merged_into_id` set. At HK that can
 * be hundreds of people in one click, performed by someone non-technical who
 * came here to tidy up a spelling. So the dialog refuses to let the target
 * picker and the "do it" button live on the same screen: step 1 picks, step 2
 * spells out what happens and asks the user to tick that they understood the
 * number. `affectedCount` is the whole reason step 2 exists, so it is the
 * biggest thing on it.
 *
 * The reassurance on step 2 is real, not padding: the source is deactivated,
 * never deleted, and the whole thing is one Batch jenis `merge` that Log
 * Perubahan can revert whole (PRD #16, ADR-003). Saying so is what makes a
 * careful person willing to press the button at all.
 *
 * WHERE THE WORK HAPPENS — NOT HERE
 * ---------------------------------------------------------------------------
 * Three UPDATEs across two tables over PostgREST would be three transactions
 * and three Batch entries, so the whole Merge is one Postgres function per
 * entity (ADR-006). This component picks the matching wrapper in
 * `lib/actions/merge.ts` and renders whatever `ActionResult` comes back. It
 * re-implements none of the rules — not "asal ≠ tujuan", not the cycle check,
 * not the Lookup tipe check. Those live in SQL, where nothing routes around
 * them; here they are only *messages*.
 *
 * The target comes from `EntityPicker`, which cannot be typed into (ADR-002):
 * a Merge that invented its target by name would be the very problem Merge
 * exists to clean up.
 */
import * as React from "react";
import type { ReactElement } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Undo2,
  Users,
} from "lucide-react";

import StatusLabel from "@/components/hc/StatusLabel";
import Tombol from "@/components/hc/Tombol";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ActionErrorCode, ActionResult } from "@/lib/actions/_guard";
import { mergeJabatan, mergeLookup, mergeOrgUnit } from "@/lib/actions/merge";
import type { MergeInput, MergeResult } from "@/lib/actions/merge";
import { NAV_LABELS, STATUS_LABELS, TERMS, UI } from "@/lib/i18n/terms";
import { cn } from "@/lib/utils";

import { EntityPicker, type EntityOption } from "./EntityPicker";

/* ────────────────────────────────────────────────────────────────────────────
 * FROZEN PROPS — do not touch (Wave 1 contract).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which kind of Data Referensi is being merged. */
export type MergeEntityKind = "org_unit" | "jabatan" | "lookup";

export type MergeDialogProps = {
  kind: MergeEntityKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entity that will become nonaktif. */
  source: EntityOption;
  /** Possible targets — already filtered to the same tipe, minus the source. */
  candidates: readonly EntityOption[];
  /** Pre-selected target, e.g. the other half of a Temuan pair. */
  defaultTargetId?: string | null;
  /** How many Karyawan point at `source` and will be moved. */
  affectedCount?: number;
  /** Called after a successful merge, so the page can refresh. */
  onMerged?: (result: { sourceId: string; targetId: string; batchId: string }) => void;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Copy & decisions, as pure functions.
 *
 * Everything the dialog *says* and every branch it takes on a failure is
 * computed here rather than inline in JSX, so the wording that has to be right
 * — the number of Karyawan, "nonaktif bukan dihapus", "bisa dikembalikan" —
 * is unit-testable without a browser.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which screen of the dialog is showing. */
export type MergeStep = "pilih" | "konfirmasi" | "selesai";

/** The three merge wrappers, keyed by `kind`. No logic, just the mapping. */
const MERGE_ACTIONS: Record<
  MergeEntityKind,
  (input: MergeInput) => Promise<ActionResult<MergeResult>>
> = {
  org_unit: mergeOrgUnit,
  jabatan: mergeJabatan,
  lookup: mergeLookup,
};

/** CONTEXT.md vocabulary per `kind`, plus the one hint the picker needs. */
export function mergeKindCopy(kind: MergeEntityKind): {
  entitas: string;
  petunjukTujuan: string | null;
} {
  switch (kind) {
    case "org_unit":
      return {
        entitas: TERMS.unitOrganisasi,
        petunjukTujuan:
          "Tujuan tidak boleh berada di bawah asal — itu akan membuat hierarki berputar.",
      };
    case "jabatan":
      return { entitas: TERMS.jabatan, petunjukTujuan: null };
    case "lookup":
      return {
        entitas: TERMS.lookup,
        petunjukTujuan: "Tujuan harus satu tipe dengan asal.",
      };
  }
}

/**
 * `affectedCount` as a number we are willing to print, or `null` for "belum
 * dihitung". A caller that has not counted yet omits the prop; one that hands
 * over something nonsensical must not turn into "NaN Karyawan akan pindah".
 */
export function normalizeAffectedCount(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

/**
 * Thousands separator, Indonesian, done by hand.
 *
 * `toLocaleString("id-ID")` depends on the ICU data of whatever runtime is
 * rendering, and this number appears in the sentence the user is asked to
 * agree with. Deterministic beats clever.
 */
export function formatJumlah(value: number): string {
  return Math.trunc(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The headline: how many Karyawan move. `null` = not counted. */
export function jumlahKaryawanText(jumlah: number | null): string {
  if (jumlah === null) return `Jumlah ${TERMS.karyawan} belum dihitung`;
  if (jumlah === 0) return `Tidak ada ${TERMS.karyawan} yang pindah`;
  return `${formatJumlah(jumlah)} ${TERMS.karyawan} pindah`;
}

/**
 * Everything this Merge will do, in the order it will do it — the last thing
 * the user reads before confirming.
 */
export function mergeImpactLines(
  kind: MergeEntityKind,
  sourceLabel: string,
  targetLabel: string,
  jumlah: number | null,
): string[] {
  const { entitas } = mergeKindCopy(kind);
  const lines: string[] = [];

  if (jumlah === null) {
    lines.push(
      `Semua ${TERMS.karyawan} yang merujuk «${sourceLabel}» dipindahkan ke «${targetLabel}». Jumlahnya belum dihitung.`,
    );
  } else if (jumlah === 0) {
    lines.push(
      `Tidak ada ${TERMS.karyawan} yang merujuk «${sourceLabel}», jadi tidak ada yang dipindahkan.`,
    );
  } else {
    lines.push(
      `${formatJumlah(jumlah)} ${TERMS.karyawan} dipindahkan dari «${sourceLabel}» ke «${targetLabel}».`,
    );
  }

  if (kind === "org_unit") {
    lines.push(
      `Semua ${TERMS.unitOrganisasi} di bawah «${sourceLabel}» dipindahkan ke bawah «${targetLabel}».`,
    );
  }

  lines.push(
    `«${sourceLabel}» menjadi ${STATUS_LABELS.nonaktif} dan mencatat «${targetLabel}» sebagai tujuannya. ${entitas} asal tidak dihapus.`,
  );
  lines.push(
    `Seluruhnya tercatat sebagai satu ${TERMS.batch} di ${NAV_LABELS.log} dan bisa dikembalikan utuh.`,
  );

  return lines;
}

/** What the dialog does with a failed `ActionResult`. */
export type MergeFailureAdvice = {
  /** Which step to show the message on. */
  langkah: Exclude<MergeStep, "selesai">;
  /** Whether pressing "Gabungkan sekarang" again could possibly help. */
  bolehUlangi: boolean;
  /** One sentence under the server's own message, telling the user what to do. */
  saran: string;
};

/**
 * `ActionErrorCode` → what staf HC should do about it.
 *
 * The server's message is already the Indonesian sentence HC Core's own SQL
 * raised ("Unit Organisasi «X» sudah pernah digabungkan."), so it is shown
 * verbatim; this only adds the next move. Every merge RPC runs in one
 * transaction, so a refusal really did change nothing — which is the most
 * useful thing a frightened user can be told.
 */
export function mergeFailureAdvice(code: ActionErrorCode): MergeFailureAdvice {
  switch (code) {
    case "TIDAK_LOGIN":
      return {
        langkah: "konfirmasi",
        bolehUlangi: false,
        saran: "Sesi Anda sudah berakhir. Login lagi, lalu ulangi Merge. Tidak ada data yang berubah.",
      };
    case "BUKAN_ADMIN":
      return {
        langkah: "konfirmasi",
        bolehUlangi: false,
        saran: `Hanya ${TERMS.admin} yang bisa menjalankan Merge. Tidak ada data yang berubah.`,
      };
    case "VALIDASI":
      return {
        langkah: "pilih",
        bolehUlangi: false,
        saran: "Pilih tujuan Merge yang berbeda dari asalnya.",
      };
    case "TIDAK_DITEMUKAN":
      return {
        langkah: "pilih",
        bolehUlangi: false,
        saran: "Data mungkin sudah berubah di layar lain. Muat ulang halaman, lalu pilih tujuan lagi.",
      };
    case "KONFLIK":
      return {
        langkah: "pilih",
        bolehUlangi: false,
        saran: "Merge dibatalkan seluruhnya dan tidak ada data yang berubah. Pilih tujuan lain, atau muat ulang halaman kalau orang lain baru saja menggabungkan data ini.",
      };
    case "GAGAL":
      return {
        langkah: "konfirmasi",
        bolehUlangi: true,
        saran: `Merge tidak selesai. Coba lagi; kalau tetap gagal, periksa ${NAV_LABELS.log} sebelum mengulang.`,
      };
  }
}

/** What the success screen reports back. */
export function mergeResultLines(
  kind: MergeEntityKind,
  sourceLabel: string,
  targetLabel: string,
  result: MergeResult,
): string[] {
  const lines = [
    `${formatJumlah(result.movedEmployees)} ${TERMS.karyawan} dipindahkan ke «${targetLabel}».`,
  ];
  if (kind === "org_unit") {
    lines.push(
      `${formatJumlah(result.movedChildren)} ${TERMS.unitOrganisasi} dipindahkan ke bawah «${targetLabel}».`,
    );
  }
  lines.push(
    `«${sourceLabel}» sekarang ${STATUS_LABELS.nonaktif} dan menunjuk «${targetLabel}».`,
  );
  return lines;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The dialog.
 * ──────────────────────────────────────────────────────────────────────────── */

type MergeFailure = { code: ActionErrorCode; message: string };

/** One side of the "asal → tujuan" pair, named in full. */
function EntityCard({
  peran,
  option,
  emphasis,
}: {
  peran: string;
  option: EntityOption | null;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-kartu border border-border p-3",
        emphasis ? "border-primary/40 bg-primary/5" : "bg-muted/40",
      )}
    >
      <p className="text-mikro font-normal text-muted-foreground">{peran}</p>
      {option ? (
        <>
          <p className="mt-1 break-words font-medium leading-snug">{option.label}</p>
          {/* A <div>, not a <p>: Badge renders a <div>, and components/ui is frozen. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-mikro font-normal text-muted-foreground">
            {option.keterangan ? <span className="break-words">{option.keterangan}</span> : null}
            {option.status === "nonaktif" ? (
              <StatusLabel>{STATUS_LABELS.nonaktif}</StatusLabel>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-1 text-pendukung text-muted-foreground">Belum dipilih</p>
      )}
    </div>
  );
}

export function MergeDialog({
  kind,
  open,
  onOpenChange,
  source,
  candidates,
  defaultTargetId,
  affectedCount,
  onMerged,
}: MergeDialogProps): ReactElement {
  const [step, setStep] = React.useState<MergeStep>("pilih");
  const [targetId, setTargetId] = React.useState<string | null>(defaultTargetId ?? null);
  const [paham, setPaham] = React.useState(false);
  const [failure, setFailure] = React.useState<MergeFailure | null>(null);
  const [result, setResult] = React.useState<MergeResult | null>(null);
  /**
   * The target's label as it read when the RPC was called.
   *
   * `onMerged` normally makes the page re-fetch, and the merged pair is
   * exactly what drops out of the refreshed `candidates` — so looking the
   * target up again while the result is on screen can yield nothing, and the
   * one screen that says where 1.475 Karyawan went would read «».
   */
  const [labelTujuan, setLabelTujuan] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  /**
   * Every *opening* starts from a clean slate: a dialog that reopens still
   * holding the previous target — or the previous error — is how someone
   * merges the wrong pair.
   *
   * Only the closed→open transition resets, never a `defaultTargetId` that
   * changes while the dialog is up. The page re-fetches in response to
   * `onMerged`, and that can change the prop; resetting then would replace the
   * "Merge selesai" screen — and the link to the Batch that undoes it — with
   * an empty picker for a source that is already nonaktif.
   */
  const sedangTerbuka = React.useRef(false);
  React.useEffect(() => {
    if (open === sedangTerbuka.current) return;
    sedangTerbuka.current = open;
    if (!open) return;
    setStep("pilih");
    setTargetId(defaultTargetId ?? null);
    setPaham(false);
    setFailure(null);
    setResult(null);
    setLabelTujuan(null);
  }, [open, defaultTargetId]);

  const { entitas, petunjukTujuan } = mergeKindCopy(kind);

  // The props promise the source is already gone from `candidates`. Merging a
  // row into itself is refused in SQL anyway, but offering it at all is a trap.
  const options = React.useMemo(
    () => candidates.filter((option) => option.id !== source.id),
    [candidates, source.id],
  );
  const target = React.useMemo(
    () => options.find((option) => option.id === targetId) ?? null,
    [options, targetId],
  );

  const jumlah = normalizeAffectedCount(affectedCount);
  const perluCentang = jumlah === null || jumlah > 0;
  const advice = failure ? mergeFailureAdvice(failure.code) : null;
  const impact = target ? mergeImpactLines(kind, source.label, target.label, jumlah) : [];

  const pilihTujuan = (id: string | null) => {
    setTargetId(id);
    setPaham(false);
    // A new target is a new attempt; keeping the old refusal on screen would
    // read as if it applied to this one.
    setFailure(null);
  };

  const kembaliKePilih = () => {
    setFailure(null);
    setStep("pilih");
  };

  // Clearing the refusal matters: an advice of `bolehUlangi: false` disables
  // "Gabungkan sekarang", so carrying a KONFLIK forward from step 1 would land
  // the user on a confirm screen with no enabled action on it.
  const lanjutKeKonfirmasi = () => {
    setFailure(null);
    setStep("konfirmasi");
  };

  const tutup = (next: boolean) => {
    // Never yank the dialog away mid-RPC: the user would be left not knowing
    // whether hundreds of Karyawan moved.
    if (!next && isPending) return;
    onOpenChange(next);
  };

  const jalankanMerge = () => {
    if (!target || isPending) return;
    setFailure(null);
    setLabelTujuan(target.label);

    startTransition(async () => {
      try {
        const hasil = await MERGE_ACTIONS[kind]({
          sourceId: source.id,
          targetId: target.id,
        });

        if (!hasil.ok) {
          const next = mergeFailureAdvice(hasil.error.code);
          setFailure({ code: hasil.error.code, message: hasil.error.message });
          setStep(next.langkah);
          if (next.langkah === "pilih") setPaham(false);
          return;
        }

        setResult(hasil.data);
        setStep("selesai");
        onMerged?.({
          sourceId: hasil.data.sourceId,
          targetId: hasil.data.targetId,
          batchId: hasil.data.batchId,
        });
      } catch {
        // A Server Action that throws reaches the browser as an opaque digest.
        setFailure({
          code: "GAGAL",
          message: "Gagal menghubungi server. Periksa koneksi Anda, lalu coba lagi.",
        });
        setStep("konfirmasi");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        {step === "selesai" && result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-primary" />
                Merge selesai
              </DialogTitle>
              <DialogDescription>
                «{source.label}» sudah digabungkan ke «{labelTujuan ?? result.targetId}».
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-2 text-pendukung">
              {mergeResultLines(
                kind,
                source.label,
                labelTujuan ?? result.targetId,
                result,
              ).map((line) => (
                <li key={line} className="flex gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-kartu border border-border bg-muted p-3 text-pendukung">
              <p className="flex items-center gap-2 font-medium">
                <Undo2 aria-hidden="true" className="h-4 w-4" />
                Bisa dikembalikan
              </p>
              <p className="mt-1 text-muted-foreground">
                Semuanya masuk satu {TERMS.batch}. Buka {NAV_LABELS.log} untuk melihat atau
                mengembalikannya.
              </p>
              <Link
                href={`/log?batch=${encodeURIComponent(result.batchId)}`}
                className="mt-2 inline-block text-pendukung font-medium text-primary underline-offset-4 hover:underline"
              >
                Buka {NAV_LABELS.log}
              </Link>
            </div>

            <DialogFooter>
              <Tombol type="button" onClick={() => onOpenChange(false)}>
                Tutup
              </Tombol>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {step === "pilih" ? `${TERMS.merge} ${entitas}` : `Konfirmasi ${TERMS.merge}`}
              </DialogTitle>
              <DialogDescription>
                {step === "pilih"
                  ? `Pilih ${entitas} tujuan. Semua ${TERMS.karyawan} yang merujuk «${source.label}» akan dipindahkan ke sana, dan «${source.label}» menjadi ${STATUS_LABELS.nonaktif}.`
                  : `Periksa sekali lagi sebelum dijalankan. Tindakan ini menyentuh data ${TERMS.karyawan} sungguhan.`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <EntityCard peran="Asal (jadi Nonaktif)" option={source} />
              <div
                aria-hidden="true"
                className="flex shrink-0 items-center justify-center text-muted-foreground"
              >
                <ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" />
              </div>
              <EntityCard peran="Tujuan (data pindah ke sini)" option={target} emphasis />
            </div>

            {step === "pilih" ? (
              <div className="space-y-2">
                <Label htmlFor="merge-tujuan">{entitas} tujuan</Label>
                <EntityPicker
                  id="merge-tujuan"
                  options={options}
                  value={targetId}
                  onChange={pilihTujuan}
                  allowClear={false}
                  placeholder={`Pilih ${entitas} tujuan…`}
                  searchPlaceholder={`${UI.cari} ${entitas}…`}
                  emptyMessage={`Tidak ada ${entitas} lain yang cocok.`}
                  aria-describedby="merge-tujuan-petunjuk"
                  invalid={advice?.langkah === "pilih"}
                />
                <p id="merge-tujuan-petunjuk" className="text-mikro font-normal text-muted-foreground">
                  {petunjukTujuan
                    ? `${petunjukTujuan} Tujuan dipilih dari daftar — tidak bisa diketik bebas.`
                    : "Tujuan dipilih dari daftar — tidak bisa diketik bebas."}
                </p>
                {target?.status === "nonaktif" ? (
                  <p className="text-mikro font-normal text-peringatan">
                    Tujuan yang dipilih berstatus {STATUS_LABELS.nonaktif}. Pastikan ini memang
                    yang Anda maksud.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* The number is why this dialog exists, so it is the loudest thing on it. */}
            <div
              className={cn(
                "rounded-kartu border border-border p-4",
                jumlah === 0
                  ? "bg-muted/40"
                  : "border-destructive/40 bg-destructive/5 text-destructive",
              )}
            >
              <p className="flex items-center gap-2 text-pendukung font-medium">
                <Users aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="text-subjudul font-semibold leading-none">
                  {jumlahKaryawanText(jumlah)}
                </span>
              </p>
              <p
                className={cn(
                  "mt-1 text-pendukung",
                  jumlah === 0 ? "text-muted-foreground" : "text-destructive/90",
                )}
              >
                {target
                  ? `dari «${source.label}» ke «${target.label}».`
                  : `dari «${source.label}» ke tujuan yang Anda pilih.`}
              </p>
            </div>

            {step === "konfirmasi" && target ? (
              <>
                <ul className="space-y-2 text-pendukung">
                  {impact.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                {perluCentang ? (
                  <div className="flex items-start gap-3 rounded-kartu border border-border p-3">
                    <Checkbox
                      id="merge-paham"
                      checked={paham}
                      disabled={isPending}
                      onCheckedChange={(checked) => setPaham(checked === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor="merge-paham" className="leading-snug">
                      Saya mengerti{" "}
                      {jumlah === null
                        ? `semua ${TERMS.karyawan} yang merujuk «${source.label}»`
                        : `${formatJumlah(jumlah)} ${TERMS.karyawan}`}{" "}
                      akan dipindahkan ke «{target.label}».
                    </Label>
                  </div>
                ) : null}
              </>
            ) : null}

            {failure && advice ? (
              <div
                role="alert"
                className="flex gap-2 rounded-kartu border border-destructive/50 bg-destructive/5 p-3 text-pendukung text-destructive"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium break-words">{failure.message}</p>
                  <p className="text-destructive/90">{advice.saran}</p>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Tombol
                type="button"
                nada="sekunder"
                disabled={isPending}
                onClick={step === "pilih" ? () => onOpenChange(false) : kembaliKePilih}
              >
                {step === "pilih" ? UI.batal : "Kembali"}
              </Tombol>

              {step === "pilih" ? (
                <Tombol type="button" disabled={!target} onClick={lanjutKeKonfirmasi}>
                  Lanjutkan
                </Tombol>
              ) : (
                <Tombol
                  type="button"
                  nada="utama"
                  disabled={
                    !target || isPending || (perluCentang && !paham) || advice?.bolehUlangi === false
                  }
                  onClick={jalankanMerge}
                >
                  {isPending ? (
                    <>
                      <Loader2 aria-hidden="true" className="animate-spin" />
                      Menggabungkan…
                    </>
                  ) : (
                    "Gabungkan sekarang"
                  )}
                </Tombol>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default MergeDialog;
