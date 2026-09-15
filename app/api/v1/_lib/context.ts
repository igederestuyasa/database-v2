/**
 * The shared spine of every `/api/v1` route handler.
 *
 * A folder whose name starts with `_` is private to Next's router, so nothing
 * here is reachable as a URL: these are the plain functions the five
 * `route.ts` files delegate to. Keeping the logic out of `route.ts` is what
 * makes it testable — a route file may only export HTTP method handlers and
 * route config, while these functions can be imported and called with an
 * injected client (`tests/apiV1Routes.test.ts`), which is the only way to
 * prove 401/403/405 behaviour in an environment that cannot reach Supabase.
 *
 * Order of operations in `withApiContext` is deliberate:
 *
 *   1. **The bearer token is checked first, before a client exists.** A
 *      request with no key must answer `401` even where the Supabase
 *      environment variables are unset — otherwise `createAdminClient()`
 *      throws and an unauthenticated caller gets a 500 telling them the server
 *      is misconfigured.
 *   2. Then the key is looked up, and only an aktif key gets any further.
 *   3. `last_used_at` is recorded for the key, never failing the request.
 *   4. The endpoint runs, and anything it throws becomes the one error
 *      envelope via the frozen `jsonError()` — including a PostgREST failure,
 *      which is logged server-side and answered with a generic 500.
 */
import {
  authenticateApiKey,
  requireBearerToken,
  touchApiKeyUsage,
  type AuthenticatedKey,
} from "@/lib/api/auth";
import { apiError } from "@/lib/api/errors";
import { jsonError } from "@/lib/api/response";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

/**
 * Test seam. Production routes pass nothing and get the real service-role
 * client; a test passes a fake and never touches the network.
 */
export type RouteDeps = {
  createClient?: () => AdminClient;
};

export type ApiContext = {
  request: Request;
  searchParams: URLSearchParams;
  /**
   * SERVICE ROLE — bypasses RLS (ADR-004). It may read only `v_employees_api`,
   * `org_units`, `jabatan` and `lookups`; `v_employees_private` is not even
   * granted to `service_role`, so naming it fails loudly instead of quietly
   * shipping Data Pribadi Sensitif to a Konsumen.
   */
  client: AdminClient;
  key: AuthenticatedKey;
};

export async function withApiContext(
  request: Request,
  deps: RouteDeps | undefined,
  run: (context: ApiContext) => Promise<Response>,
): Promise<Response> {
  try {
    const token = requireBearerToken(request);
    const client = (deps?.createClient ?? createAdminClient)();
    const key = await authenticateApiKey(client, token);
    await touchApiKeyUsage(client, key);

    const searchParams = new URL(request.url).searchParams;
    return await run({ request, searchParams, client, key });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Every method except GET (API-CONTRACT.md: "Hanya GET di v1. Method lain →
 * 405"), in the same envelope as every other error and with the `Allow` header
 * the status code requires.
 *
 * Each `route.ts` exports this for POST/PUT/PATCH/DELETE/OPTIONS. Without
 * those exports Next answers with its own bodiless 405, which is not the
 * contract. HEAD is left to Next, which derives it from GET.
 */
export function methodNotAllowed(): Response {
  return jsonError(apiError.methodNotAllowed(["GET"]));
}
