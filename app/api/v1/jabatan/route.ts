/**
 * `GET /api/v1/jabatan` — daftar Jabatan (PRD #18).
 */
import { handleJabatan } from "../_lib/reference";
import { methodNotAllowed } from "../_lib/context";

/** ADR-005 §6. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleJabatan(request);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
