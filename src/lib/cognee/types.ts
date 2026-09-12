import type { SourceDocument } from "../schemas";

export type CogneeSearchType = "summaries" | "chunks";

/**
 * One Cognee search hit. `documentId` is the normalized SourceDocument id
 * the excerpt came from, or null when the hit cannot be mapped back to a
 * known document — unmappable results are dropped by evidence retrieval
 * (T11) so no dangling ids ever reach generation.
 */
export interface CogneeSearchResult {
  excerpt: string;
  documentId: string | null;
}

/**
 * The Cognee seam: the raw corpus is uploaded (add), the knowledge graph is
 * built (cognify), and at query time search runs seeded per activity (T11).
 * T08 provides the real REST implementation; tests and the deterministic
 * e2e run use StubCognee.
 */
export interface CogneeClient {
  add(documents: readonly SourceDocument[]): Promise<void>;
  cognify(): Promise<void>;
  search(query: string, type: CogneeSearchType): Promise<CogneeSearchResult[]>;
}
