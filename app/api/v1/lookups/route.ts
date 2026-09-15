/**
 * `GET /api/v1/lookups?tipe=job_grade` — daftar pilihan (PRD #18).
 *
 * `tipe` is mandatory and must be one of the 11 Lookup types; anything else is
 * `400 UNKNOWN_LOOKUP_TYPE` with the 11 allowed values in `details`.
 */
import { handleLookups } from "../_lib/reference";
import { methodNotAllowed } from "../_lib/context";

/** ADR-005 §6. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleLookups(request);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
