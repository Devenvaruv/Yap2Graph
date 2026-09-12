import { QueryPathError } from "@/lib/query-path";
import { buildDefaultDeps } from "./clients";
import { handleGenerateRequest, toErrorResponse } from "./handler";

export async function POST(request: Request): Promise<Response> {
  let deps;
  try {
    deps = await buildDefaultDeps();
  } catch (err) {
    if (err instanceof QueryPathError) return toErrorResponse(err);
    throw err;
  }
  return handleGenerateRequest(request, deps);
}
