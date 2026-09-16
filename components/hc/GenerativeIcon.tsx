import {
  gambarBentuk,
  putaranSel,
  tundaBentuk,
  type GambarBentuk,
} from "@/lib/ikon/gambarIkon";
import { rancangIkon, type SelIkon } from "@/lib/ikon/rancangIkon";
import { cn } from "@/lib/utils";

/**
 * Ikon item HC Panel — docs/DESIGN.md §Ikon generatif.
 *
 * Tiga berkas, tiga tanggung jawab: `lib/ikon/rancangIkon.ts` memutuskan bentuk
 * apa di sel mana (fungsi yang disalin persis dari spesifikasi dan sama di
 * semua app HC), `lib/ikon/gambarIkon.ts` menghitung koordinatnya, dan berkas
 * ini menempelkan hasilnya ke elemen SVG. Dua yang pertama punya test; yang
 * tersisa di sini tinggal pemilihan warna, dan warnanya semua lewat utility
 * Tailwind — tidak ada satu pun nilai warna yang ditulis di berkas ini.
 *
 * Server Component: tanpa state dan tanpa hook, jadi tidak ada JavaScript yang
 * dikirim ke browser untuk menggambarnya. Animasi rakitnya murni CSS, sehingga
 * ikut mati sendiri saat `prefers-reduced-motion: reduce`.
 *
 * MERAKIT ULANG. Animasi hanya berjalan saat elemennya baru dipasang. Di panel
 * detail yang isinya berganti-ganti, beri `key={nama}` supaya React memasang
 * ulang ikonnya dan bentuknya benar-benar dirakit lagi — tanpa itu, ikon
 * berganti diam-diam.
 */
export type GenerativeIconProps = {
  /** Nama entitas. Nama yang sama selalu menghasilkan ikon yang sama. */
  nama: string;
  /** 40 di kartu, 96 di panel detail (docs/DESIGN.md). */
  ukuran?: number;
  /** Versi rencana: item yang belum tersedia, digambar putus-putus. */
  rencana?: boolean;
  /**
   * Nomor urut item di daftarnya, untuk menunda animasi 40ms per item
   * (maksimal 16 item). Kosongkan kalau ikonnya berdiri sendiri.
   */
  urutan?: number;
  className?: string;
};

/** Satu bentuk, sudah diputar pada pusat selnya dan diberi tunda animasinya. */
function Bentuk({
  sel,
  keBerapa,
  urutan,
  warna,
}: {
  sel: SelIkon;
  keBerapa: number;
  urutan: number;
  warna: string;
}) {
  const gambar: GambarBentuk | null = gambarBentuk(sel.jenis, sel.i);
  if (!gambar) return null;

  const kelas = cn(warna, "animate-bentuk-masuk");
  // `fill-box` membuat tiap bentuk membesar dari pusatnya sendiri; tanpa itu
  // keempatnya terbang masuk dari pusat viewBox.
  const gaya = {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationDelay: tundaBentuk(urutan, keBerapa),
  } as const;

  return (
    <g transform={putaranSel(sel)}>
      {gambar.elemen === "rect" ? (
        <rect
          x={gambar.x}
          y={gambar.y}
          width={gambar.width}
          height={gambar.height}
          className={kelas}
          style={gaya}
        />
      ) : gambar.elemen === "circle" ? (
        <circle cx={gambar.cx} cy={gambar.cy} r={gambar.r} className={kelas} style={gaya} />
      ) : (
        <path d={gambar.d} className={kelas} style={gaya} />
      )}
    </g>
  );
}

/** Warna satu bentuk: aksen menang, selebihnya kontras dengan latarnya. */
function warnaBentuk(sel: SelIkon, gelap: boolean, rencana: boolean): string {
  if (rencana) return "fill-garis-putus";
  if (sel.aksen) return "fill-brand-ikon";
  return gelap ? "fill-card" : "fill-foreground";
}

export function GenerativeIcon({
  nama,
  ukuran = 40,
  rencana = false,
  urutan = 0,
  className,
}: GenerativeIconProps) {
  const { gelap, sel } = rancangIkon(nama);
  // Latar terang digariskan supaya kartu putih di atas panel putih tetap
  // terbaca tepinya; latar gelap tidak perlu, warnanya sudah memisah sendiri.
  const digariskan = rencana || !gelap;

  return (
    <svg
      viewBox="0 0 48 48"
      width={ukuran}
      height={ukuran}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect
        x={0.75}
        y={0.75}
        width={46.5}
        height={46.5}
        rx={12}
        className={
          rencana
            ? "fill-none stroke-garis-putus"
            : gelap
              ? "fill-foreground"
              : "fill-card stroke-input"
        }
        strokeWidth={digariskan ? 1.25 : undefined}
        strokeDasharray={rencana ? "3 3" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {sel.map((satu, keBerapa) => (
        <Bentuk
          key={satu.i}
          sel={satu}
          keBerapa={keBerapa}
          urutan={urutan}
          warna={warnaBentuk(satu, gelap, rencana)}
        />
      ))}
    </svg>
  );
}

export default GenerativeIcon;
