/**
 * `GET /api/v1/org-units` — daftar Unit Organisasi (PRD #18).
 *
 * One self-referencing table: `parent_id` carries the hierarchy, and a
 * Konsumen assembles the tree itself from one flat list (ADR-002).
 */
import { handleOrgUnits } from "../_lib/reference";
import { methodNotAllowed } from "../_lib/context";

/** ADR-005 §6. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleOrgUnits(request);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
