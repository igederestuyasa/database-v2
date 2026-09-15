"use client";

import RouteError from "@/components/RouteError";

/**
 * The boundary above every route group.
 *
 * Each route under `app/(app)/**` has its own `error.tsx`, but Next does not
 * route an error thrown by a **layout** to the boundary of its own segment —
 * it goes to the parent's. Until this file existed there was no parent, so a
 * throw in `app/(app)/layout.tsx` (say, the `profiles` read for the sidebar
 * failing) replaced eight styled Indonesian error pages with Next's built-in
 * one. Now it lands here, inside the root layout, with the same retry button.
 */
export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} judul="HC Core" />;
}
