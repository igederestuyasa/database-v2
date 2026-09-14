import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HC Core serves only live data: every page under app/(app) and every route
  // under app/api/v1 is rendered per-request (see ADR-005). Nothing here is
  // safe to prerender at build time, because the build machine has no database.
  reactStrictMode: true,
  typedRoutes: false,
};

export default nextConfig;
