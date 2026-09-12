import {
  QueryPathError,
  parseGenerateRequest,
  runQueryPath,
  type QueryPathDeps,
} from "@/lib/query-path";

export function toErrorResponse(err: QueryPathError): Response {
  return Response.json({ code: err.code, error: err.message }, { status: err.status });
}

/**
 * The /api/generate route's logic, separated from route.ts so integration
 * tests exercise the exact HTTP contract (body parsing, status codes, JSON
 * envelope) with fakes injected instead of env-configured real clients.
 */
export async function handleGenerateRequest(
  request: Request,
  deps: QueryPathDeps,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toErrorResponse(
      new QueryPathError("invalid-request", "Request body must be valid JSON.", 400),
    );
  }

  try {
    const parsed = parseGenerateRequest(body);
    const response = await runQueryPath(parsed, deps);
    return Response.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof QueryPathError) return toErrorResponse(err);
    console.error("POST /api/generate failed:", err);
    return Response.json(
      { code: "internal-error", error: "Unexpected server error — see server logs." },
      { status: 500 },
    );
  }
}
