import { describe, expect, it } from "vitest";
import { SourceDocument } from "../schemas";
import {
  fixtureDocuments,
  fixtureThreads,
  fixtureWindow,
  noiseDocumentIds,
} from "../fixtures";

const documentIds = new Set(fixtureDocuments.map((doc) => doc.id));
const threadDocumentIds = fixtureThreads.flatMap((thread) => thread.documentIds);

describe("fixture corpus", () => {
  it("has at least two cross-source threads and three noise documents", () => {
    expect(fixtureThreads.length).toBeGreaterThanOrEqual(2);
    expect(noiseDocumentIds.length).toBeGreaterThanOrEqual(3);
  });

  it("validates every fixture document against SourceDocument", () => {
    const failed = fixtureDocuments
      .map((doc) => ({ id: doc.id, result: SourceDocument.safeParse(doc) }))
      .filter((entry) => !entry.result.success);
    expect(failed.map((entry) => entry.id)).toEqual([]);
  });

  it("has unique document ids", () => {
    expect(documentIds.size).toBe(fixtureDocuments.length);
  });

  it("keeps every document inside the shared 7-day window", () => {
    const start = new Date(fixtureWindow.start).getTime();
    const end = new Date(fixtureWindow.end).getTime();
    for (const doc of fixtureDocuments) {
      const timestamp = new Date(doc.timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(start);
      expect(timestamp).toBeLessThanOrEqual(end);
    }
  });

  it("gives every thread exactly one document from each source type", () => {
    for (const thread of fixtureThreads) {
      expect(thread.documentIds).toHaveLength(3);
      const docs = thread.documentIds
        .map((id) => fixtureDocuments.find((doc) => doc.id === id))
        .filter((doc): doc is SourceDocument => doc !== undefined);
      expect(docs).toHaveLength(3);
      expect(new Set(docs.map((doc) => doc.sourceType))).toEqual(
        new Set(["chatgpt", "email", "coding_agent"]),
      );
    }
  });

  it("references only existing documents from threads", () => {
    for (const id of threadDocumentIds) {
      expect(documentIds.has(id)).toBe(true);
    }
  });

  it("partitions the corpus into threads and noise", () => {
    for (const id of noiseDocumentIds) {
      expect(documentIds.has(id)).toBe(true);
    }
    expect(new Set(threadDocumentIds).size).toBe(threadDocumentIds.length);
    expect(
      threadDocumentIds.filter((id) => noiseDocumentIds.includes(id)),
    ).toEqual([]);
    const accounted = new Set([...threadDocumentIds, ...noiseDocumentIds]);
    expect(accounted.size).toBe(fixtureDocuments.length);
  });

  it("rejects a corrupted fixture document", () => {
    const corrupted = { ...fixtureDocuments[0], sourceType: "twitter" };
    expect(SourceDocument.safeParse(corrupted).success).toBe(false);
  });
});
