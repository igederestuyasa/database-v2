"use client";

/**
 * Unduh template Excel (PRD #24).
 *
 * SheetJS dimuat lewat `import()` dinamis, sama seperti sisi baca: `xlsx`
 * adalah chunk ~400 KB yang tidak boleh ikut ke halaman lain (ADR-008), dan
 * tidak pernah dijalankan di server (ADR-005 §5). Filenya dirakit di peramban
 * admin dan langsung disimpan — tidak ada berkas .xlsx yang di-commit ke repo,
 * jadi template tidak bisa basi tanpa ada yang tahu: isinya dibangkitkan dari
 * `lib/seed/template.ts`, yang dipatok test terhadap pemetaan header.
 */
import * as React from "react";
import { Download } from "lucide-react";

import Tombol from "@/components/hc/Tombol";
import {
  TEMPLATE_NAMA_FILE,
  TEMPLATE_SHEET,
  buildTemplateRows,
  templateColWidths,
} from "@/lib/seed/template";

export default function TombolTemplate({ className }: { className?: string }) {
  const [sedangMenyiapkan, setSedangMenyiapkan] = React.useState(false);
  const [gagal, setGagal] = React.useState<string | null>(null);

  const unduh = async () => {
    setGagal(null);
    setSedangMenyiapkan(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(buildTemplateRows());
      ws["!cols"] = templateColWidths();
      const wb = XLSX.utils.book_new();
      // Nama sheet-nya sengaja sama dengan yang dicari halaman ini, jadi
      // template yang diisi lalu diunggah balik terbaca tanpa memilih sheet.
      XLSX.utils.book_append_sheet(wb, ws, TEMPLATE_SHEET);
      XLSX.writeFile(wb, TEMPLATE_NAMA_FILE);
    } catch (error) {
      console.error("[impor] gagal menyiapkan template", error);
      setGagal("Template gagal disiapkan. Muat ulang halaman ini lalu coba lagi.");
    } finally {
      setSedangMenyiapkan(false);
    }
  };

  return (
    <div className={className}>
      <Tombol nada="sekunder" onClick={unduh} disabled={sedangMenyiapkan}>
        <Download aria-hidden="true" className="h-4 w-4" />
        {sedangMenyiapkan ? "Menyiapkan…" : "Unduh template Excel"}
      </Tombol>
      {gagal ? (
        <p role="alert" className="mt-2 text-pendukung text-destructive">
          {gagal}
        </p>
      ) : null}
    </div>
  );
}
