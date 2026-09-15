/**
 * `GET /api/v1/employees/{personnel_number}` — satu Karyawan (PRD #17).
 *
 * The path segment is the **Personnel Number**, the business key Konsumen hold
 * (CONTEXT.md) — not the internal uuid and not `nip`.
 */
import { handleEmployeeDetail } from "../../_lib/employees";
import { methodNotAllowed } from "../../_lib/context";

/** ADR-005 §6. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ personnel_number: string }> },
): Promise<Response> {
  const { personnel_number: personnelNumber } = await context.params;
  return handleEmployeeDetail(request, personnelNumber);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
