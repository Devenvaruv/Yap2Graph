import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CodingAgentAdapter } from "../coding-agent-adapter";
import { SourceDocument } from "../../schemas";

const fixturePath = resolve(
  __dirname,
  "../fixtures/raw-coding-agent.json",
);
const rawFixture = readFileSync(fixturePath, "utf-8");

describe("CodingAgentAdapter", () => {
  const adapter = new CodingAgentAdapter();

  it("exposes the coding_agent source type", () => {
    expect(adapter.sourceType).toBe("coding_agent");
  });

  it("produces validated SourceDocuments from the sample fixture", () => {
    const docs = adapter.adapt(rawFixture);

    expect(docs.length).toBe(1);
    const doc = docs[0];

    expect(() => SourceDocument.parse(doc)).not.toThrow();
    expect(doc.sourceType).toBe("coding_agent");
    expect(doc.id).toBe("codex-sess-a41f");
  });

  it("maps user and agent to participants", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.participants).toContain("user");
    expect(doc.participants).toContain("agent");
  });

  it("uses session startTime as the document timestamp", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.timestamp).toBe("2026-09-08T14:00:00Z");
  });

  it("builds a descriptive title from the session task", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.title).toContain("Codex session:");
    expect(doc.title).toContain("idempotency fix");
  });

  it("builds content from the full transcript", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.content).toContain("User:");
    expect(doc.content).toContain("Agent:");
    expect(doc.content).toContain("processed_events");
    expect(doc.content).toContain("142 passed");
  });

  it("preserves session metadata (agent, repo, files, tests)", () => {
    const docs = adapter.adapt(rawFixture);
    const doc = docs[0];

    expect(doc.metadata.agent).toBe("codex-cli");
    expect(doc.metadata.sessionId).toBe("codex-sess-a41f");
    expect(doc.metadata.repo).toBe("billing-api");
    expect(doc.metadata.filesChanged).toBe(3);
    expect(doc.metadata.testsAdded).toBe(4);
    expect(doc.metadata.endTime).toBe("2026-09-08T15:30:00Z");
  });

  it("throws on malformed JSON", () => {
    expect(() => adapter.adapt("garbage")).toThrow("CodingAgentAdapter");
  });

  it("throws on structurally invalid export (no sessions key)", () => {
    const bad = JSON.stringify({ data: [] });
    expect(() => adapter.adapt(bad)).toThrow("CodingAgentAdapter");
  });

  it("throws when a session has an empty transcript", () => {
    const bad = JSON.stringify({
      sessions: [
        {
          sessionId: "s",
          agent: "a",
          repo: "r",
          startTime: "2026-09-05T00:00:00Z",
          endTime: "2026-09-05T01:00:00Z",
          task: "t",
          transcript: [],
          filesChanged: 0,
          testsAdded: 0,
        },
      ],
    });
    expect(() => adapter.adapt(bad)).toThrow("CodingAgentAdapter");
  });
});
