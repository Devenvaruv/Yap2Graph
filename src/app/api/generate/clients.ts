import { LocalCorpusSearch, RealCogneeClient, type CogneeClient } from "@/lib/cognee";
import { fixtureIngestionDocuments } from "@/lib/fixtures/raw-exports";
import { OllamaEmbeddingClient, OllamaLlmClient } from "@/lib/llm";
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
  const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8010";
  const real = new RealCogneeClient({ apiUrl });
  try {
    await withTimeout(real.healthCheck(), COGNEE_HEALTH_TIMEOUT_MS);
    return real;
  } catch {
    return new LocalCorpusSearch(fixtureIngestionDocuments);
  }
}

/**
 * Build the route's real dependencies from the environment. The LLM and
 * embedding clients use local Ollama. Cognee is the real client when the
 * service is up and the local corpus search otherwise.
 *
 * The corpus used for evidence resolution is the fixture corpus, the document
 * set `npm run ingest` pushes to Cognee. Live-connector corpora are not
 * persisted yet, so the query path resolves evidence ids against the fixture
 * documents.
 */
export async function buildDefaultDeps(): Promise<QueryPathDeps> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const chatModel = process.env.OLLAMA_CHAT_MODEL ?? "qwen3:4b-instruct";
  const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text:latest";

  if (!baseUrl.trim()) {
    throw new QueryPathError(
      "missing-credentials",
      "OLLAMA_BASE_URL is empty - set it to your local Ollama URL and restart the dev server.",
      503,
    );
  }

  return {
    llm: new OllamaLlmClient({
      baseUrl,
      smallModel: chatModel,
      largeModel: chatModel,
    }),
    embeddings: new OllamaEmbeddingClient({ baseUrl, embeddingModel }),
    cognee: await connectCognee(),
    corpus: fixtureIngestionDocuments,
  };
}
