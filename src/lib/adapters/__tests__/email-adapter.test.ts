import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EmailAdapter } from "../email-adapter";
import { SourceDocument } from "../../schemas";

const fixturePath = resolve(
  __dirname,
  "../fixtures/raw-email.json",
);
const rawFixture = readFileSync(fixturePath, "utf-8");

describe("EmailAdapter", () => {
  const adapter = new EmailAdapter();

  it("exposes the email source type", () => {
    expect(adapter.sourceType).toBe("email");
  });

  it("produces validated SourceDocuments from the sample fixture", () => {
    const docs = adapter.adapt(rawFixture);

    expect(docs.length).toBe(2);
    for (const doc of docs) {
      expect(() => SourceDocument.parse(doc)).not.toThrow();
      expect(doc.sourceType).toBe("email");
    }
  });

  it("maps from/to to participants", () => {
    const docs = adapter.adapt(rawFixture);
    const webhookDoc = docs.find(
      (d) => d.id === "email-msg-1001",
    );

    expect(webhookDoc).toBeDefined();
    expect(webhookDoc!.participants).toContain("dev@example.com");
    expect(webhookDoc!.participants).toContain("payments-team@example.com");
  });

  it("uses the email date as timestamp", () => {
    const docs = adapter.adapt(rawFixture);
    const webhookDoc = docs.find(
      (d) => d.id === "email-msg-1001",
    );

    expect(webhookDoc!.timestamp).toBe("2026-09-09T09:30:00Z");
  });

  it("uses the subject as title and formats content with headers", () => {
    const docs = adapter.adapt(rawFixture);
    const webhookDoc = docs.find(
      (d) => d.id === "email-msg-1001",
    );

    expect(webhookDoc!.title).toBe("Duplicate-charge fix is live");
    expect(webhookDoc!.content).toContain("From: dev@example.com");
    expect(webhookDoc!.content).toContain("Subject: Duplicate-charge fix is live");
    expect(webhookDoc!.content).toContain("idempotent webhook handler shipped");
  });

  it("preserves email metadata (from, to, threadId)", () => {
    const docs = adapter.adapt(rawFixture);
    const webhookDoc = docs.find(
      (d) => d.id === "email-msg-1001",
    );

    expect(webhookDoc!.metadata.from).toBe("dev@example.com");
    expect(webhookDoc!.metadata.threadId).toBe("email-thread-231");
    expect(webhookDoc!.metadata.to).toEqual(["payments-team@example.com"]);
  });

  it("produces one document per message across all threads", () => {
    const docs = adapter.adapt(rawFixture);
    const ids = docs.map((d) => d.id);

    expect(ids).toContain("email-msg-1001");
    expect(ids).toContain("email-msg-2001");
  });

  it("throws on malformed JSON", () => {
    expect(() => adapter.adapt("{broken")).toThrow("EmailAdapter");
  });

  it("throws on structurally invalid export (no threads key)", () => {
    const bad = JSON.stringify({ messages: [] });
    expect(() => adapter.adapt(bad)).toThrow("EmailAdapter");
  });

  it("throws when a thread has no messages", () => {
    const bad = JSON.stringify({
      threads: [{ threadId: "t", subject: "s", messages: [] }],
    });
    expect(() => adapter.adapt(bad)).toThrow("EmailAdapter");
  });
});
