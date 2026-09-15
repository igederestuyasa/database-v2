/**
 * Server-side logging, in one shape.
 *
 * Every `console.error` on the server used to pick its own prefix and its own
 * argument order, so a Vercel log could not be filtered by where a failure
 * happened. Now there is one function, and one field — `where` — that names
 * the module: `"action"`, `"api/v1"`, `"login"`, `"karyawan/detail"`.
 *
 * In production one JSON line per event, which Vercel log drains parse; in
 * development the readable multi-argument form, so a stack trace in the
 * `next dev` terminal still looks like a stack trace.
 *
 * What is never logged: a whole row, a whole user object, an email, a key.
 * `context` is for ids and codes. `error` is described by name, message, code
 * (a `DbError` carries its SQLSTATE) and stack — the fields a developer needs
 * to find the cause, none of which is personal data.
 *
 * Client Components keep their own `console.error`: those lines land in the
 * browser, not in the server log.
 */

export type LogContext = Record<string, string | number | boolean | null | undefined>;

type DescribedError = {
  name: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
};

function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; details?: unknown; hint?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof withCode.code === "string" ? { code: withCode.code } : {}),
      ...(typeof withCode.details === "string" ? { details: withCode.details } : {}),
      ...(typeof withCode.hint === "string" ? { hint: withCode.hint } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: typeof error, message: String(error) };
}

export function logError(where: string, error: unknown, context?: LogContext): void {
  if (process.env.NODE_ENV === "production") {
    console.error(
      JSON.stringify({
        level: "error",
        where,
        ...context,
        error: describeError(error),
      }),
    );
    return;
  }
  console.error(`[${where}]`, ...(context ? [context] : []), error);
}

export function logWarn(where: string, message: string, context?: LogContext): void {
  if (process.env.NODE_ENV === "production") {
    console.warn(JSON.stringify({ level: "warn", where, message, ...context }));
    return;
  }
  console.warn(`[${where}] ${message}`, ...(context ? [context] : []));
}
