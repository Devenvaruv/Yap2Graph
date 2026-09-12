import { describe, expect, it } from "vitest";
import {
  SCORE_DIMENSIONS,
  Activity,
  CandidateEvent,
  GeneratedOutput,
  ReferenceProfile,
  SourceDocument,
} from "../schemas";

const validSourceDocument = {
  id: "doc-1",
  sourceType: "chatgpt",
  title: "Fixture document",
  timestamp: "2026-09-07T10:15:00Z",
  participants: ["user", "assistant"],
  content: "Some meaningful work discussion.",
  metadata: { conversationId: "conv-1" },
};

const validCandidateEvent = {
  id: "cand-1",
  documentId: "doc-1",
  title: "Discussed duplicate charges from webhook retries",
  description:
    "Root-caused duplicate charges to a non-idempotent webhook handler and settled on a transactional processed_events check.",
  project: "billing-api",
  activityType: "debugging",
  startTime: "2026-09-07T10:15:00Z",
  lastActiveTime: "2026-09-07T11:00:00Z",
  status: "in_progress",
  technologies: ["Stripe", "Postgres"],
  blockers: [],
  nextSteps: ["Implement the processed_events check"],
  confidence: 0.8,
};

const validActivity = {
  id: "act-1",
  title: "Fix duplicate charges from Stripe webhook retries",
  description:
    "Root-caused duplicate charges to a non-idempotent webhook handler, implemented a transactional processed_events check, and shipped it.",
  project: "billing-api",
  activityType: "debugging",
  startTime: "2026-09-07T10:15:00Z",
  lastActiveTime: "2026-09-09T09:30:00Z",
  status: "completed",
  technologies: ["Stripe", "Postgres", "Node.js"],
  outcome: "Zero duplicate charges in 24h of production monitoring.",
  blockers: [],
  nextSteps: [],
  beforeState:
    "Webhook retries re-processed payments and double-charged ~3 customers/day.",
  afterState:
    "Retries are deduplicated at the transaction boundary; zero duplicate charges.",
  evidenceIds: [
    "chatgpt-webhook-retry",
    "codex-webhook-idempotency",
    "email-webhook-shipped",
  ],
  confidence: 0.95,
};

const validReferenceProfile = {
  key: "standup",
  audience: "My team at daily standup",
  sections: ["Completed", "In progress", "Blockers", "Next steps"],
  includeCriteria: [
    "completed work with a stated outcome",
    "in-progress work",
    "blockers with the thing blocking them",
    "concrete next actions",
  ],
  excludeCriteria: ["routine admin and reminders", "trivial rewording requests"],
  scoreWeights: {
    relevance: 0.3,
    impact: 0.2,
    novelty: 0.1,
    completion: 0.3,
    confidence: 0.1,
  },
  threshold: 0.5,
  outputConstraints:
    "First-person standup bullets, max 5 bullets per section, no preamble.",
};

const validGeneratedOutput = {
  profileKey: "standup",
  timeRange: { start: "2026-09-05T00:00:00Z", end: "2026-09-11T23:59:59Z" },
  sections: [
    {
      title: "Completed",
      claims: [
        {
          markdown: "Shipped the idempotent webhook handler.",
          evidenceIds: ["email-webhook-shipped"],
        },
      ],
    },
    { title: "Blockers", claims: [] },
  ],
};

describe("SourceDocument", () => {
  it("accepts a normalized document", () => {
    expect(SourceDocument.safeParse(validSourceDocument).success).toBe(true);
  });

  it("accepts timestamps with UTC offsets", () => {
    const withOffset = {
      ...validSourceDocument,
      timestamp: "2026-09-07T12:15:00+02:00",
    };
    expect(SourceDocument.safeParse(withOffset).success).toBe(true);
  });

  it("rejects an unknown sourceType", () => {
    expect(
      SourceDocument.safeParse({ ...validSourceDocument, sourceType: "slack" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(
      SourceDocument.safeParse({ ...validSourceDocument, content: undefined })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      SourceDocument.safeParse({ ...validSourceDocument, extra: "field" })
        .success,
    ).toBe(false);
  });
});

describe("CandidateEvent", () => {
  it("accepts a map-pass candidate", () => {
    expect(CandidateEvent.safeParse(validCandidateEvent).success).toBe(true);
  });

  it("accepts a candidate without the optional project/status/outcome", () => {
    const minimal = {
      ...validCandidateEvent,
      project: undefined,
      status: undefined,
    };
    expect(CandidateEvent.safeParse(minimal).success).toBe(true);
  });

  it("rejects a candidate without a documentId", () => {
    expect(
      CandidateEvent.safeParse({ ...validCandidateEvent, documentId: undefined })
        .success,
    ).toBe(false);
  });

  it("rejects stray evidenceIds — documentId is the only evidence link", () => {
    const withEvidenceIds = { ...validCandidateEvent, evidenceIds: ["doc-1"] };
    expect(CandidateEvent.safeParse(withEvidenceIds).success).toBe(false);
  });
});

describe("Activity", () => {
  it("accepts a fully merged activity", () => {
    expect(Activity.safeParse(validActivity).success).toBe(true);
  });

  it("accepts an activity without optional state fields", () => {
    const minimal = {
      ...validActivity,
      outcome: undefined,
      beforeState: undefined,
      afterState: undefined,
    };
    expect(Activity.safeParse(minimal).success).toBe(true);
  });

  it("rejects an activity with zero evidence", () => {
    expect(
      Activity.safeParse({ ...validActivity, evidenceIds: [] }).success,
    ).toBe(false);
  });

  it("rejects an activity missing evidenceIds entirely", () => {
    const noEvidenceKey = { ...validActivity, evidenceIds: undefined };
    expect(Activity.safeParse(noEvidenceKey).success).toBe(false);
  });

  it("rejects confidence outside 0–1", () => {
    expect(
      Activity.safeParse({ ...validActivity, confidence: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      Activity.safeParse({ ...validActivity, status: "done" }).success,
    ).toBe(false);
  });
});

describe("ReferenceProfile", () => {
  it("accepts a complete profile", () => {
    expect(ReferenceProfile.safeParse(validReferenceProfile).success).toBe(
      true,
    );
  });

  it("rejects a profile missing one scoring dimension", () => {
    const missingNovelty = {
      ...validReferenceProfile,
      scoreWeights: {
        relevance: 0.3,
        impact: 0.2,
        completion: 0.3,
        confidence: 0.1,
      },
    };
    expect(ReferenceProfile.safeParse(missingNovelty).success).toBe(false);
  });

  it("rejects a threshold outside 0–1", () => {
    expect(
      ReferenceProfile.safeParse({ ...validReferenceProfile, threshold: 1.2 })
        .success,
    ).toBe(false);
  });

  it("rejects a profile with no sections", () => {
    expect(
      ReferenceProfile.safeParse({ ...validReferenceProfile, sections: [] })
        .success,
    ).toBe(false);
  });

  it("covers exactly the five scoring dimensions in scoreWeights", () => {
    expect(Object.keys(ReferenceProfile.shape.scoreWeights.shape).sort()).toEqual(
      [...SCORE_DIMENSIONS].sort(),
    );
  });
});

describe("GeneratedOutput", () => {
  it("accepts a structured output with cited claims", () => {
    expect(GeneratedOutput.safeParse(validGeneratedOutput).success).toBe(true);
  });

  it("allows sections with no claims (e.g. no blockers this week)", () => {
    const emptySectionOnly = {
      ...validGeneratedOutput,
      sections: [{ title: "Blockers", claims: [] }],
    };
    expect(GeneratedOutput.safeParse(emptySectionOnly).success).toBe(true);
  });

  it("rejects a claim missing evidenceIds", () => {
    const dangling = {
      ...validGeneratedOutput,
      sections: [
        {
          title: "Completed",
          claims: [{ markdown: "Shipped the fix." }],
        },
      ],
    };
    expect(GeneratedOutput.safeParse(dangling).success).toBe(false);
  });

  it("rejects a timeRange missing its end", () => {
    const openEnded = {
      ...validGeneratedOutput,
      timeRange: { start: "2026-09-05T00:00:00Z" },
    };
    expect(GeneratedOutput.safeParse(openEnded).success).toBe(false);
  });

  it("rejects output with no sections", () => {
    expect(
      GeneratedOutput.safeParse({ ...validGeneratedOutput, sections: [] })
        .success,
    ).toBe(false);
  });
});
