import { describe, expect, it } from "vitest";
import { Evidence } from "../evidence";
import {
  GenerationError,
  checkCitationIntegrity,
  generateOutput,
  type SelectedActivity,
} from "../generation";
import { FakeLlm } from "../llm";
import { REFERENCE_PROFILES, getReferenceProfile } from "../profiles";
import type { ActivityScore } from "../relevance";
import {
  GeneratedOutput,
  type Activity,
  type GeneratedOutput as GeneratedOutputType,
} from "../schemas";
import { fixtureDocuments, fixtureWindow } from "../fixtures";

/**
 * T12 query-seam tests (PRD seam 2): canned generation in → structured,
 * citation-carrying output out. Every evidence id in the output resolves to
 * a supplied record; below-threshold activities are never supplied, so any
 * citation to one is dangling and gets repaired or rejected. Zero live API
 * calls — FakeLlm only.
 */

const standupProfile = getReferenceProfile("standup");
const blogProfile = getReferenceProfile("technical-blog");

const webhookActivity: Activity = {
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
};

const feedActivity: Activity = {
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
};

/**
 * Below-threshold / unselected activity: generation never receives it or its
 * evidence, so any citation to it is a dangling id by construction.
 */
const unselectedActivityId = "activity-ci-migration";
const unselectedEvidenceId = `${unselectedActivityId}:chatgpt-ci-migration:0`;

function score(activityId: string, weightedTotal: number): ActivityScore {
  return {
    activityId,
    dimensions: {
      relevance: weightedTotal,
      impact: weightedTotal,
      novelty: weightedTotal,
      completion: weightedTotal,
      confidence: weightedTotal,
    },
    weightedTotal,
  };
}

const selected: SelectedActivity[] = [
  { activity: webhookActivity, score: score(webhookActivity.id, 0.92) },
  { activity: feedActivity, score: score(feedActivity.id, 0.88) },
];

/** Build a T11-shaped evidence record for a fixture document. */
function makeEvidence(
  activityId: string,
  documentId: string,
  chunkIndex: number,
): Evidence {
  const doc = fixtureDocuments.find((d) => d.id === documentId);
  if (!doc) throw new Error(`unknown fixture document ${documentId}`);
  return Evidence.parse({
    id: `${activityId}:${documentId}:${chunkIndex}`,
    activityId,
    documentId,
    sourceType: doc.sourceType,
    title: doc.title,
    timestamp: doc.timestamp,
    participants: doc.participants,
    excerpt: `Excerpt from ${doc.title}`,
  });
}

const webhookEvidence = [
  makeEvidence("activity-webhook-fix", "chatgpt-webhook-retry", 0),
  makeEvidence("activity-webhook-fix", "codex-webhook-idempotency", 1),
];
const feedEvidence = [
  makeEvidence("activity-feed-cache", "chatgpt-feed-cache", 0),
  makeEvidence("activity-feed-cache", "codex-feed-redis", 1),
];
const evidencePool: Evidence[] = [...webhookEvidence, ...feedEvidence];

/** A fully valid canned standup output citing only supplied evidence. */
function cannedStandup(): GeneratedOutputType {
  return GeneratedOutput.parse({
    profileKey: "standup",
    timeRange: fixtureWindow,
    sections: [
      {
        title: "Completed",
        claims: [
          {
            markdown:
              "Fixed the Stripe webhook double-charging bug — zero duplicate charges since deploy.",
            evidenceIds: [webhookEvidence[0].id, webhookEvidence[1].id],
          },
          {
            markdown:
              "Shipped Redis caching for the feed endpoint; p95 dropped 800ms → 90ms.",
            evidenceIds: [feedEvidence[0].id],
          },
        ],
      },
      { title: "In progress", claims: [] },
      { title: "Blockers", claims: [] },
      { title: "Next steps", claims: [] },
    ],
  });
}

function cannedBlog(): GeneratedOutputType {
  return GeneratedOutput.parse({
    profileKey: "technical-blog",
    timeRange: fixtureWindow,
    sections: [
      {
        title: "Problem",
        claims: [
          {
            markdown:
              "Stripe webhook retries were double-charging customers — the handler wasn't idempotent.",
            evidenceIds: [webhookEvidence[0].id],
          },
        ],
      },
      {
        title: "What we tried",
        claims: [
          {
            markdown:
              "Added a processed_events table with a unique constraint on the Stripe event id.",
            evidenceIds: [webhookEvidence[1].id],
          },
        ],
      },
      {
        title: "What happened",
        claims: [
          {
            markdown: "Zero duplicate charges in production since deployment.",
            evidenceIds: [webhookEvidence[1].id],
          },
        ],
      },
      { title: "Lessons learned", claims: [] },
    ],
  });
}

describe("generateOutput — happy path", () => {
  it("returns a Zod-validated GeneratedOutput whose sections match the profile's defined sections", async () => {
    const llm = new FakeLlm().enqueue(cannedStandup());

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(() => GeneratedOutput.parse(output)).not.toThrow();
    expect(output.profileKey).toBe("standup");
    expect(output.sections.map((s) => s.title)).toEqual(standupProfile.sections);
    expect(llm.history).toHaveLength(1);
    expect(llm.history[0].purpose).toBe("generation");
  });

  it("every evidence id in every claim resolves to a supplied evidence record", async () => {
    const llm = new FakeLlm().enqueue(cannedStandup());
    const poolIds = new Set(evidencePool.map((r) => r.id));

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(output.sections.length).toBeGreaterThan(0);
    for (const section of output.sections) {
      for (const claim of section.claims) {
        expect(typeof claim.markdown).toBe("string");
        expect(claim.markdown.length).toBeGreaterThan(0);
        expect(claim.evidenceIds.length).toBeGreaterThan(0);
        for (const id of claim.evidenceIds) {
          expect(poolIds.has(id)).toBe(true);
        }
      }
    }
  });

  it("prompts with the activities (state, outcome, blockers, next steps) and the evidence pool ids", async () => {
    const llm = new FakeLlm().enqueue(cannedStandup());

    await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    const prompt = llm.history[0].messages
      .map((m) => m.content)
      .join("\n");
    expect(prompt).toContain("Webhook retries could process the same event twice");
    expect(prompt).toContain("Zero duplicate charges in production since deployment");
    expect(prompt).toContain("p95 latency reduced from 800ms to 90ms");
    expect(prompt).toContain(webhookEvidence[0].id);
    expect(prompt).toContain(standupProfile.outputConstraints);
  });
});

describe("generateOutput — profile-agnostic code path", () => {
  it("the same generator serves the blog profile unchanged — only inputs differ", async () => {
    const llm = new FakeLlm().enqueue(cannedBlog());

    const output = await generateOutput({
      profile: blogProfile,
      timeRange: fixtureWindow,
      selected: [selected[0]],
      evidence: webhookEvidence,
      llm,
    });

    expect(output.profileKey).toBe("technical-blog");
    expect(output.sections.map((s) => s.title)).toEqual(blogProfile.sections);
    expect(llm.history[0].purpose).toBe("generation");
  });
});

describe("generateOutput — citation integrity repair/reject", () => {
  it("a dangling evidence id triggers exactly one repair retry that includes the validation error, then succeeds", async () => {
    const broken = cannedStandup();
    broken.sections[0].claims[0].evidenceIds = [
      webhookEvidence[0].id,
      "activity-ghost:doc-ghost:0",
    ];
    const llm = new FakeLlm().enqueue(broken).enqueue(cannedStandup());

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(output.sections[0].claims[0].evidenceIds).toEqual([
      webhookEvidence[0].id,
      webhookEvidence[1].id,
    ]);
    expect(llm.history).toHaveLength(2);

    const repairNote =
      llm.history[1].messages[llm.history[1].messages.length - 1];
    expect(repairNote.role).toBe("user");
    expect(repairNote.content).toContain("activity-ghost:doc-ghost:0");
    expect(repairNote.content).toContain("Validation errors");
  });

  it("an id belonging to an unselected (below-threshold) activity is dangling — its evidence was never supplied", async () => {
    const broken = cannedStandup();
    broken.sections[0].claims[0].evidenceIds = [unselectedEvidenceId];
    const llm = new FakeLlm().enqueue(broken).enqueue(cannedStandup());

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(output.sections[0].claims[0].evidenceIds).not.toContain(
      unselectedEvidenceId,
    );
    expect(llm.history).toHaveLength(2);
  });

  it("a claim with no evidence ids violates the every-claim-cites policy and is repaired", async () => {
    const broken = cannedStandup();
    broken.sections[0].claims[1].evidenceIds = [];
    const llm = new FakeLlm().enqueue(broken).enqueue(cannedStandup());

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(output.sections[0].claims[1].evidenceIds).toEqual([
      feedEvidence[0].id,
    ]);
  });

  it("two consecutive failures fail loudly with GenerationError — and never a third call", async () => {
    const broken = cannedStandup();
    broken.sections[0].claims[0].evidenceIds = ["activity-ghost:doc-ghost:0"];
    const llm = new FakeLlm().enqueue(broken).enqueue(broken);

    await expect(
      generateOutput({
        profile: standupProfile,
        timeRange: fixtureWindow,
        selected,
        evidence: evidencePool,
        llm,
      }),
    ).rejects.toThrow(GenerationError);

    try {
      await generateOutput({
        profile: standupProfile,
        timeRange: fixtureWindow,
        selected,
        evidence: evidencePool,
        llm: new FakeLlm().enqueue(broken).enqueue(broken),
      });
      expect.unreachable("expected GenerationError");
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationError);
      expect((err as GenerationError).message).toContain(
        "activity-ghost:doc-ghost:0",
      );
      expect((err as GenerationError).violations.length).toBeGreaterThan(0);
    }
    expect(llm.history).toHaveLength(2);
  });

  it("a schema-invalid first response is retried once with the error included, then fails loudly", async () => {
    const llm = new FakeLlm()
      .enqueueInvalid({ not: "a generated output" })
      .enqueueInvalid({ not: "a generated output" });

    await expect(
      generateOutput({
        profile: standupProfile,
        timeRange: fixtureWindow,
        selected,
        evidence: evidencePool,
        llm,
      }),
    ).rejects.toThrow(/Generation failed citation integrity/);
    expect(llm.history).toHaveLength(2);

    const repairNote =
      llm.history[1].messages[llm.history[1].messages.length - 1];
    expect(repairNote.content).toContain("Zod validation failed (canned)");
  });

  it("a schema-invalid first response followed by a valid one succeeds on the repair attempt", async () => {
    const llm = new FakeLlm()
      .enqueueInvalid({ not: "a generated output" })
      .enqueue(cannedStandup());

    const output = await generateOutput({
      profile: standupProfile,
      timeRange: fixtureWindow,
      selected,
      evidence: evidencePool,
      llm,
    });

    expect(output.sections.map((s) => s.title)).toEqual(
      standupProfile.sections,
    );
    expect(llm.history).toHaveLength(2);
  });
});

describe("checkCitationIntegrity — direct gate tests", () => {
  const emptyPool: Evidence[] = [];

  it("accepts a well-formed output with resolvable citations", () => {
    expect(
      checkCitationIntegrity(cannedStandup(), standupProfile, fixtureWindow, evidencePool),
    ).toEqual([]);
  });

  it("flags a dangling evidence id, an uncited claim, wrong sections, wrong profileKey, and wrong timeRange", () => {
    const bad = GeneratedOutput.parse({
      profileKey: "manager-update",
      timeRange: { start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z" },
      sections: [
        {
          title: "Completed",
          claims: [
            { markdown: "A claim with a dangling citation.", evidenceIds: ["nope:doc:0"] },
            { markdown: "An uncited connective sentence.", evidenceIds: [] },
          ],
        },
      ],
    });

    const violations = checkCitationIntegrity(
      bad,
      standupProfile,
      fixtureWindow,
      evidencePool,
    );

    expect(violations.some((v) => v.includes('"manager-update"'))).toBe(true);
    expect(violations.some((v) => v.includes("timeRange"))).toBe(true);
    expect(violations.some((v) => v.includes("sections must be exactly"))).toBe(
      true,
    );
    expect(violations.some((v) => v.includes("no evidence ids"))).toBe(true);
    expect(violations.some((v) => v.includes('"nope:doc:0"'))).toBe(true);
  });

  it("never accepts output whose citations resolve to nothing in the pool", () => {
    const bad = cannedStandup();
    expect(
      checkCitationIntegrity(bad, standupProfile, fixtureWindow, emptyPool),
    ).not.toEqual([]);
  });
});

describe("reference profiles stay generatable", () => {
  it("all six profiles define the sections the gate enforces", () => {
    for (const profile of REFERENCE_PROFILES) {
      expect(profile.sections.length).toBeGreaterThan(0);
      expect(profile.outputConstraints.length).toBeGreaterThan(0);
    }
  });
});
