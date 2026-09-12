import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  fixtureDocuments,
  fixtureThreads,
  noiseDocumentIds,
} from "../fixtures";
import { FakeLlm } from "../llm";
import { loadActivities, saveActivities } from "../activity-store";
import {
  mergeCandidateEvents,
  repairActivityEvidence,
} from "../merge-pass";
import type { Activity, CandidateEvent, SourceDocument } from "../schemas";

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

const threadMerges: Record<string, Omit<Activity, "evidenceIds">> = {
  "thread-payment-webhook": {
    id: "activity-payment-webhook",
    title: "Fixed duplicate Stripe webhook charges in billing-api",
    description:
      "Designed and shipped an idempotent Stripe webhook handler: the event id is checked against a processed_events table in the same Postgres transaction as the charge.",
    project: "billing-api",
    activityType: "implementation",
    startTime: "2026-09-07T00:00:00Z",
    lastActiveTime: "2026-09-07T23:59:59Z",
    status: "completed",
    technologies: ["Stripe", "Postgres"],
    outcome:
      "Webhook retries are deduplicated at the transaction boundary; zero duplicate charges after 24h in production.",
    blockers: [],
    nextSteps: [],
    beforeState:
      "Every Stripe webhook retry re-processed the payment event, double-charging roughly 3 customers a day.",
    afterState:
      "Retries are no-ops — duplicate event ids roll back as a single no-op transaction, and open complaints are refunded and closed.",
    confidence: 0.95,
  },
  "thread-feed-caching": {
    id: "activity-feed-caching",
    title: "Added Redis cache layer to the mobile-backend feed endpoint",
    description:
      "Replaced the per-request friend-graph join with a 60s write-invalidated Redis cache in front of the composed feed.",
    project: "mobile-backend",
    activityType: "implementation",
    startTime: "2026-09-08T00:00:00Z",
    lastActiveTime: "2026-09-08T23:59:59Z",
    status: "completed",
    technologies: ["Redis", "Postgres"],
    outcome:
      "Feed p95 dropped from 800ms to 90ms with a 97% cache hit rate; average session length up 8%.",
    blockers: [],
    nextSteps: [],
    beforeState:
      "Every feed request recomputed the full activities/likes/comments join for the friend graph, p95 800ms.",
    afterState:
      "Only the first request per TTL window pays the join; p95 is stable at 90ms with explicit invalidation on writes.",
    confidence: 0.95,
  },
  "thread-ci-migration": {
    id: "activity-ci-migration",
    title: "Migrating platform-infra CI from CircleCI to GitHub Actions",
    description:
      "Settled on self-hosted runners and migrated 12 of 18 jobs to GitHub Actions while keeping CircleCI green in parallel.",
    project: "platform-infra",
    activityType: "migration",
    startTime: "2026-09-09T00:00:00Z",
    lastActiveTime: "2026-09-09T23:59:59Z",
    status: "blocked",
    technologies: ["GitHub Actions", "CircleCI", "Kubernetes"],
    outcome: "12 of 18 jobs run on GitHub Actions; all migrated jobs green.",
    blockers: [
      "The remaining 6 deploy jobs need self-hosted runner registration tokens pending infra approval.",
    ],
    nextSteps: [
      "Resume after the runner rollout lands; pick back up the Monday after next.",
    ],
    beforeState:
      "All 18 CI jobs ran on CircleCI at about $1.9k/month, with the bill climbing.",
    afterState:
      "12 of 18 jobs run on GitHub Actions on self-hosted spot runners; the migration is on hold until runner tokens land.",
    confidence: 0.85,
  },
};

function mergedActivityFor(threadId: string): Activity {
  const thread = fixtureThreads.find((entry) => entry.id === threadId);
  if (!thread) throw new Error(`Missing fixture thread: ${threadId}`);
  return {
    ...threadMerges[threadId],
    evidenceIds: [...thread.documentIds],
  };
}

function threadCandidates(threadId: string): CandidateEvent[] {
  const thread = fixtureThreads.find((entry) => entry.id === threadId);
  if (!thread) throw new Error(`Missing fixture thread: ${threadId}`);
  return thread.documentIds.map((documentId, index) =>
    candidateFor(documentById(documentId), {
      project: threadMerges[threadId].project,
      status: index === thread.documentIds.length - 1
        ? threadMerges[threadId].status
        : "in_progress",
      technologies: threadMerges[threadId].technologies,
    }),
  );
}

const tempDirs: string[] = [];

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "yap2graph-t06-"));
  tempDirs.push(dir);
  return join(dir, "nested", "activities.json");
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("merge pass", () => {
  it("merges each cross-source thread into exactly one persisted activity (PRD seam 1)", async () => {
    const candidates = fixtureThreads.flatMap((thread) =>
      threadCandidates(thread.id),
    );
    const llm = new FakeLlm().enqueue({
      activities: fixtureThreads.map((thread) => mergedActivityFor(thread.id)),
    });

    const activities = await mergeCandidateEvents(candidates, llm);

    expect(activities).toHaveLength(fixtureThreads.length);
    for (const thread of fixtureThreads) {
      const matches = activities.filter((activity) =>
        thread.documentIds.every((id) => activity.evidenceIds.includes(id)),
      );
      expect(matches).toHaveLength(1);
      const [activity] = matches;
      expect(activity.evidenceIds).toEqual(thread.documentIds);
      expect(activity.status).toBe(thread.expectedStatus);
      expect(activity.beforeState).toBeTruthy();
      expect(activity.afterState).toBeTruthy();
    }

    const storePath = await tempStorePath();
    await saveActivities(activities, storePath);
    await expect(loadActivities(storePath)).resolves.toEqual(activities);
    await expect(readFile(`${storePath}.tmp`, "utf8")).rejects.toThrow();
  });

  it("derives activity time bounds from the merged candidates, not the LLM prose", async () => {
    const candidates = threadCandidates("thread-payment-webhook");
    const llm = new FakeLlm().enqueue({
      activities: [mergedActivityFor("thread-payment-webhook")],
    });

    const [activity] = await mergeCandidateEvents(candidates, llm);

    const earliest = candidates.reduce((a, b) =>
      Date.parse(a.startTime) <= Date.parse(b.startTime) ? a : b,
    );
    const latest = candidates.reduce((a, b) =>
      Date.parse(a.lastActiveTime) >= Date.parse(b.lastActiveTime) ? a : b,
    );
    expect(activity.startTime).toBe(earliest.startTime);
    expect(activity.lastActiveTime).toBe(latest.lastActiveTime);
  });

  it("drops noise candidates entirely — no activity references their documents", async () => {
    const candidates = [
      ...threadCandidates("thread-feed-caching"),
      ...noiseDocumentIds.map((id) => candidateFor(documentById(id))),
    ];
    const llm = new FakeLlm().enqueue({
      activities: [mergedActivityFor("thread-feed-caching")],
    });

    const activities = await mergeCandidateEvents(candidates, llm);

    expect(activities).toHaveLength(1);
    for (const noiseId of noiseDocumentIds) {
      expect(activities[0].evidenceIds).not.toContain(noiseId);
    }
  });

  it("repairs invented evidence ids instead of accepting them", async () => {
    const candidates = threadCandidates("thread-payment-webhook");
    const llm = new FakeLlm().enqueue({
      activities: [
        {
          ...mergedActivityFor("thread-payment-webhook"),
          evidenceIds: [
            "chatgpt-webhook-retry",
            "codex-webhook-idempotency",
            "email-webhook-shipped",
            "doc-invented-by-model",
            "doc-invented-by-model",
          ],
        },
      ],
    });

    const [activity] = await mergeCandidateEvents(candidates, llm);

    expect(activity.evidenceIds).toEqual([
      "chatgpt-webhook-retry",
      "codex-webhook-idempotency",
      "email-webhook-shipped",
    ]);
  });

  it("fails loudly when an activity ends up with zero valid evidence", async () => {
    const candidates = threadCandidates("thread-payment-webhook");
    const llm = new FakeLlm().enqueue({
      activities: [
        {
          ...mergedActivityFor("thread-payment-webhook"),
          evidenceIds: ["doc-invented-by-model"],
        },
      ],
    });

    await expect(mergeCandidateEvents(candidates, llm)).rejects.toThrow(
      /evidence integrity violation/,
    );
  });

  it("returns no activities without calling the LLM when there are no candidates", async () => {
    const llm = new FakeLlm();

    await expect(mergeCandidateEvents([], llm)).resolves.toEqual([]);
    expect(llm.history).toHaveLength(0);
  });

  it("surfaces invalid LLM output instead of partially parsing it", async () => {
    const candidates = threadCandidates("thread-payment-webhook");
    const llm = new FakeLlm().enqueue({
      activities: [{ id: "activity-invalid", title: "Missing required fields" }],
    });

    await expect(mergeCandidateEvents(candidates, llm)).rejects.toThrow(
      /schema validation/,
    );
  });
});

describe("repairActivityEvidence", () => {
  const activity = mergedActivityFor("thread-payment-webhook");

  it("drops unknown ids and dedupes in first-seen order", () => {
    const repaired = repairActivityEvidence(
      { ...activity, evidenceIds: ["chatgpt-webhook-retry", "ghost", "chatgpt-webhook-retry", "ghost-2"] },
      new Set(["chatgpt-webhook-retry", "codex-webhook-idempotency"]),
    );
    expect(repaired.evidenceIds).toEqual(["chatgpt-webhook-retry"]);
  });

  it("throws when no supplied id remains", () => {
    expect(() =>
      repairActivityEvidence(
        { ...activity, evidenceIds: ["ghost", "ghost-2"] },
        new Set(["chatgpt-webhook-retry"]),
      ),
    ).toThrow(/evidence integrity violation/);
  });
});
