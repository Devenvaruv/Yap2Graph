import { describe, expect, it } from "vitest";
import { StubCognee, type CogneeSearchResult } from "../cognee";
import type { SourceDocument } from "../schemas";

function doc(id: string): SourceDocument {
  return {
    id,
    sourceType: "chatgpt",
    title: `Doc ${id}`,
    timestamp: "2026-09-07T10:15:00.000Z",
    participants: ["user", "assistant"],
    content: `Content of ${id}`,
    metadata: {},
  };
}

describe("StubCognee", () => {
  it("records every add call with a defensive copy", async () => {
    const stub = new StubCognee();
    const first = [doc("a"), doc("b")];
    const second = [doc("c")];

    await stub.add(first);
    await stub.add(second);
    first.push(doc("mutated-later"));

    expect(stub.addCalls).toHaveLength(2);
    expect(stub.addCalls[0]).toEqual([doc("a"), doc("b")]);
    expect(stub.addCalls[1]).toEqual([doc("c")]);
  });

  it("counts cognify calls", async () => {
    const stub = new StubCognee();
    expect(stub.cognifyCallCount).toBe(0);

    await stub.cognify();
    await stub.cognify();

    expect(stub.cognifyCallCount).toBe(2);
  });

  it("returns queued search results FIFO, empty when dry, and records search calls", async () => {
    const stub = new StubCognee();
    const first: CogneeSearchResult[] = [
      { excerpt: "summary hit", documentId: "chatgpt-webhook-retry" },
    ];
    const second: CogneeSearchResult[] = [
      { excerpt: "chunk hit", documentId: null },
    ];
    stub.enqueueSearchResults(first);
    stub.enqueueSearchResults(second);

    await expect(stub.search("webhook fix", "summaries")).resolves.toEqual(first);
    await expect(stub.search("processed_events", "chunks")).resolves.toEqual(second);
    await expect(stub.search("anything", "summaries")).resolves.toEqual([]);

    expect(stub.searchCalls).toEqual([
      { query: "webhook fix", type: "summaries" },
      { query: "processed_events", type: "chunks" },
      { query: "anything", type: "summaries" },
    ]);
  });
});
