import type { SourceDocument } from "../schemas";
import type {
  CogneeClient,
  CogneeSearchResult,
  CogneeSearchType,
} from "./types";

export interface RealCogneeClientOptions {
  /** Base URL of the Cognee REST service (no trailing slash). */
  apiUrl: string;
  /** Dataset name used across add/cognify/search. Default "main_dataset". */
  datasetName?: string;
  /** Maximum poll attempts for cognify completion. Default 120. */
  maxCognifyPollAttempts?: number;
  /** Delay between cognify poll attempts in ms. Default 5000. */
  cognifyPollIntervalMs?: number;
  /** Override fetch (for testing). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

type CogneeSearchApiType = "SUMMARIES" | "CHUNKS";

interface PipelineRunInfo {
  status: string;
  pipeline_run_id?: string;
  dataset_id?: string;
  dataset_name?: string;
}

const SEARCH_TYPE_MAP: Record<CogneeSearchType, CogneeSearchApiType> = {
  summaries: "SUMMARIES",
  chunks: "CHUNKS",
};

const COGNIFY_TERMINAL_STATUSES = new Set([
  "completed",
  "done",
  "success",
  "DATASET_STATUS_READY",
]);
const COGNIFY_FAILED_STATUSES = new Set([
  "failed",
  "error",
  "DATASET_STATUS_FAILED",
]);

export class RealCogneeClient implements CogneeClient {
  private readonly apiUrl: string;
  private readonly datasetName: string;
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RealCogneeClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.datasetName = options.datasetName ?? "main_dataset";
    this.maxPollAttempts = options.maxCognifyPollAttempts ?? 120;
    this.pollIntervalMs = options.cognifyPollIntervalMs ?? 5000;
    const fetchFn = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchFn) {
      throw new Error(
        "RealCogneeClient: no fetch implementation available — pass options.fetch or run in an environment with global fetch.",
      );
    }
    this.fetchImpl = fetchFn;
  }

  async add(documents: readonly SourceDocument[]): Promise<void> {
    if (documents.length === 0) return;

    const form = new FormData();
    const metadataArray: Array<Record<string, unknown>> = [];

    for (const doc of documents) {
      const payload = JSON.stringify({
        id: doc.id,
        sourceType: doc.sourceType,
        title: doc.title,
        timestamp: doc.timestamp,
        participants: doc.participants,
        content: doc.content,
        metadata: doc.metadata,
      });
      form.append("data", new Blob([payload], { type: "application/json" }), `${doc.id}.json`);
      metadataArray.push({ document_id: doc.id, source_type: doc.sourceType });
    }

    form.append("datasetName", this.datasetName);
    form.append("external_metadata", JSON.stringify(metadataArray));

    const response = await this.fetchImpl(`${this.apiUrl}/api/v1/add`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(
        `Cognee add failed (${response.status}): ${text}`,
      );
    }
  }

  async cognify(): Promise<void> {
    const response = await this.fetchImpl(`${this.apiUrl}/api/v1/cognify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasets: [this.datasetName] }),
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`Cognee cognify failed (${response.status}): ${text}`);
    }

    const info = (await response.json()) as PipelineRunInfo;
    const runId = info.pipeline_run_id;
    if (!runId) return;

    await this.pollCognifyStatus(runId);
  }

  async search(
    query: string,
    type: CogneeSearchType,
  ): Promise<CogneeSearchResult[]> {
    const apiType = SEARCH_TYPE_MAP[type];

    const response = await this.fetchImpl(`${this.apiUrl}/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        search_type: apiType,
        datasets: [this.datasetName],
      }),
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(`Cognee search failed (${response.status}): ${text}`);
    }

    const raw = await response.json();
    return normalizeSearchResponse(raw);
  }

  /** Pings the Cognee service root — throws on unreachable/unhealthy. */
  async healthCheck(): Promise<void> {
    const response = await this.fetchImpl(`${this.apiUrl}/api/v1/health`, {
      method: "GET",
    });
    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(
        `Cognee health check failed (${response.status}): ${text}`,
      );
    }
  }

  private async pollCognifyStatus(runId: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      await delay(this.pollIntervalMs);

      const response = await this.fetchImpl(
        `${this.apiUrl}/api/v1/cognify/status/${runId}`,
        { method: "GET" },
      );

      if (!response.ok) {
        if (response.status >= 500 && attempt < this.maxPollAttempts - 1) continue;
        const text = await safeReadText(response);
        throw new Error(
          `Cognee cognify status check failed (${response.status}): ${text}`,
        );
      }

      const info = (await response.json()) as PipelineRunInfo;
      const status = (info.status ?? "").toLowerCase();

      if (COGNIFY_TERMINAL_STATUSES.has(status) || COGNIFY_TERMINAL_STATUSES.has(info.status ?? "")) {
        return;
      }
      if (COGNIFY_FAILED_STATUSES.has(status) || COGNIFY_FAILED_STATUSES.has(info.status ?? "")) {
        throw new Error(`Cognee cognify failed with status: ${info.status}`);
      }
    }

    throw new Error(
      `Cognee cognify did not complete after ${this.maxPollAttempts} poll attempts.`,
    );
  }
}

function normalizeSearchResponse(raw: unknown): CogneeSearchResult[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): CogneeSearchResult | null => {
      const result = entry as {
        search_result?: unknown;
        dataset_id?: string;
        dataset_name?: string;
      };
      const searchResult = result.search_result;
      if (searchResult == null) return null;

      const excerpt = extractExcerpt(searchResult);
      const documentId = extractDocumentId(searchResult);
      if (excerpt === null) return null;

      return { excerpt, documentId };
    })
    .filter((entry): entry is CogneeSearchResult => entry !== null);
}

function extractExcerpt(searchResult: unknown): string | null {
  if (typeof searchResult === "string") return searchResult;
  if (typeof searchResult === "object" && searchResult !== null) {
    const obj = searchResult as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.description === "string") return obj.description;
    if (typeof obj.summary === "string") return obj.summary;
    return JSON.stringify(searchResult);
  }
  return null;
}

function extractDocumentId(searchResult: unknown): string | null {
  if (typeof searchResult !== "object" || searchResult === null) return null;
  const obj = searchResult as Record<string, unknown>;

  if (typeof obj.document_id === "string") return obj.document_id;
  if (typeof obj.id === "string") return obj.id;

  const metadata = obj.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata === "object") {
    if (typeof metadata.document_id === "string") return metadata.document_id;
  }

  const externalMetadata = obj.external_metadata as Record<string, unknown> | undefined;
  if (externalMetadata && typeof externalMetadata === "object") {
    if (typeof externalMetadata.document_id === "string") {
      return externalMetadata.document_id;
    }
  }

  return null;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "(unable to read response body)";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
