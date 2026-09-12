import type { SourceDocument } from "../schemas";
import type {
  CogneeClient,
  CogneeSearchResult,
  CogneeSearchType,
} from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "up", "about", "into", "over", "after", "is", "are",
  "was", "were", "be", "been", "being", "it", "its", "this", "that", "these",
  "those", "as", "if", "then", "than", "so", "no", "not", "only", "own",
  "same", "such", "can", "will", "just", "should", "now", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "any", "both", "each",
  "few", "more", "most", "other", "some", "our", "your", "their", "we",
]);

const MIN_TOKEN_LENGTH = 3;
const SUMMARY_EXCERPT_MAX_CHARS = 400;
const MAX_SUMMARY_RESULTS = 2;
const MAX_CHUNK_RESULTS = 3;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(raw)) {
      tokens.add(raw);
    }
  }
  return tokens;
}

function overlapSize(queryTokens: ReadonlySet<string>, textTokens: ReadonlySet<string>): number {
  let count = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) count += 1;
  }
  return count;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

function splitIntoChunks(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length > 0);
}

/**
 * Query-time Cognee stand-in for fixture-only development (T13): searches the
 * normalized corpus directly with token-overlap ranking, so the vertical slice
 * runs end-to-end without the Cognee service. It imitates the two real search
 * types — "summaries" returns document-level digests, "chunks" returns the
 * best-matching passages — and only ever returns documents that exist in the
 * corpus, so every result maps back to a citable SourceDocument id.
 *
 * Ingestion is not supported: add/cognify throw, keeping the query path honest
 * about doing zero ingestion work.
 */
export class LocalCorpusSearch implements CogneeClient {
  private readonly documents: readonly SourceDocument[];

  constructor(documents: readonly SourceDocument[]) {
    this.documents = documents;
  }

  async add(): Promise<void> {
    throw new Error(
      "LocalCorpusSearch is query-time only — run ingestion through the real Cognee client.",
    );
  }

  async cognify(): Promise<void> {
    throw new Error(
      "LocalCorpusSearch is query-time only — run ingestion through the real Cognee client.",
    );
  }

  async search(
    query: string,
    type: CogneeSearchType,
  ): Promise<CogneeSearchResult[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    return type === "summaries"
      ? this.searchSummaries(queryTokens)
      : this.searchChunks(queryTokens);
  }

  private searchSummaries(queryTokens: ReadonlySet<string>): CogneeSearchResult[] {
    const scored = this.documents
      .map((document, index) => ({
        document,
        index,
        score: overlapSize(queryTokens, tokenize(`${document.title} ${document.content}`)),
      }))
      .filter((entry) => entry.score > 0);

    scored.sort((a, b) => b.score - a.score || a.index - b.index);

    return scored.slice(0, MAX_SUMMARY_RESULTS).map(({ document }) => ({
      documentId: document.id,
      excerpt: truncate(
        `${document.title}: ${document.content}`,
        SUMMARY_EXCERPT_MAX_CHARS,
      ),
    }));
  }

  private searchChunks(queryTokens: ReadonlySet<string>): CogneeSearchResult[] {
    const scored: Array<{ documentId: string; chunk: string; score: number; order: number }> =
      [];

    for (const document of this.documents) {
      for (const chunk of splitIntoChunks(document.content)) {
        const score = overlapSize(queryTokens, tokenize(chunk));
        if (score > 0) {
          scored.push({
            documentId: document.id,
            chunk,
            score,
            order: scored.length,
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score || a.order - b.order);

    return scored.slice(0, MAX_CHUNK_RESULTS).map(({ documentId, chunk }) => ({
      documentId,
      excerpt: truncate(chunk, SUMMARY_EXCERPT_MAX_CHARS),
    }));
  }
}
