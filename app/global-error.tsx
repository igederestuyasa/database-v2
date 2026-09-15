"use client";

/**
 * The boundary of last resort: an error thrown by `app/layout.tsx` itself.
 *
 * It replaces the root layout, so it must render `<html>` and `<body>` on its
 * own — and `globals.css` is not loaded here, hence the inline styling. It
 * says the same thing `RouteError` says, in the same Indonesian, so the one
 * page nobody should ever see still reads like the rest of HC Core.
 */
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
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          textAlign: "center",
          color: "#0f172a",
          background: "#fff",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
            HC Core gagal dimuat
          </h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
            Terjadi kesalahan sebelum halaman sempat digambar. Coba lagi; kalau
            tetap gagal, laporkan kode di bawah ini ke admin HC Core.
          </p>
          {error.digest ? (
            <pre
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                borderRadius: "0.375rem",
                background: "#f1f5f9",
                fontSize: "0.75rem",
                color: "#64748b",
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
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontSize: "0.875rem",
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
