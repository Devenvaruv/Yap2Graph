import type { SourceDocument } from "../schemas";
import type {
  CogneeClient,
  CogneeSearchResult,
  CogneeSearchType,
} from "./types";

export interface CogneeSearchCall {
  query: string;
  type: CogneeSearchType;
}

/**
 * Test fake for {@link CogneeClient}. Records every add/cognify/search call
 * for assertion; search returns canned results in FIFO order (empty when the
 * queue runs dry). Zero network, zero nondeterminism.
 */
export class StubCognee implements CogneeClient {
  readonly addCalls: SourceDocument[][] = [];
  readonly searchCalls: CogneeSearchCall[] = [];
  private cognifyCount = 0;
  private queuedSearchResults: CogneeSearchResult[][] = [];

  async add(documents: readonly SourceDocument[]): Promise<void> {
    this.addCalls.push([...documents]);
  }

  async cognify(): Promise<void> {
    this.cognifyCount += 1;
  }

  get cognifyCallCount(): number {
    return this.cognifyCount;
  }

  /** Queue the result for the next search call (FIFO). */
  enqueueSearchResults(results: CogneeSearchResult[]): this {
    this.queuedSearchResults.push(results);
    return this;
  }

  async search(
    query: string,
    type: CogneeSearchType,
  ): Promise<CogneeSearchResult[]> {
    this.searchCalls.push({ query, type });
    return this.queuedSearchResults.shift() ?? [];
  }
}
