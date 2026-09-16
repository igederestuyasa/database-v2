"use client";

/**
 * Halaman "Perlu Dibereskan" — daftar Temuan dan cara membereskannya
 * (PRD #11, #12).
 *
 * DESIGNED TO REACH ZERO, NOT TO BE A DASHBOARD
 * ---------------------------------------------------------------------------
 * PRD §7 measures success as "halaman Perlu Dibereskan kosong (atau hanya
 * berisi kasus yang sengaja dibiarkan) setelah pembersihan pertama". Every
 * decision here follows from that: Temuan are ordered by how mechanical they
 * are to fix, each one carries its own fix (Merge or Ganti nama) so nothing
 * sends the admin to another page mid-pass (PRD #12), and the empty state is
 * the goal rather than an error.
 *
 * Nothing here writes to the database. Merge goes through
 * `lib/actions/merge.ts` (which calls the Postgres function that does the
 * whole merge in one Batch, ADR-006); Ganti nama goes through `./actions.ts`.
 * Both are Server Actions that check the role again on the server, because the
 * buttons being hidden from a viewer is a courtesy, not a permission check.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MergeDialog, type MergeEntityKind } from "@/components/shared/MergeDialog";
import type { EntityOption } from "@/components/shared/EntityPicker";
import EmptyState from "@/components/hc/EmptyState";
import PembukaLayar from "@/components/hc/PembukaLayar";
import StatusLabel from "@/components/hc/StatusLabel";
import Tombol from "@/components/hc/Tombol";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AlasanTanpaInduk } from "@/lib/cleaning/findOrphans";
import type { NameDifference } from "@/lib/cleaning/normalize";
import type { ReferenceKind, ReferenceRow } from "@/lib/cleaning/findSimilar";
import { NAV_LABELS, TERMS, UI } from "@/lib/i18n/terms";

import type { BereskanData, Temuan, TemuanJenis } from "../_lib/data";
import { RenameDialog, type RenameTarget } from "./RenameDialog";

type Props = BereskanData & {
  /** Admin sees the fix buttons; viewer reads the list (ARCHITECTURE.md §5). */
  isAdmin: boolean;
};

/** How each difference reads on a badge. PRD #11 names the first three. */
const PERBEDAAN_LABELS: Record<NameDifference, string> = {
  kapitalisasi: "beda kapitalisasi",
  spasi: "beda spasi",
  tanda_baca: "beda tanda baca",
  ampersand: "“&” vs “dan”",
  aksen: "beda aksen",
};

const ENTITAS_LABELS: Record<ReferenceKind, string> = {
  org_unit: TERMS.unitOrganisasi,
  jabatan: TERMS.jabatan,
  lookup: TERMS.lookup,
};

const ALASAN_LABELS: Record<AlasanTanpaInduk, string> = {
  tanpa_induk: "Belum punya induk",
  induk_hilang: "Induknya tidak ada di Struktur Organisasi",
  induk_nonaktif: "Induknya sudah nonaktif",
};

/** Sections, in the order an admin should work through them. */
const SECTIONS: ReadonlyArray<{
  jenis: TemuanJenis;
  judul: string;
  keterangan: string;
}> = [
  {
    jenis: "nama_mirip",
    judul: "Nama mirip",
    keterangan: `Dua ${TERMS.dataReferensi} atau lebih yang hanya berbeda penulisan. Gabungkan lewat ${TERMS.merge}, atau perbaiki ejaannya.`,
  },
  {
    jenis: "unit_senama_induk",
    judul: "Namanya sama dengan induknya",
    keterangan: `${TERMS.unitOrganisasi} yang namanya persis sama dengan induknya, jadi satu tingkat hierarki tidak menambah informasi apa pun.`,
  },
  {
    jenis: "unit_tanpa_induk",
    judul: `${TERMS.unitOrganisasi} tanpa induk`,
    keterangan:
      "Hanya Direktorat yang boleh berada di puncak. Tentukan induknya di Struktur Organisasi.",
  },
  {
    jenis: "karyawan_tanpa_referensi",
    judul: `${TERMS.karyawan} tanpa ${TERMS.unitOrganisasi} atau ${TERMS.jabatan}`,
    keterangan: `Kolomnya kosong sejak ${TERMS.seed}. Isi dari halaman ${TERMS.karyawan}.`,
  },
];

type MergeState = {
  kind: MergeEntityKind;
  source: EntityOption;
  candidates: EntityOption[];
  defaultTargetId: string | null;
  affectedCount: number | undefined;
};

function toEntityOption(row: ReferenceRow): EntityOption {
  return {
    id: row.id,
    label: row.nama,
    keterangan: row.keterangan ? `${row.kode} · ${row.keterangan}` : row.kode,
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
  };
}

export function BereskanClient({
  temuan,
  ringkasan,
  total,
  kandidat,
  jumlahKaryawan,
  catatan,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [merge, setMerge] = React.useState<MergeState | null>(null);
  const [rename, setRename] = React.useState<RenameTarget | null>(null);

  const bukaMerge = (state: MergeState) => setMerge(state);

  /**
   * After a successful Merge: refresh, and **do not close the dialog**.
   *
   * MergeDialog calls `onMerged` and then shows its own "Merge selesai" step,
   * which carries the link to the Batch that undoes the move. Closing from
   * here would destroy the one screen that says how to undo a bulk change —
   * and on this page the admin merges over and over, so they would hit that
   * every time. Closing is `onOpenChange`'s job, when they are done reading.
   */
  const setelahMerge = () => {
    // The Server Action already revalidated; this pulls the recomputed Temuan
    // list into the page the admin is still standing on.
    router.refresh();
  };

  const kandidatUntuk = (entitas: ReferenceKind, tipe: string | null): EntityOption[] => {
    if (entitas === "org_unit") return kandidat.org_unit;
    if (entitas === "jabatan") return kandidat.jabatan;
    return (tipe && kandidat.lookup[tipe]) || [];
  };

  const bySection = (jenis: TemuanJenis): Temuan[] =>
    temuan.filter((item) => item.jenis === jenis);

  return (
    <div className="space-y-12 pb-4">
      <PembukaLayar
        salam="Pembersihan data"
        judul={NAV_LABELS.bereskan}
        info={`Daftar ${TERMS.temuan} data kotor yang dihitung ulang setiap kali halaman dibuka — tidak ada yang disimpan. Halaman ini selesai ketika kosong.`}
      >
        <div className="space-y-3">
          {total > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusLabel nada="peringatan">
                {total} {TERMS.temuan}
              </StatusLabel>
              {SECTIONS.filter((section) => ringkasan[section.jenis] > 0).map(
                (section) => (
                  <StatusLabel key={section.jenis}>
                    {section.judul}: {ringkasan[section.jenis]}
                  </StatusLabel>
                ),
              )}
            </div>
          ) : null}

          {!isAdmin && total > 0 ? (
            <p className="text-pendukung text-muted-foreground">{UI.hanyaAdmin}</p>
          ) : null}

          {catatan.map((baris) => (
            <p key={baris} className="text-pendukung text-muted-foreground">
              {baris}
            </p>
          ))}
        </div>
      </PembukaLayar>

      {total === 0 ? (
        <EmptyState
          judul={`Tidak ada ${TERMS.temuan}`}
          ajakan={`${TERMS.dataReferensi} sudah rapi: tidak ada nama mirip, tidak ada ${TERMS.unitOrganisasi} tanpa induk, dan setiap ${TERMS.karyawan} aktif punya ${TERMS.unitOrganisasi} dan ${TERMS.jabatan}.`}
        />
      ) : null}

      {SECTIONS.map((section) => {
        const isi = bySection(section.jenis);
        if (isi.length === 0) return null;

        return (
          <section key={section.jenis} className="space-y-3">
            <div className="space-y-1">
              {/* Kelompok HC Panel: judul 14/650 dengan jumlahnya, keterangan
                  ditumpuk di bawah judul. */}
              <h2 className="text-label font-[650] text-foreground">
                {section.judul}{" "}
                <span className="font-medium text-muted-foreground">
                  {isi.length}
                </span>
              </h2>
              <p className="text-pendukung text-muted-foreground">
                {section.keterangan}
              </p>
            </div>

            <div className="space-y-3">
              {isi.map((item) => {
                if (item.jenis === "nama_mirip") {
                  const kandidatnya = kandidatUntuk(item.entitas, item.tipe);
                  return (
                    <Card key={item.id} className="hc-permukaan rounded-kartu border-border shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-judul-item">
                          <span>{ENTITAS_LABELS[item.entitas]}</span>
                          {item.perbedaan.length > 0 ? (
                            item.perbedaan.map((beda) => (
                              <StatusLabel key={beda}>
                                {PERBEDAAN_LABELS[beda]}
                              </StatusLabel>
                            ))
                          ) : (
                            // No named dimension. Two rows spelled exactly the
                            // same are a different (and stronger) case than two
                            // rows whose difference normalization has no word
                            // for — saying "penulisan berbeda" over identical
                            // strings would read as a bug.
                            <StatusLabel>
                              {item.namaIdentik ? "nama identik" : "penulisan berbeda"}
                            </StatusLabel>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {item.baris.map((row) => {
                          const jumlah = jumlahKaryawan[row.id];
                          const lawan = item.baris.find((lain) => lain.id !== row.id);
                          return (
                            <div
                              key={row.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-bidang border border-border px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-pendukung font-semibold">{row.nama}</p>
                                <p className="truncate text-mikro font-normal text-muted-foreground">
                                  {row.kode}
                                  {row.keterangan ? ` · ${row.keterangan}` : ""}
                                  {typeof jumlah === "number"
                                    ? ` · ${jumlah} ${TERMS.karyawan}`
                                    : ""}
                                </p>
                              </div>

                              {isAdmin ? (
                                <div className="flex shrink-0 gap-2">
                                  <Tombol
                                    ukuran="ringkas"
                                    nada="sekunder"
                                    onClick={() =>
                                      setRename({
                                        kind: item.entitas,
                                        id: row.id,
                                        nama: row.nama,
                                        kode: row.kode,
                                      })
                                    }
                                  >
                                    Ganti nama
                                  </Tombol>
                                  <Tombol
                                    ukuran="ringkas"
                                    onClick={() =>
                                      bukaMerge({
                                        kind: item.entitas,
                                        source: toEntityOption(row),
                                        candidates: kandidatnya.filter(
                                          (pilihan) => pilihan.id !== row.id,
                                        ),
                                        defaultTargetId:
                                          item.baris.length === 2 && lawan
                                            ? lawan.id
                                            : null,
                                        affectedCount: jumlahKaryawan[row.id],
                                      })
                                    }
                                  >
                                    {TERMS.merge}…
                                  </Tombol>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  );
                }

                if (item.jenis === "unit_senama_induk") {
                  return (
                    <Card key={item.id} className="hc-permukaan rounded-kartu border-border shadow-none">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                        <div className="min-w-0">
                          <p className="truncate text-pendukung font-semibold">{item.unit.nama}</p>
                          <p className="truncate text-mikro font-normal text-muted-foreground">
                            {item.unit.kode} · induknya “{item.induk.nama}” (
                            {item.induk.kode})
                            {typeof jumlahKaryawan[item.unit.id] === "number"
                              ? ` · ${jumlahKaryawan[item.unit.id]} ${TERMS.karyawan}`
                              : ""}
                          </p>
                        </div>
                        {isAdmin ? (
                          <div className="flex shrink-0 gap-2">
                            <Tombol
                              ukuran="ringkas"
                              nada="sekunder"
                              onClick={() =>
                                setRename({
                                  kind: "org_unit",
                                  id: item.unit.id,
                                  nama: item.unit.nama,
                                  kode: item.unit.kode,
                                })
                              }
                            >
                              Ganti nama
                            </Tombol>
                            <Tombol
                              ukuran="ringkas"
                              onClick={() =>
                                bukaMerge({
                                  kind: "org_unit",
                                  source: {
                                    id: item.unit.id,
                                    label: item.unit.nama,
                                    keterangan: item.unit.kode,
                                    status: "aktif",
                                  },
                                  candidates: kandidat.org_unit.filter(
                                    (pilihan) => pilihan.id !== item.unit.id,
                                  ),
                                  defaultTargetId: item.induk.id,
                                  affectedCount: jumlahKaryawan[item.unit.id],
                                })
                              }
                            >
                              Gabungkan ke induk…
                            </Tombol>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                }

                if (item.jenis === "unit_tanpa_induk") {
                  return (
                    <Card key={item.id} className="hc-permukaan rounded-kartu border-border shadow-none">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                        <div className="min-w-0">
                          <p className="truncate text-pendukung font-semibold">{item.unit.nama}</p>
                          <p className="truncate text-mikro font-normal text-muted-foreground">
                            {item.unit.kode} · {ALASAN_LABELS[item.alasan]}
                          </p>
                        </div>
                        <Tombol asChild ukuran="ringkas" nada="sekunder" className="shrink-0">
                          <Link href="/struktur">Buka {NAV_LABELS.struktur}</Link>
                        </Tombol>
                      </CardContent>
                    </Card>
                  );
                }

                return (
                  <Card key={item.id} className="hc-permukaan rounded-kartu border-border shadow-none">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                      <div className="min-w-0">
                        <p className="truncate text-pendukung font-semibold">{item.karyawan.full_name}</p>
                        <p className="truncate text-mikro font-normal text-muted-foreground">
                          {item.karyawan.personnel_number} · belum punya{" "}
                          {item.kekurangan
                            .map((kurang) =>
                              kurang === "unit" ? TERMS.unitOrganisasi : TERMS.jabatan,
                            )
                            .join(" dan ")}
                        </p>
                      </div>
                      <Tombol asChild ukuran="ringkas" nada="sekunder" className="shrink-0">
                        <Link href={`/karyawan/${item.karyawan.id}`}>
                          {UI.lihatDetail}
                        </Link>
                      </Tombol>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      {/*
        Mounted only while a Merge is being set up. MergeDialog belongs to the
        Merge unit and throws until that lands, so rendering it unconditionally
        would take the whole page down with it.
      */}
      {merge ? (
        <MergeDialog
          kind={merge.kind}
          open
          onOpenChange={(open) => {
            if (!open) setMerge(null);
          }}
          source={merge.source}
          candidates={merge.candidates}
          defaultTargetId={merge.defaultTargetId}
          affectedCount={merge.affectedCount}
          onMerged={setelahMerge}
        />
      ) : null}

      {rename ? (
        <RenameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRename(null);
          }}
          target={rename}
          onRenamed={() => {
            setRename(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export default BereskanClient;
