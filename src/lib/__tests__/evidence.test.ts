import { describe, expect, it } from "vitest";
import { Evidence, retrieveEvidence } from "../evidence";
import { StubCognee, type CogneeSearchResult } from "../cognee";
import { fixtureDocuments } from "../fixtures";
import type { Activity } from "../schemas";

/**
 * Fixture activities for evidence retrieval tests — the same selected-work
 * shape T10 hands to T11. The corpus is the full fixture document set, so
 * every retrievable document id resolves by construction and deliberately
 * unmappable stub results stand out.
 */
const selectedActivities: Activity[] = [
  {
    id: "activity-webhook-fix",
    title: "Fixed Stripe webhook double-charging bug",
    description:
      "Root-caused the webhook retry logic that was double-charging customers. Implemented idempotency check using processed_events table.",
    project: "Payment Gateway",
    activityType: "bug-fix",
    startTime: "2026-09-06T10:00:00Z",
    lastActiveTime: "2026-09-08T16:30:00Z",
    status: "completed",
    technologies: ["TypeScript", "Stripe API", "PostgreSQL"],
    outcome: "Zero duplicate charges in production since deployment",
    blockers: [],
    nextSteps: [],
    beforeState: "Webhook retries could process the same event twice",
    afterState: "Idempotency check prevents duplicate processing",
    evidenceIds: ["chatgpt-webhook-retry", "codex-webhook-idempotency"],
    confidence: 0.95,
  },
  {
    id: "activity-feed-cache",
    title: "Implemented Redis caching for feed endpoint",
    description:
      "Addressed N+1 query latency issue where p95 was 800ms. Implemented Redis cache layer with write-through invalidation.",
    project: "API Platform",
    activityType: "performance",
    startTime: "2026-09-07T09:00:00Z",
    lastActiveTime: "2026-09-09T14:00:00Z",
    status: "completed",
    technologies: ["Redis", "Node.js", "Express"],
    outcome: "p95 latency reduced from 800ms to 90ms in production",
    blockers: [],
    nextSteps: [],
    beforeState: "Feed endpoint p95 at 800ms due to N+1 queries",
    afterState: "Redis cache layer reduces p95 to 90ms",
    evidenceIds: ["chatgpt-feed-cache", "codex-feed-redis"],
    confidence: 0.9,
  },
  {
    id: "activity-ci-migration",
    title: "Migrating CI from CircleCI to GitHub Actions",
    description:
      "Evaluating self-hosted runner strategy for cost and security. Migrated 12 of 18 jobs; remaining 6 blocked pending runner token procurement.",
    project: "DevOps",
    activityType: "infrastructure",
    startTime: "2026-09-05T11:00:00Z",
    lastActiveTime: "2026-09-10T10:00:00Z",
    status: "blocked",
    technologies: ["GitHub Actions", "CircleCI", "Docker"],
    outcome: undefined,
    blockers: ["Waiting on infra-lead for self-hosted runner tokens"],
    nextSteps: ["Complete migration of remaining 6 jobs once tokens arrive"],
    evidenceIds: ["chatgpt-ci-migration", "codex-ci-workflows"],
    confidence: 0.7,
  },
];

const retrySummaryExcerpt =
  "The handler isn't idempotent — a processed_events table with a unique constraint on the Stripe event id makes retries no-ops.";

/**
 * Queue results for one activity's search pair (summaries call first, then
 * chunks call — the deterministic call order retrieveEvidence uses).
 */
function enqueueActivitySearch(
  stub: StubCognee,
  summaries: CogneeSearchResult[],
  chunks: CogneeSearchResult[],
): void {
  stub.enqueueSearchResults(summaries).enqueueSearchResults(chunks);
}

/**
 * The full happy-path stub corpus. Includes deliberately unmappable results
 * (null document id, unknown document id), an exact duplicate across query
 * types, and one activity whose searches return nothing.
 */
function enqueueFixtureSearches(stub: StubCognee): void {
  enqueueActivitySearch(
    stub,
    [
      {
        excerpt: retrySummaryExcerpt,
        documentId: "chatgpt-webhook-retry",
      },
      {
        excerpt: "A summary that cannot be mapped back to any document.",
        documentId: null,
      },
    ],
    [
      {
        excerpt:
          "Added migration 0042_processed_events with a unique index on stripe_event_id.",
        documentId: "codex-webhook-idempotency",
      },
      {
        excerpt: "A chunk from a document that was never ingested.",
        documentId: "ghost-doc-not-in-corpus",
      },
      {
        excerpt: retrySummaryExcerpt,
        documentId: "chatgpt-webhook-retry",
      },
    ],
  );
  enqueueActivitySearch(
    stub,
    [
      {
        excerpt:
          "A Redis cache in front of the composed feed with a short TTL and write-through invalidation on new posts and comments.",
        documentId: "chatgpt-feed-cache",
      },
    ],
    [],
  );
  enqueueActivitySearch(stub, [], []);
}

describe("evidence retrieval", () => {
  describe("happy path", () => {
    it("returns one set of validated evidence records per activity, each carrying document metadata, excerpt, and activity link", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      const records = await retrieveEvidence(
        selectedActivities,
        fixtureDocuments,
        stub,
      );

      const byActivity = new Map<string, typeof records>();
      for (const record of records) {
        expect(() => Evidence.parse(record)).not.toThrow();
        const bucket = byActivity.get(record.activityId) ?? [];
        bucket.push(record);
        byActivity.set(record.activityId, bucket);
      }

      expect(byActivity.get("activity-webhook-fix")).toHaveLength(2);
      expect(byActivity.get("activity-feed-cache")).toHaveLength(1);
      expect(byActivity.has("activity-ci-migration")).toBe(false);

      const retryDoc = fixtureDocuments.find(
        (doc) => doc.id === "chatgpt-webhook-retry",
      );
      const first = records[0];
      expect(first).toMatchObject({
        id: "activity-webhook-fix:chatgpt-webhook-retry:0",
        activityId: "activity-webhook-fix",
        documentId: "chatgpt-webhook-retry",
        sourceType: "chatgpt",
        title: retryDoc?.title,
        timestamp: retryDoc?.timestamp,
        participants: retryDoc?.participants,
        excerpt: retrySummaryExcerpt,
      });
    });

    it("assigns deterministic ids so downstream citation resolution is reliable", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      const records = await retrieveEvidence(
        selectedActivities,
        fixtureDocuments,
        stub,
      );

      expect(records.map((record) => record.id)).toEqual([
        "activity-webhook-fix:chatgpt-webhook-retry:0",
        "activity-webhook-fix:codex-webhook-idempotency:1",
        "activity-feed-cache:chatgpt-feed-cache:0",
      ]);
    });
  });

  describe("document-id resolution guarantee", () => {
    it("every evidence record's documentId resolves to a document in the ingested corpus — zero dangling ids", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      const records = await retrieveEvidence(
        selectedActivities,
        fixtureDocuments,
        stub,
      );

      const corpusIds = new Set(fixtureDocuments.map((doc) => doc.id));
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(corpusIds.has(record.documentId)).toBe(true);
      }
    });

    it("drops results whose documentId is null or absent from the corpus — never surfaced as unresolvable evidence", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      const records = await retrieveEvidence(
        selectedActivities,
        fixtureDocuments,
        stub,
      );

      expect(records.some((record) => record.documentId === null)).toBe(false);
      expect(
        records.some((record) => record.documentId === "ghost-doc-not-in-corpus"),
      ).toBe(false);
    });
  });

  describe("per-activity seeding", () => {
    it("runs one search pair (summaries + chunks) per selected activity, in activity order, with the seed shared by both types", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      await retrieveEvidence(selectedActivities, fixtureDocuments, stub);

      expect(stub.searchCalls).toHaveLength(6);
      const [webhookSummaries, webhookChunks, feedSummaries, feedChunks, ciSummaries, ciChunks] =
        stub.searchCalls;

      expect(webhookSummaries.type).toBe("summaries");
      expect(webhookChunks.type).toBe("chunks");
      expect(webhookSummaries.query).toBe(webhookChunks.query);
      expect(feedSummaries.query).toBe(feedChunks.query);
      expect(ciSummaries.query).toBe(ciChunks.query);
      expect(webhookSummaries.query).not.toBe(feedSummaries.query);
    });

    it("derives each seed from the activity's own content (title, technologies, outcome)", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      await retrieveEvidence(selectedActivities, fixtureDocuments, stub);

      const [webhookSeed] = stub.searchCalls;
      expect(webhookSeed.query).toContain(
        "Fixed Stripe webhook double-charging bug",
      );
      expect(webhookSeed.query).toContain("TypeScript, Stripe API, PostgreSQL");
      expect(webhookSeed.query).toContain(
        "Zero duplicate charges in production since deployment",
      );

      const [, , feedSeed] = stub.searchCalls;
      expect(feedSeed.query).toContain(
        "Implemented Redis caching for feed endpoint",
      );
      expect(feedSeed.query).toContain("Redis, Node.js, Express");
    });
  });

  describe("graceful degradation", () => {
    it("an activity whose search returns nothing yields zero evidence without failing the whole retrieval", async () => {
      const stub = new StubCognee();
      enqueueFixtureSearches(stub);

      const records = await retrieveEvidence(
        selectedActivities,
        fixtureDocuments,
        stub,
      );

      expect(
        records.filter((record) => record.activityId === "activity-ci-migration"),
      ).toHaveLength(0);
    });

    it("an empty selection performs zero searches and returns no evidence", async () => {
      const stub = new StubCognee();

      const records = await retrieveEvidence([], fixtureDocuments, stub);

      expect(records).toEqual([]);
      expect(stub.searchCalls).toHaveLength(0);
    });
  });

  describe("dedup within an activity", () => {
    it("the same document excerpt returned by both summaries and chunks collapses to one record, but stays per-activity", async () => {
      const stub = new StubCognee();
      const excerpt = retrySummaryExcerpt;
      enqueueActivitySearch(
        stub,
        [{ excerpt, documentId: "chatgpt-webhook-retry" }],
        [{ excerpt, documentId: "chatgpt-webhook-retry" }],
      );
      enqueueActivitySearch(
        stub,
        [{ excerpt, documentId: "chatgpt-webhook-retry" }],
        [],
      );

      const secondActivity: Activity = {
        ...selectedActivities[0],
        id: "activity-webhook-fix-mention",
      };

      const records = await retrieveEvidence(
        [selectedActivities[0], secondActivity],
        fixtureDocuments,
        stub,
      );

      // One record per activity — the cross-query duplicate collapsed.
      expect(records.map((record) => record.activityId)).toEqual([
        "activity-webhook-fix",
        "activity-webhook-fix-mention",
      ]);
    });
  });
});

describe("Evidence schema", () => {
  const validRecord = {
    id: "activity-1:doc-1:0",
    activityId: "activity-1",
    documentId: "doc-1",
    sourceType: "chatgpt",
    title: "A document title",
    timestamp: "2026-09-07T10:15:00Z",
    participants: ["user", "assistant"],
    excerpt: "A retrieved excerpt.",
  };

  it("accepts a well-formed record", () => {
    expect(() => Evidence.parse(validRecord)).not.toThrow();
  });

  it("rejects records with unknown keys, an empty excerpt, or a bad timestamp", () => {
    expect(() =>
      Evidence.parse({ ...validRecord, extra: "nope" }),
    ).toThrow();
    expect(() =>
      Evidence.parse({ ...validRecord, excerpt: "" }),
    ).toThrow();
    expect(() =>
      Evidence.parse({ ...validRecord, timestamp: "not-a-timestamp" }),
    ).toThrow();
  });
});
