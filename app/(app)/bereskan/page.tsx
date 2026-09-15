import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/session";
import { NAV_LABELS } from "@/lib/i18n/terms";

import BereskanClient from "./BereskanClient";
import { loadBereskan } from "./data";

// Live data only — never prerendered at build time. See ADR-005 §6.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: NAV_LABELS.bereskan };

/**
 * Halaman "Perlu Dibereskan" (PRD #11, #12).
 *
 * Open to every signed-in user: PRD #11 says "**User** bisa membuka halaman"
 * — a viewer needs to see how dirty the data is even though only an admin can
 * fix it (PRD #12). `isAdmin` decides whether the fix buttons render; the
 * Server Actions behind them check the role again on the server, and RLS
 * refuses a viewer's write regardless (ARCHITECTURE.md §5).
 *
 * Nothing is stored: the Temuan are recomputed on every request from the
 * current rows, so a merge or a rename makes its Temuan disappear on the next
 * render without any state to keep in sync.
 */
export default async function Page() {
  const { client, user } = await requirePageSession("/bereskan");
  const data = await loadBereskan(client);

  return <BereskanClient {...data} isAdmin={user.role === "admin"} />;
}
