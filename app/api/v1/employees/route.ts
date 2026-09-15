/**
 * `GET /api/v1/employees` — daftar Karyawan untuk Konsumen (PRD #17).
 *
 * The handler lives in `../_lib/employees.ts`: a `route.ts` may export only
 * HTTP method handlers and route config, so keeping the logic next door is
 * what lets `tests/apiV1Routes.test.ts` call it with a fake client.
 */
import { handleEmployeesList } from "../_lib/employees";
import { methodNotAllowed } from "../_lib/context";

/** ADR-005 §6: never prerendered, never cached — this reads live data per key. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleEmployeesList(request);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
