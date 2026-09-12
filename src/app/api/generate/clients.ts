import { LocalCorpusSearch, RealCogneeClient, type CogneeClient } from "@/lib/cognee";
import { fixtureIngestionDocuments } from "@/lib/fixtures/raw-exports";
import { OpenAiEmbeddingClient, OpenAiLlmClient } from "@/lib/llm";
import { QueryPathError, type QueryPathDeps } from "@/lib/query-path";

const COGNEE_HEALTH_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]);
}

async function connectCognee(): Promise<CogneeClient> {
  const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8000";
  const real = new RealCogneeClient({ apiUrl });
  try {
    await withTimeout(real.healthCheck(), COGNEE_HEALTH_TIMEOUT_MS);
    return real;
  } catch {
    // Cognee is not reachable — fixture-only dev falls back to searching the
    // normalized fixture corpus directly, so the vertical slice still runs.
    return new LocalCorpusSearch(fixtureIngestionDocuments);
  }
}

/**
 * Build the route's real dependencies from the environment. The LLM and
 * embedding clients are always OpenAI (a missing key is an actionable error,
 * never a silent fake); Cognee is the real client when the service is up and
 * the local corpus search otherwise.
 *
 * The corpus used for evidence resolution is the fixture corpus — the
 * document set `npm run ingest` pushes to Cognee. Live-connector corpora are
 * not persisted yet, so the query path resolves evidence ids against the
 * fixture documents (a known limitation for live data until the store keeps
 * documents).
 */
export async function buildDefaultDeps(): Promise<QueryPathDeps> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new QueryPathError(
      "missing-credentials",
      "OPENAI_API_KEY is not set — copy .env.example to .env, add your key, and restart the dev server.",
      503,
    );
  }

  return {
    llm: new OpenAiLlmClient({ apiKey }),
    embeddings: new OpenAiEmbeddingClient({ apiKey }),
    cognee: await connectCognee(),
    corpus: fixtureIngestionDocuments,
  };
}
