import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HC Core serves only live data: every page under app/(app) and every route
  // under app/api/v1 is rendered per-request (see ADR-005). Nothing here is
  // safe to prerender at build time, because the build machine has no database.
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    serverActions: {
      // Seed awal lewat web (PRD #23, ADR-008): the browser sends the whole
      // planned dataset to `jalankanSeed()` as JSON. Measured on the dummy
      // workbook: ~1,0 MB for 1.500 Karyawan in the index form, over the 1 MB
      // default. 4 MB stays under Vercel's 4,5 MB request-body cap;
      // `lib/seed/payload.test.ts` keeps the 1.500-row payload under 2 MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
