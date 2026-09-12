import { z } from "zod";
import { fixtureThreads, noiseDocumentIds } from ".";
import type { ChatMessage, LlmCall, LlmClient } from "../llm";
import { CandidateEventsResponse } from "../map-pass";
import { MergedActivitiesResponse } from "../merge-pass";
import {
  CandidateEvent,
  SourceDocument,
  type Activity,
  type SourceType,
} from "../schemas";

/**
 * Canned pipeline responses for the raw-export fixture corpus — the
 * deterministic "model" behind `npm run ingest`. The map pass never sees the
 * T02 corpus here: every response is derived from the adapted raw-export
 * document embedded in the request, so the CLI works on any cache state.
 */

const activityTypeBySource: Record<SourceType, string> = {
  chatgpt: "design",
  email: "deployment",
  coding_agent: "implementation",
};

const cannedThreadActivityById: Record<string, Omit<Activity, "evidenceIds">> = {
  "thread-payment-webhook": {
    id: "activity-payment-webhook",
    title: "Fixed duplicate Stripe webhook charges in billing-api",
    description:
      "Designed and shipped an idempotent Stripe webhook handler: the event id is checked against a processed_events table in the same Postgres transaction as the charge.",
    project: "billing-api",
    activityType: "implementation",
    startTime: "2026-09-07T10:15:00Z",
    lastActiveTime: "2026-09-09T09:30:00Z",
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
    startTime: "2026-09-08T11:00:00Z",
    lastActiveTime: "2026-09-11T10:00:00Z",
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
    startTime: "2026-09-09T09:00:00Z",
    lastActiveTime: "2026-09-11T16:45:00Z",
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

/** The merged activities the canned merge response returns for the full corpus. */
export const cannedThreadActivities: Activity[] = fixtureThreads.map((thread) => ({
  ...cannedThreadActivityById[thread.id],
  evidenceIds: [...thread.documentIds],
}));

const threadByDocumentId = new Map(
  fixtureThreads.flatMap((thread) =>
    thread.documentIds.map((id) => [id, thread] as const),
  ),
);

export function cannedExtractionResponseFor(
  document: SourceDocument,
): CandidateEventsResponse {
  const thread = threadByDocumentId.get(document.id);
  if (thread) {
    const base = cannedThreadActivityById[thread.id];
    const finalDocumentId = thread.documentIds[thread.documentIds.length - 1];
    return {
      candidates: [
        {
          id: `candidate-${document.id}`,
          documentId: document.id,
          title: document.title,
          description: `Candidate event from ${document.title}.`,
          project: base.project,
          activityType: activityTypeBySource[document.sourceType],
          startTime: document.timestamp,
          lastActiveTime: document.timestamp,
          status: document.id === finalDocumentId ? base.status : "in_progress",
          technologies: [...base.technologies],
          blockers: [],
          nextSteps: [],
          confidence: 0.8,
        },
      ],
    };
  }
  if (noiseDocumentIds.includes(document.id)) {
    return { candidates: [] };
  }
  throw new Error(
    `cannedExtractionResponseFor: no canned response for document \"${document.id}\" — extend the canned fixture data.`,
  );
}

export function cannedExtractionResponsesFor(
  documents: readonly SourceDocument[],
): CandidateEventsResponse[] {
  return documents.map(cannedExtractionResponseFor);
}

export function cannedMergedActivitiesFor(
  candidates: readonly CandidateEvent[],
): MergedActivitiesResponse {
  const candidateDocumentIds = new Set(candidates.map((c) => c.documentId));
  const coveredDocumentIds = new Set<string>();
  const activities: Activity[] = [];

  for (const thread of fixtureThreads) {
    const present = thread.documentIds.filter((id) =>
      candidateDocumentIds.has(id),
    );
    if (present.length === 0) continue;
    for (const id of present) coveredDocumentIds.add(id);
    activities.push({
      ...cannedThreadActivityById[thread.id],
      evidenceIds: present,
    });
  }

  const uncovered = candidates.filter((c) => !coveredDocumentIds.has(c.documentId));
  if (uncovered.length > 0) {
    throw new Error(
      `cannedMergedActivitiesFor: no canned activity covers candidate(s) ${uncovered
        .map((c) => c.id)
        .join(", ")} — extend the canned fixture data.`,
    );
  }

  return { activities };
}

const MergeRequest = z
  .object({ candidates: z.array(CandidateEvent) })
  .strict();

/**
 * Request-inspecting {@link LlmClient} for the deterministic ingest CLI:
 * unlike FakeLlm it needs no pre-queued responses, because it derives each
 * answer from the request payload itself (the embedded document or
 * candidate list). Works on any cache state — a cache hit simply makes no
 * calls at all. Supports only the ingest pipeline's purposes.
 */
export class CannedPipelineLlm implements LlmClient {
  private _history: LlmCall[] = [];

  get history(): ReadonlyArray<LlmCall> {
    return this._history;
  }

  async chatJson<T>(params: {
    messages: ChatMessage[];
    schema: z.ZodType<T>;
    purpose: "extraction" | "merge" | "scoring" | "generation";
    schemaHint?: string;
  }): Promise<T> {
    const userMessage = params.messages.find((m) => m.role === "user");
    if (!userMessage) {
      throw new Error("CannedPipelineLlm: no user message in request.");
    }

    let response: unknown;
    if (params.purpose === "extraction") {
      response = cannedExtractionResponseFor(
        SourceDocument.parse(JSON.parse(userMessage.content)),
      );
    } else if (params.purpose === "merge") {
      const { candidates } = MergeRequest.parse(JSON.parse(userMessage.content));
      response = cannedMergedActivitiesFor(candidates);
    } else {
      throw new Error(
        `CannedPipelineLlm: unsupported purpose \"${params.purpose}\" — the ingest pipeline only performs extraction and merge.`,
      );
    }

    this._history.push({
      messages: params.messages,
      purpose: params.purpose,
      model: `canned:${params.purpose}`,
    });

    const parsed = params.schema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `CannedPipelineLlm: canned response failed caller schema validation: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}
