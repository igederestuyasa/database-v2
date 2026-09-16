"use client";

/**
 * Batas error paling luar: dipakai kalau kegagalan terjadi SEBELUM
 * `app/layout.tsx` sempat merender, jadi berkas ini menggantikan root layout
 * dan harus membawa `<html>` dan `<body>`-nya sendiri.
 *
 * Akibatnya `app/globals.css` tidak ikut termuat di sini — tidak ada Tailwind,
 * tidak ada `--font-sans`, dan tidak ada `.dark` dari `next-themes`. Jadi token
 * HC Panel ditulis ulang sebagai custom property di `<style>` di bawah, dan
 * mode gelapnya mengikuti `prefers-color-scheme` karena tidak ada Provider yang
 * bisa memberi tahu pilihan pengguna. Nilainya harus sama persis dengan
 * `app/globals.css`; ini satu-satunya tempat di seluruh app yang boleh
 * mengulangnya, dan alasannya bukan gaya melainkan urutan render.
 */
const TOKEN = `
  :root {
    --latar: #F3F4F6;
    --kartu: #FDFDFD;
    --tinta: #121418;
    --redup: #5D636E;
    --garis: #E0E3E8;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --latar: #0D0F12;
      --kartu: #15181D;
      --tinta: #E9ECF0;
      --redup: #9AA1AB;
      --garis: #252A31;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; }
  }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          fontFamily:
            "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.25rem",
          textAlign: "center",
          color: "var(--tinta)",
          background: "var(--latar)",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: TOKEN }} />
        <div style={{ maxWidth: "32rem" }}>
          <h1
            style={{
              fontSize: "1.3125rem",
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
              fontWeight: 700,
              margin: 0,
            }}
          >
            HC Core gagal dimuat
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.45,
              color: "var(--redup)",
            }}
          >
            Terjadi kesalahan sebelum halaman sempat digambar. Coba lagi; kalau
            tetap gagal, laporkan kode di bawah ini ke admin HC Core.
          </p>
          {error.digest ? (
            <pre
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--garis)",
                background: "var(--kartu)",
                fontSize: "0.75rem",
                color: "var(--redup)",
                overflowX: "auto",
                textAlign: "left",
              }}
            >
              Kode: {error.digest}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              height: "2.5rem",
              padding: "0 1.25rem",
              borderRadius: "9999px",
              border: "none",
              background: "var(--tinta)",
              color: "var(--latar)",
              fontFamily: "inherit",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
