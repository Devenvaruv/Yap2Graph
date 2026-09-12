import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ChatGptAdapter } from "../chatgpt-adapter";
import { SourceDocument } from "../../schemas";

const fixturePath = resolve(
  __dirname,
  "../fixtures/raw-chatgpt.json",
);
const rawFixture = readFileSync(fixturePath, "utf-8");

describe("ChatGptAdapter", () => {
  const adapter = new ChatGptAdapter();

  it("exposes the chatgpt source type", () => {
    expect(adapter.sourceType).toBe("chatgpt");
  });

  it("produces validated SourceDocuments from the sample fixture", () => {
    const docs = adapter.adapt(rawFixture);

    expect(docs.length).toBe(1);
    const doc = docs[0];

    expect(() => SourceDocument.parse(doc)).not.toThrow();
    expect(doc.sourceType).toBe("chatgpt");
    expect(doc.id).toBe("chatgpt-webhook-retry");
    expect(doc.title).toBe("Duplicate charges from Stripe webhook retries");
  });

  it("maps participants from message authors", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.participants).toContain("user");
    expect(doc.participants).toContain("assistant");
  });

  it("produces an ISO-8601 timestamp with offset", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("builds content from all messages", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.content).toContain("User:");
    expect(doc.content).toContain("Assistant:");
    expect(doc.content).toContain("billing-api");
    expect(doc.content).toContain("processed_events");
  });

  it("preserves conversation metadata", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.metadata.conversationId).toBe("chatgpt-webhook-retry");
    expect(doc.metadata.messageCount).toBe(5);
  });

  it("throws on malformed JSON", () => {
    expect(() => adapter.adapt("not json")).toThrow("ChatGptAdapter");
  });

  it("throws on structurally invalid export (missing conversations)", () => {
    const bad = JSON.stringify({ wrong: [] });
    expect(() => adapter.adapt(bad)).toThrow("ChatGptAdapter");
  });

  it("throws when a conversation has no messages", () => {
    const bad = JSON.stringify({
      conversations: [
        { id: "x", title: "t", create_time: 0, messages: [] },
      ],
    });
    expect(() => adapter.adapt(bad)).toThrow("ChatGptAdapter");
  });
});
