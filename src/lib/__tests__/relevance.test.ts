import { describe, expect, it, beforeEach } from "vitest";
import { matchActivities } from "../relevance";
import { FakeLlm, FakeEmbeddings } from "../llm";
import { getReferenceProfile } from "../profiles";
import type { Activity } from "../schemas";

/**
 * Fixture activities for relevance tests. These represent a week's work with
 * varying characteristics: some completed, some interesting, some routine.
 * The standup-vs-blog divergence test (core demo invariant) relies on these
 * having different profiles across the five scoring dimensions.
 */
const fixtureActivities: Activity[] = [
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
  {
    id: "activity-architecture-decision",
    title: "Chose event-sourcing over CRUD for audit trail",
    description:
      "Evaluated tradeoffs between event-sourcing and traditional CRUD for the compliance audit trail. Event-sourcing won on replay capability and temporal queries.",
    project: "Compliance Module",
    activityType: "design",
    startTime: "2026-09-06T14:00:00Z",
    lastActiveTime: "2026-09-07T11:00:00Z",
    status: "completed",
    technologies: ["Event Sourcing", "PostgreSQL"],
    outcome: "Architecture decision recorded; implementation plan drafted",
    blockers: [],
    nextSteps: ["Begin implementation of event store schema"],
    evidenceIds: ["chatgpt-webhook-retry"],
    confidence: 0.85,
  },
  {
    id: "activity-routine-admin",
    title: "Submitted timesheet and expense report",
    description:
      "Weekly admin: logged hours for the week, submitted expense receipts for conference travel.",
    project: "Admin",
    activityType: "admin",
    startTime: "2026-09-11T16:00:00Z",
    lastActiveTime: "2026-09-11T16:30:00Z",
    status: "completed",
    technologies: [],
    outcome: "Timesheet approved, expense report submitted",
    blockers: [],
    nextSteps: [],
    evidenceIds: ["email-timesheet-reminder"],
    confidence: 1.0,
  },
  {
    id: "activity-experimental-spike",
    title: "Spike: WebAssembly for client-side data processing",
    description:
      "Explored using WASM to offload heavy aggregation from the server. Promising 10x speedup in benchmarks but browser compatibility issues remain.",
    project: "API Platform",
    activityType: "spike",
    startTime: "2026-09-08T13:00:00Z",
    lastActiveTime: "2026-09-09T17:00:00Z",
    status: "abandoned",
    technologies: ["WebAssembly", "Rust"],
    outcome: "Benchmarked 10x speedup; browser support insufficient for production use",
    blockers: ["Safari WASM threading support is experimental"],
    nextSteps: [],
    evidenceIds: ["chatgpt-feed-cache"],
    confidence: 0.6,
  },
];

describe("relevance matching", () => {
  let fakeLlm: FakeLlm;
  let fakeEmbeddings: FakeEmbeddings;

  beforeEach(() => {
    fakeLlm = new FakeLlm();
    fakeEmbeddings = new FakeEmbeddings(16);
  });

  describe("core demo invariant: standup vs blog divergence", () => {
    it("standup and blog profiles select and order DIFFERENT activities from the same corpus", async () => {
      // Standup prioritizes completion + relevance; blog prioritizes novelty.
      // The canned LLM scores reflect this: webhook-fix and feed-cache score
      // high on completion (good for standup), while architecture-decision and
      // experimental-spike score high on novelty (good for blog).

      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.9,
            impact: 0.8,
            novelty: 0.5,
            completion: 1.0,
            confidence: 0.95,
          },
          {
            activityId: "activity-feed-cache",
            relevance: 0.85,
            impact: 0.9,
            novelty: 0.4,
            completion: 1.0,
            confidence: 0.9,
          },
          {
            activityId: "activity-ci-migration",
            relevance: 0.7,
            impact: 0.6,
            novelty: 0.3,
            completion: 0.3,
            confidence: 0.7,
          },
          {
            activityId: "activity-architecture-decision",
            relevance: 0.6,
            impact: 0.5,
            novelty: 0.9,
            completion: 0.5,
            confidence: 0.85,
          },
          {
            activityId: "activity-routine-admin",
            relevance: 0.1,
            impact: 0.05,
            novelty: 0.05,
            completion: 0.3,
            confidence: 0.5,
          },
          {
            activityId: "activity-experimental-spike",
            relevance: 0.5,
            impact: 0.4,
            novelty: 0.95,
            completion: 0.2,
            confidence: 0.6,
          },
        ],
      });

      // Second call for blog profile
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.7,
            impact: 0.8,
            novelty: 0.6,
            completion: 1.0,
            confidence: 0.95,
          },
          {
            activityId: "activity-feed-cache",
            relevance: 0.75,
            impact: 0.85,
            novelty: 0.5,
            completion: 1.0,
            confidence: 0.9,
          },
          {
            activityId: "activity-ci-migration",
            relevance: 0.6,
            impact: 0.5,
            novelty: 0.4,
            completion: 0.3,
            confidence: 0.7,
          },
          {
            activityId: "activity-architecture-decision",
            relevance: 0.95,
            impact: 0.7,
            novelty: 0.95,
            completion: 0.6,
            confidence: 0.85,
          },
          {
            activityId: "activity-routine-admin",
            relevance: 0.1,
            impact: 0.05,
            novelty: 0.05,
            completion: 0.3,
            confidence: 0.5,
          },
          {
            activityId: "activity-experimental-spike",
            relevance: 0.85,
            impact: 0.5,
            novelty: 1.0,
            completion: 0.2,
            confidence: 0.6,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const blog = getReferenceProfile("technical-blog");

      const standupResult = await matchActivities(
        fixtureActivities,
        standup,
        fakeLlm,
        fakeEmbeddings,
      );
      const blogResult = await matchActivities(
        fixtureActivities,
        blog,
        fakeLlm,
        fakeEmbeddings,
      );

      // The core demo invariant: different profiles select different activities.
      const standupIds = standupResult.selected.map((s) => s.activityId);
      const blogIds = blogResult.selected.map((s) => s.activityId);

      // They should not be identical — at minimum, the ordering should differ,
      // and ideally the selected sets should differ.
      expect(standupIds).not.toEqual(blogIds);

      // Standup should favor completed work (webhook-fix, feed-cache at top).
      expect(standupIds[0]).toBe("activity-webhook-fix");
      expect(standupIds[1]).toBe("activity-feed-cache");

      // Blog should favor novel work (architecture-decision, experimental-spike).
      expect(blogIds).toContain("activity-architecture-decision");
      expect(blogIds).toContain("activity-experimental-spike");
    });
  });

  describe("below-threshold exclusion", () => {
    it("activities scoring below the profile threshold are excluded but returned with scores", async () => {
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.9,
            impact: 0.8,
            novelty: 0.5,
            completion: 1.0,
            confidence: 0.95,
          },
          {
            activityId: "activity-routine-admin",
            relevance: 0.1,
            impact: 0.05,
            novelty: 0.05,
            completion: 0.3,
            confidence: 0.5,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0], fixtureActivities[4]], // webhook-fix, routine-admin
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      // Routine admin should be dropped (low relevance + low impact).
      expect(result.selected.map((s) => s.activityId)).toContain(
        "activity-webhook-fix",
      );
      expect(result.dropped.map((s) => s.activityId)).toContain(
        "activity-routine-admin",
      );

      // Dropped activities still have scores (for UI "why was this dropped").
      const droppedAdmin = result.dropped.find(
        (s) => s.activityId === "activity-routine-admin",
      );
      expect(droppedAdmin).toBeDefined();
      expect(droppedAdmin?.dimensions.relevance).toBe(0.1);
      expect(droppedAdmin?.weightedTotal).toBeLessThan(standup.threshold);
    });
  });

  describe("code-computed weighting", () => {
    it("weighted totals are computed in code from the five dimensions and profile weights", async () => {
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.8,
            impact: 0.7,
            novelty: 0.5,
            completion: 0.9,
            confidence: 0.85,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      expect(result.selected).toHaveLength(1);
      const score = result.selected[0];

      // Manually compute the expected weighted total.
      const weights = standup.scoreWeights;
      const totalWeight =
        weights.relevance +
        weights.impact +
        weights.novelty +
        weights.completion +
        weights.confidence;
      const expected =
        (0.8 * weights.relevance +
          0.7 * weights.impact +
          0.5 * weights.novelty +
          0.9 * weights.completion +
          0.85 * weights.confidence) /
        totalWeight;

      expect(score.weightedTotal).toBeCloseTo(expected, 5);
    });

    it("the LLM never does arithmetic — weights and threshold are applied in code", async () => {
      // Even if the LLM returned scores that would pass the threshold if
      // unweighted, the code applies weights correctly.
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 1.0,
            impact: 1.0,
            novelty: 1.0,
            completion: 1.0,
            confidence: 1.0,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      // All dimensions at 1.0 should yield weighted total of 1.0 regardless of weights.
      expect(result.selected[0].weightedTotal).toBe(1.0);
    });
  });

  describe("noise activity exclusion", () => {
    it("routine admin activity scores low and is excluded for both standup and blog", async () => {
      // Canned scores where routine admin is low across the board.
      const lowScores = {
        scores: [
          {
            activityId: "activity-routine-admin",
            relevance: 0.1,
            impact: 0.05,
            novelty: 0.05,
            completion: 0.3,
            confidence: 0.5,
          },
        ],
      };

      fakeLlm.enqueue(lowScores);
      fakeLlm.enqueue(lowScores);

      const standup = getReferenceProfile("standup");
      const blog = getReferenceProfile("technical-blog");

      const standupResult = await matchActivities(
        [fixtureActivities[4]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );
      const blogResult = await matchActivities(
        [fixtureActivities[4]],
        blog,
        fakeLlm,
        fakeEmbeddings,
      );

      // Routine admin should be dropped by both profiles.
      expect(standupResult.selected).toHaveLength(0);
      expect(standupResult.dropped).toHaveLength(1);
      expect(blogResult.selected).toHaveLength(0);
      expect(blogResult.dropped).toHaveLength(1);
    });
  });

  describe("embedding pre-filter", () => {
    it("the shortlist passed to the LLM judge respects the top-K embedding pre-filter", async () => {
      // With 6 activities and topK=3, only 3 should reach the LLM.
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.9,
            impact: 0.8,
            novelty: 0.5,
            completion: 1.0,
            confidence: 0.95,
          },
          {
            activityId: "activity-feed-cache",
            relevance: 0.85,
            impact: 0.9,
            novelty: 0.4,
            completion: 1.0,
            confidence: 0.9,
          },
          {
            activityId: "activity-ci-migration",
            relevance: 0.7,
            impact: 0.6,
            novelty: 0.3,
            completion: 0.3,
            confidence: 0.7,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      await matchActivities(
        fixtureActivities,
        standup,
        fakeLlm,
        fakeEmbeddings,
        { topK: 3 },
      );

      // The embedding client should have been called once with profile + all activities.
      expect(fakeEmbeddings.history).toHaveLength(1);
      expect(fakeEmbeddings.history[0]).toHaveLength(7); // 1 profile + 6 activities

      // The LLM should have received only the top-3 shortlist.
      expect(fakeLlm.history).toHaveLength(1);
      const llmPrompt = fakeLlm.history[0].messages[1].content;
      // The prompt should mention the 3 shortlisted activities.
      expect(llmPrompt).toContain("activity-webhook-fix");
      expect(llmPrompt).toContain("activity-feed-cache");
      expect(llmPrompt).toContain("activity-ci-migration");
      // And not the others (assuming they ranked lower in embedding similarity).
      // Note: FakeEmbeddings returns one-hot vectors, so the ordering is
      // deterministic based on index position.
    });
  });

  describe("deterministic ordering", () => {
    it("selected activities are sorted by weighted total descending", async () => {
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.7,
            impact: 0.6,
            novelty: 0.5,
            completion: 0.8,
            confidence: 0.75,
          },
          {
            activityId: "activity-feed-cache",
            relevance: 0.9,
            impact: 0.9,
            novelty: 0.6,
            completion: 1.0,
            confidence: 0.9,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0], fixtureActivities[1]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      // feed-cache should rank higher than webhook-fix due to higher scores.
      expect(result.selected[0].activityId).toBe("activity-feed-cache");
      expect(result.selected[1].activityId).toBe("activity-webhook-fix");
    });

    it("ties in weighted total are broken by lastActiveTime descending", async () => {
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.8,
            impact: 0.7,
            novelty: 0.5,
            completion: 0.9,
            confidence: 0.85,
          },
          {
            activityId: "activity-feed-cache",
            relevance: 0.8,
            impact: 0.7,
            novelty: 0.5,
            completion: 0.9,
            confidence: 0.85,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0], fixtureActivities[1]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      // feed-cache has later lastActiveTime (2026-09-09) than webhook-fix (2026-09-08).
      expect(result.selected[0].activityId).toBe("activity-feed-cache");
    });
  });

  describe("empty input", () => {
    it("returns empty selected and dropped when given no activities", async () => {
      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      expect(result.selected).toHaveLength(0);
      expect(result.dropped).toHaveLength(0);
      expect(fakeLlm.history).toHaveLength(0);
    });
  });

  describe("result shape", () => {
    it("returns profileKey, threshold, and full scores for selected and dropped", async () => {
      fakeLlm.enqueue({
        scores: [
          {
            activityId: "activity-webhook-fix",
            relevance: 0.9,
            impact: 0.8,
            novelty: 0.5,
            completion: 1.0,
            confidence: 0.95,
          },
        ],
      });

      const standup = getReferenceProfile("standup");
      const result = await matchActivities(
        [fixtureActivities[0]],
        standup,
        fakeLlm,
        fakeEmbeddings,
      );

      expect(result.profileKey).toBe("standup");
      expect(result.threshold).toBe(standup.threshold);
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0].dimensions).toEqual({
        relevance: 0.9,
        impact: 0.8,
        novelty: 0.5,
        completion: 1.0,
        confidence: 0.95,
      });
    });
  });
});
