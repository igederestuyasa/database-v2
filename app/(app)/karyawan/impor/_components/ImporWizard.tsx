"use client";

/**
 * Impor Karyawan dari Excel (PRD #24, ADR-009) — three screens, one RPC.
 *
 *   pilih      → the admin picks the Excel file. It is read HERE, in the
 *                browser: SheetJS never runs on the server (ADR-005 §5), and
 *                the file itself never leaves the admin's machine. What goes to
 *                the server is the plan, as JSON.
 *   pratinjau  → the `--dry-run` report: what will be created, how many of the
 *                people in the file already exist, every Peringatan, every
 *                error. With an error there is no button.
 *   selesai    → what actually changed: baru, diperbarui, tidak berubah.
 *
 * BOLEH DIULANG. Ini bukan lagi layar sekali-jalan: Personnel Number adalah
 * kuncinya, jadi file yang sama boleh diunggah lagi setelah diperbaiki, dan
 * file berisi sepuluh orang baru boleh diunggah di atas 1.475 yang sudah ada.
 * Yang menjaga itu semua ada di SQL (`import_from_payload()`), bukan di sini.
 *
 * Reading and planning are the same code the CLI runs (`lib/seed/excelMapping`),
 * so a file that dry-runs clean on a laptop previews clean here, and the other
 * way round.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkBook } from "xlsx";

import Tombol from "@/components/hc/Tombol";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jalankanImpor, type ImporResult } from "@/lib/actions/impor";
import { TERMS } from "@/lib/i18n/terms";
import { HEADER_ROW, planSeed, type SeedPlan } from "@/lib/seed/excelMapping";
import { buildSeedPayload } from "@/lib/seed/payload";
import {
  baristIssue,
  ringkasSeedPlan,
  type RingkasanSeed,
} from "@/lib/seed/ringkasan";

import TombolTemplate from "./TombolTemplate";
import {
  barisHasil,
  barisRingkasan,
  bolehJalankan,
  hitungKecocokan,
  keteranganDefault,
  periksaFile,
  pilihSheet,
  type ImporStep,
} from "./imporWizard";

type Bacaan = {
  namaFile: string;
  workbook: WorkBook;
  sheetNames: string[];
  sheetName: string | null;
  catatanSheet: string | null;
};

/** Sheet → rows, with exactly the options the CLI's `readSheet()` uses. */
async function bacaRencana(
  workbook: WorkBook,
  sheetName: string,
): Promise<SeedPlan> {
  const XLSX = await import("xlsx");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  return planSeed(rows, {
    headerRowNumber: HEADER_ROW,
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
  });
}

export default function ImporWizard({
  personnelNumbers,
}: {
  /**
   * Setiap Personnel Number yang sudah ada, dibaca halaman ini di server.
   * Dipakai pratinjau untuk memisahkan "baru" dari "sudah ada" — lihat
   * `hitungKecocokan()`.
   */
  personnelNumbers: readonly string[];
}) {
  const router = useRouter();
  const sudahAda = React.useMemo(
    () => new Set(personnelNumbers),
    [personnelNumbers],
  );
  const [step, setStep] = React.useState<ImporStep>("pilih");
  const [bacaan, setBacaan] = React.useState<Bacaan | null>(null);
  const [plan, setPlan] = React.useState<SeedPlan | null>(null);
  const [ringkasan, setRingkasan] = React.useState<RingkasanSeed | null>(null);
  const [keterangan, setKeterangan] = React.useState("");
  const [paham, setPaham] = React.useState(false);
  const [sedangMembaca, setSedangMembaca] = React.useState(false);
  const [kegagalan, setKegagalan] = React.useState<string | null>(null);
  const [hasil, setHasil] = React.useState<ImporResult | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const mulaiUlang = () => {
    setStep("pilih");
    setBacaan(null);
    setPlan(null);
    setRingkasan(null);
    setKeterangan("");
    setPaham(false);
    setKegagalan(null);
  };

  const terapkanSheet = React.useCallback(
    async (workbook: WorkBook, sheetName: string, namaFile: string) => {
      const rencana = await bacaRencana(workbook, sheetName);
      setPlan(rencana);
      setRingkasan(ringkasSeedPlan(rencana));
      setKeterangan(keteranganDefault(namaFile));
      setPaham(false);
      setKegagalan(null);
      setStep("pratinjau");
    },
    [],
  );

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setKegagalan(null);

    const tolak = periksaFile(file.name, file.size);
    if (tolak) {
      setKegagalan(tolak);
      return;
    }

    setSedangMembaca(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
        type: "array",
        cellDates: false,
      });
      const sheetNames = workbook.SheetNames ?? [];
      const pilihan = pilihSheet(sheetNames);
      setBacaan({
        namaFile: file.name,
        workbook,
        sheetNames,
        sheetName: pilihan.nama,
        catatanSheet: pilihan.catatan,
      });
      if (pilihan.nama) await terapkanSheet(workbook, pilihan.nama, file.name);
    } catch (error) {
      console.error("[impor] gagal membaca file", error);
      setKegagalan(
        `File "${file.name}" tidak bisa dibaca sebagai workbook Excel. Simpan ulang dari Excel sebagai .xlsx, lalu coba lagi.`,
      );
    } finally {
      setSedangMembaca(false);
    }
  };

  const onPilihSheet = async (sheetName: string) => {
    if (!bacaan) return;
    setSedangMembaca(true);
    try {
      setBacaan({ ...bacaan, sheetName, catatanSheet: null });
      await terapkanSheet(bacaan.workbook, sheetName, bacaan.namaFile);
    } catch (error) {
      console.error("[impor] gagal membaca sheet", error);
      setKegagalan(`Sheet "${sheetName}" tidak bisa dibaca.`);
    } finally {
      setSedangMembaca(false);
    }
  };

  const jalankan = () => {
    if (!plan || !bacaan || !ringkasan) return;
    setKegagalan(null);
    startTransition(async () => {
      let payload;
      try {
        payload = buildSeedPayload(plan);
      } catch (error) {
        console.error("[impor] rencana rusak", error);
        setKegagalan(
          "Rencana Impor tidak konsisten. Pilih ulang filenya; kalau terulang, laporkan.",
        );
        return;
      }
      const result = await jalankanImpor({
        payload,
        sumber: bacaan.namaFile,
        keterangan: keterangan.trim() || undefined,
      });
      if (!result.ok) {
        setKegagalan(result.error.message);
        return;
      }
      setHasil(result.data);
      setStep("selesai");
      router.refresh();
    });
  };

  if (step === "selesai" && hasil) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {TERMS.impor} selesai. Semuanya masuk satu {TERMS.batch}.
          </CardTitle>
          <CardDescription>
            {hasil.karyawanBaru} {TERMS.karyawan} baru,{" "}
            {hasil.karyawanDiperbarui} diperbarui, {hasil.karyawanTetap} tidak
            berubah. Setiap perubahan tercatat sebagai {TERMS.revisi} dan bisa
            dikembalikan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 text-pendukung sm:grid-cols-[14rem_1fr]">
            {barisHasil(hasil).map((baris) => (
              <React.Fragment key={baris.label}>
                <dt className="text-muted-foreground">{baris.label}</dt>
                <dd className="font-mono break-all">{baris.nilai}</dd>
              </React.Fragment>
            ))}
          </dl>
          <p className="text-pendukung text-muted-foreground">
            Kalau hasilnya ternyata salah, buka Log Perubahan, cari{" "}
            {TERMS.batch} di atas, dan tekan &laquo;Kembalikan seluruh{" "}
            {TERMS.batch}&raquo; — hanya perubahan {TERMS.impor} ini yang
            dibalikkan, bukan yang lain. Baris yang ditambahkan ditandai
            nonaktif, bukan dihapus.
          </p>
          <div className="flex flex-wrap gap-2">
            <Tombol asChild>
              <Link href="/karyawan">Buka daftar {TERMS.karyawan}</Link>
            </Tombol>
            <Tombol asChild nada="sekunder">
              <Link href="/log?jenis=impor">Buka Log Perubahan</Link>
            </Tombol>
            <Tombol nada="sekunder" onClick={mulaiUlang}>
              {TERMS.impor} file lain
            </Tombol>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "pratinjau" && ringkasan && bacaan && plan) {
    const baris = barisRingkasan(ringkasan);
    const kecocokan = hitungKecocokan(plan, sudahAda);
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Pratinjau: {bacaan.namaFile}</CardTitle>
            <CardDescription>
              Sheet &laquo;{bacaan.sheetName}&raquo;, header baris {HEADER_ROW}.
              Belum ada yang ditulis. Ini laporan yang sama dengan{" "}
              <code>--dry-run</code> di skrip.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-pendukung sm:grid-cols-[16rem_1fr]">
              {baris.map((b) => (
                <React.Fragment key={b.label}>
                  <dt className="text-muted-foreground">{b.label}</dt>
                  <dd>{b.nilai}</dd>
                </React.Fragment>
              ))}
              <dt className="text-muted-foreground">Dicocokkan ke database</dt>
              <dd>
                {kecocokan.baru} baru, {kecocokan.sudahAda} sudah terdaftar
              </dd>
            </dl>
          </CardContent>
        </Card>

        {ringkasan.error.length > 0 ? (
          <div
            role="alert"
            className="hc-permukaan rounded-kartu border border-destructive/40 bg-destructive/5 p-4 text-pendukung"
          >
            <p className="font-medium">
              GAGAL — {ringkasan.error.length} masalah yang harus dibereskan di
              Excel dulu. Tidak ada yang akan ditulis.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-mikro font-normal">
              {ringkasan.error.map((issue, i) => (
                <li key={`${issue.kode}-${issue.baris ?? "berkas"}-${i}`}>
                  {baristIssue(issue)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {ringkasan.peringatan.length > 0 ? (
          <div className="hc-permukaan rounded-kartu border border-border bg-card p-4 text-pendukung">
            <p className="font-medium">
              Peringatan ({ringkasan.peringatan.length}) — data tetap masuk,
              dibereskan lewat halaman {TERMS.perluDibereskan}.
            </p>
            <ul className="mt-2 max-h-80 list-disc space-y-1 overflow-y-auto pl-5 font-mono text-mikro font-normal">
              {ringkasan.peringatan.map((issue, i) => (
                <li key={`${issue.kode}-${issue.baris ?? "berkas"}-${i}`}>
                  {baristIssue(issue)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {ringkasan.bisaDijalankan ? (
          <Card>
            <CardHeader>
              <CardTitle>Jalankan {TERMS.impor}</CardTitle>
              <CardDescription>
                {kecocokan.baru} {TERMS.karyawan} baru dan {kecocokan.sudahAda}{" "}
                yang sudah terdaftar, sebagai satu {TERMS.batch} jenis{" "}
                {TERMS.impor} dalam satu transaksi: gagal di tengah berarti
                tidak ada yang tertulis. Dari yang sudah terdaftar, hanya yang
                isinya benar-benar berubah yang ditulis ulang.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="impor-keterangan">
                  Keterangan {TERMS.batch}
                </Label>
                <Input
                  id="impor-keterangan"
                  value={keterangan}
                  maxLength={500}
                  onChange={(event) => setKeterangan(event.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="impor-paham"
                  checked={paham}
                  onCheckedChange={(value) => setPaham(value === true)}
                  disabled={isPending}
                />
                <Label
                  htmlFor="impor-paham"
                  className="text-pendukung font-normal leading-snug"
                >
                  Saya paham {TERMS.karyawan} dicocokkan lewat Personnel Number,
                  kolom yang saya kosongkan di Excel TIDAK mengosongkan data
                  yang sudah ada, dan semuanya masuk satu {TERMS.batch} yang
                  bisa dikembalikan utuh.
                </Label>
              </div>
              {kegagalan ? (
                <p role="alert" className="text-pendukung text-destructive">
                  {kegagalan}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Tombol
                  onClick={jalankan}
                  disabled={
                    !bolehJalankan({
                      bisaDijalankan: ringkasan.bisaDijalankan,
                      paham,
                      sedangJalan: isPending,
                    })
                  }
                >
                  {isPending ? "Sedang menulis…" : `Jalankan ${TERMS.impor}`}
                </Tombol>
                <Tombol
                  nada="sekunder"
                  onClick={mulaiUlang}
                  disabled={isPending}
                >
                  Pilih file lain
                </Tombol>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tombol nada="sekunder" onClick={mulaiUlang}>
            Pilih file lain
          </Tombol>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pilih file Excel</CardTitle>
        <CardDescription>
          File dibaca di peramban Anda dan tidak diunggah ke mana pun; yang
          dikirim ke server hanya daftar yang akan dibuat, setelah Anda
          memeriksanya. Belum punya filenya? Unduh templatenya di bawah — nama
          kolomnya persis yang dikenali aplikasi ini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TombolTemplate />
        <div className="space-y-2">
          <Label htmlFor="impor-file">Workbook Karyawan (.xlsx)</Label>
          <Input
            id="impor-file"
            type="file"
            accept=".xlsx,.xlsm"
            onChange={onFile}
            disabled={sedangMembaca}
          />
        </div>
        {sedangMembaca ? (
          <p className="text-pendukung text-muted-foreground">
            Sedang membaca file…
          </p>
        ) : null}
        {bacaan && !bacaan.sheetName ? (
          <div className="space-y-2">
            <p className="text-pendukung">{bacaan.catatanSheet}</p>
            <div className="flex flex-wrap gap-2">
              {bacaan.sheetNames.map((nama) => (
                <Tombol
                  key={nama}
                  nada="sekunder"
                  ukuran="ringkas"
                  onClick={() => onPilihSheet(nama)}
                  disabled={sedangMembaca}
                >
                  {nama}
                </Tombol>
              ))}
            </div>
          </div>
        ) : null}
        {bacaan?.catatanSheet && bacaan.sheetName ? (
          <p className="text-pendukung text-muted-foreground">
            {bacaan.catatanSheet}
          </p>
        ) : null}
        {kegagalan ? (
          <p role="alert" className="text-pendukung text-destructive">
            {kegagalan}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
