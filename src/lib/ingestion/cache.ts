import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { CandidateEvent, type SourceDocument } from "../schemas";

/**
 * Default location of the ingestion cache, persisted next to the activity
 * store. Deleting this file (and re-running) is the only invalidation
 * mechanism by design (PRD story 7: "ingestion to run once and be cached").
 */
export const DEFAULT_INGESTION_CACHE_PATH = "data/ingestion-cache.json";

const CachedInput = z
  .object({
    inputHash: z.string().min(1),
    documentIds: z.array(z.string().min(1)),
    candidates: z.array(CandidateEvent),
  })
  .strict();

const IngestionCache = z
  .object({
    version: z.literal(1),
    /** Cache key = raw export name; value = hash of its normalized documents + extracted candidates. */
    inputs: z.record(z.string(), CachedInput),
    /** SourceDocument id → content hash, for incremental Cognee add. */
    addedDocuments: z.record(z.string(), z.string()),
  })
  .strict();
export type IngestionCache = z.infer<typeof IngestionCache>;

export function hashDocuments(documents: readonly SourceDocument[]): string {
  return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
}

export function hashDocument(document: SourceDocument): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

export function emptyIngestionCache(): IngestionCache {
  return { version: 1, inputs: {}, addedDocuments: {} };
}

function isMissingFile(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "ENOENT";
}

function corruptCacheMessage(filePath: string): string {
  return `Ingestion cache at \"${filePath}\" is corrupt or incompatible with this version.\nDelete the file and re-run ingestion to rebuild it.`;
}

export async function loadIngestionCache(
  filePath: string = DEFAULT_INGESTION_CACHE_PATH,
): Promise<IngestionCache> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isMissingFile(err)) return emptyIngestionCache();
    throw err;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(corruptCacheMessage(filePath));
  }

  const parsed = IngestionCache.safeParse(value);
  if (!parsed.success) {
    throw new Error(corruptCacheMessage(filePath));
  }
  return parsed.data;
}

/** Persist the cache atomically (tmp file + rename), like the activity store. */
export async function saveIngestionCache(
  cache: IngestionCache,
  filePath: string = DEFAULT_INGESTION_CACHE_PATH,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}
