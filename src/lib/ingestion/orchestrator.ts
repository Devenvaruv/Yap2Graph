import { stat } from "node:fs/promises";
import {
  ChatGptAdapter,
  CodingAgentAdapter,
  EmailAdapter,
  type SourceAdapter,
} from "../adapters";
import {
  DEFAULT_ACTIVITY_STORE_PATH,
  loadActivities,
  saveActivities,
} from "../activity-store";
import type { CogneeClient } from "../cognee";
import type { LlmClient } from "../llm";
import { extractCandidateEvents } from "../map-pass";
import { mergeCandidateEvents } from "../merge-pass";
import type {
  Activity,
  CandidateEvent,
  SourceDocument,
  SourceType,
} from "../schemas";
import {
  DEFAULT_INGESTION_CACHE_PATH,
  hashDocument,
  hashDocuments,
  loadIngestionCache,
  saveIngestionCache,
} from "./cache";

/**
 * One raw source-export file to ingest. `name` is the cache key: it must be
 * stable and unique across the supplied list (usually the file name).
 */
export interface RawExport {
  name: string;
  sourceType: SourceType;
  raw: string;
}

export interface IngestionDeps {
  llm: LlmClient;
  cognee: CogneeClient;
  adapters?: Partial<Record<SourceType, SourceAdapter>>;
  storePath?: string;
  cachePath?: string;
}

export interface IngestionResult {
  /** True when the run hit the cache and performed zero LLM/Cognee work. */
  skipped: boolean;
  /** All normalized documents across all inputs, in input order. */
  documents: SourceDocument[];
  /** Documents whose input was (re-)extracted this run. */
  extractedDocuments: SourceDocument[];
  candidates: CandidateEvent[];
  activities: Activity[];
  /** Documents pushed to Cognee `add` this run (already-added docs excluded). */
  addedToCognee: SourceDocument[];
  cognified: boolean;
}

export function defaultAdapters(): Record<SourceType, SourceAdapter> {
  return {
    chatgpt: new ChatGptAdapter(),
    email: new EmailAdapter(),
    coding_agent: new CodingAgentAdapter(),
  };
}

interface AdaptedInput {
  input: RawExport;
  documents: SourceDocument[];
  inputHash: string;
}

function adaptInputs(
  rawExports: readonly RawExport[],
  adapters: Partial<Record<SourceType, SourceAdapter>>,
): AdaptedInput[] {
  const seenNames = new Set<string>();
  return rawExports.map((input) => {
    if (seenNames.has(input.name)) {
      throw new Error(
        `Duplicate raw export name \"${input.name}\" — input names must be unique.`,
      );
    }
    seenNames.add(input.name);
    const adapter = adapters[input.sourceType];
    if (!adapter) {
      throw new Error(
        `No adapter registered for source type \"${input.sourceType}\" (input \"${input.name}\").`,
      );
    }
    const documents = adapter.adapt(input.raw);
    return { input, documents, inputHash: hashDocuments(documents) };
  });
}

/** Adapt raw exports to normalized documents using the default adapters. */
export function adaptRawInputs(rawExports: readonly RawExport[]): SourceDocument[] {
  return adaptInputs(rawExports, defaultAdapters()).flatMap(
    (entry) => entry.documents,
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Error && (err as { code?: unknown }).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

/**
 * Run the cached ingestion pipeline (T07): raw exports → adapters → map pass
 * → merge pass → activity store, then push new documents to Cognee and build
 * the graph. Plain TS — importable from the e2e script and a future API route
 * with no Next.js coupling.
 *
 * Failure safety: the store and the cache are only written after every LLM
 * stage succeeds, so a failed run leaves the previous state fully intact and
 * a retry starts from the last consistent point. The pure cache-hit path
 * additionally requires the store to exist and no pending Cognee adds, so a
 * run that died between stages is re-completed rather than silently treated
 * as done.
 */
export async function runIngestion(
  rawExports: readonly RawExport[],
  deps: IngestionDeps,
): Promise<IngestionResult> {
  if (rawExports.length === 0) {
    throw new Error("runIngestion: no raw exports supplied — nothing to ingest.");
  }

  const storePath = deps.storePath ?? DEFAULT_ACTIVITY_STORE_PATH;
  const cachePath = deps.cachePath ?? DEFAULT_INGESTION_CACHE_PATH;
  const adapters = deps.adapters ?? defaultAdapters();

  const adapted = adaptInputs(rawExports, adapters);
  const documents = adapted.flatMap((entry) => entry.documents);

  const cache = await loadIngestionCache(cachePath);
  const fresh = adapted.filter(
    (entry) => cache.inputs[entry.input.name]?.inputHash !== entry.inputHash,
  );
  const currentNames = new Set(adapted.map((entry) => entry.input.name));
  const removedInputNames = Object.keys(cache.inputs).filter(
    (name) => !currentNames.has(name),
  );
  const docsToAdd = documents.filter(
    (document) => cache.addedDocuments[document.id] !== hashDocument(document),
  );
  const storeExists = await fileExists(storePath);

  if (
    fresh.length === 0 &&
    removedInputNames.length === 0 &&
    docsToAdd.length === 0 &&
    storeExists
  ) {
    return {
      skipped: true,
      documents,
      extractedDocuments: [],
      candidates: adapted.flatMap(
        (entry) => cache.inputs[entry.input.name].candidates,
      ),
      activities: await loadActivities(storePath),
      addedToCognee: [],
      cognified: false,
    };
  }

  for (const entry of fresh) {
    const candidates = await extractCandidateEvents(entry.documents, deps.llm);
    cache.inputs[entry.input.name] = {
      inputHash: entry.inputHash,
      documentIds: entry.documents.map((document) => document.id),
      candidates,
    };
  }
  for (const name of removedInputNames) {
    delete cache.inputs[name];
  }

  const candidates = adapted.flatMap(
    (entry) => cache.inputs[entry.input.name].candidates,
  );

  const activities = await mergeCandidateEvents(candidates, deps.llm);
  await saveActivities(activities, storePath);

  let cognified = false;
  if (docsToAdd.length > 0) {
    await deps.cognee.add(docsToAdd);
    await deps.cognee.cognify();
    cognified = true;
    for (const document of docsToAdd) {
      cache.addedDocuments[document.id] = hashDocument(document);
    }
  }

  await saveIngestionCache(cache, cachePath);

  return {
    skipped: false,
    documents,
    extractedDocuments: fresh.flatMap((entry) => entry.documents),
    candidates,
    activities,
    addedToCognee: docsToAdd,
    cognified,
  };
}
