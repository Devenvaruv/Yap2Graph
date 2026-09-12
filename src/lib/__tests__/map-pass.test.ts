import { describe, expect, it } from "vitest";
import { fixtureDocuments } from "../fixtures";
import { FakeLlm } from "../llm";
import {
  extractCandidateEvents,
  extractCandidateEventsFromDocument,
} from "../map-pass";
import type { CandidateEvent, SourceDocument } from "../schemas";

function documentById(id: string): SourceDocument {
  const document = fixtureDocuments.find((entry) => entry.id === id);
  if (!document) throw new Error(`Missing fixture document: ${id}`);
  return document;
}

function candidateFor(
  document: SourceDocument,
  overrides: Partial<CandidateEvent> = {},
): CandidateEvent {
  return {
    id: `candidate-${document.id}`,
    documentId: document.id,
    title: document.title,
    description: `Candidate event from ${document.title}.`,
    activityType: "implementation",
    startTime: document.timestamp,
    lastActiveTime: document.timestamp,
    technologies: [],
    blockers: [],
    nextSteps: [],
    confidence: 0.8,
    ...overrides,
  };
}

describe("map pass", () => {
  it("returns validated candidates linked to their fixture documents", async () => {
    const discussion = documentById("chatgpt-webhook-retry");
    const implementation = documentById("codex-webhook-idempotency");
    const discussionCandidate = candidateFor(discussion, {
      activityType: "design",
      project: "billing-api",
      status: "in_progress",
    });
    const implementationCandidate = candidateFor(implementation, {
      project: "billing-api",
      status: "completed",
      technologies: ["Stripe", "Postgres"],
      outcome: "Webhook retries are deduplicated at the transaction boundary.",
    });
    const llm = new FakeLlm()
      .enqueue({ candidates: [discussionCandidate] })
      .enqueue({ candidates: [implementationCandidate] });

    const candidates = await extractCandidateEvents(
      [discussion, implementation],
      llm,
    );

    expect(candidates).toEqual([discussionCandidate, implementationCandidate]);
    expect(candidates.map((candidate) => candidate.documentId)).toEqual([
      discussion.id,
      implementation.id,
    ]);
  });

  it("returns no candidates for a noise document", async () => {
    const noiseDocument = documentById("email-timesheet-reminder");
    const llm = new FakeLlm().enqueue({ candidates: [] });

    await expect(
      extractCandidateEventsFromDocument(noiseDocument, llm),
    ).resolves.toEqual([]);
  });

  it("keeps multiple distinct candidates from one document", async () => {
    const document = documentById("codex-webhook-idempotency");
    const implementation = candidateFor(document, {
      title: "Implemented idempotent Stripe webhook handling",
      project: "billing-api",
      technologies: ["Stripe", "Postgres"],
    });
    const tests = candidateFor(document, {
      id: "candidate-codex-webhook-idempotency-tests",
      title: "Added webhook replay integration tests",
      project: "billing-api",
      activityType: "testing",
      technologies: ["Stripe", "Postgres"],
    });
    const llm = new FakeLlm().enqueue({
      candidates: [implementation, tests],
    });

    await expect(
      extractCandidateEventsFromDocument(document, llm),
    ).resolves.toEqual([implementation, tests]);
  });

  it("rejects a candidate linked to another source document", async () => {
    const document = documentById("chatgpt-webhook-retry");
    const otherDocument = documentById("email-webhook-shipped");
    const llm = new FakeLlm().enqueue({
      candidates: [candidateFor(document, { documentId: otherDocument.id })],
    });

    await expect(
      extractCandidateEventsFromDocument(document, llm),
    ).rejects.toThrow(/evidence boundary violation/);
  });

  it("surfaces invalid LLM output instead of partially parsing it", async () => {
    const document = documentById("chatgpt-feed-cache");
    const llm = new FakeLlm().enqueue({
      candidates: [
        {
          id: "candidate-invalid",
          documentId: document.id,
          title: "Missing required candidate fields",
        },
      ],
    });

    await expect(
      extractCandidateEventsFromDocument(document, llm),
    ).rejects.toThrow(/schema validation/);
  });
});
