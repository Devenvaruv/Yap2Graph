import { z } from "zod";
import rawDocuments from "./documents.json";
import {
  SourceDocument,
  type ActivityStatus,
  type TimeRange,
} from "../schemas";

const parsed = z.array(SourceDocument).safeParse(rawDocuments);
if (!parsed.success) {
  throw new Error(
    `Fixture corpus failed SourceDocument validation:\n${parsed.error.message}`,
  );
}

export const fixtureDocuments: SourceDocument[] = parsed.data;

export type FixtureThread = {
  id: string;
  description: string;
  documentIds: string[];
  expectedStatus: ActivityStatus;
};

/**
 * Known cross-source work threads in the fixture corpus. Each thread is one
 * ChatGPT discussion + one coding-agent session + one completion/status
 * email about the same underlying work; the merge pass (T06) must collapse
 * each thread into exactly ONE activity whose evidenceIds are exactly the
 * thread's documentIds.
 */
export const fixtureThreads: FixtureThread[] = [
  {
    id: "thread-payment-webhook",
    description:
      "Stripe webhook retries double-charging customers: ChatGPT root-cause and design, Codex implements the transactional processed_events check, email confirms the fix is live with zero duplicates.",
    documentIds: [
      "chatgpt-webhook-retry",
      "codex-webhook-idempotency",
      "email-webhook-shipped",
    ],
    expectedStatus: "completed",
  },
  {
    id: "thread-feed-caching",
    description:
      "Feed endpoint N+1 latency at 800ms p95: ChatGPT picks Redis over a materialized view, Codex implements the cache layer with write invalidation, email confirms p95 is 90ms in production.",
    documentIds: ["chatgpt-feed-cache", "codex-feed-redis", "email-feed-latency"],
    expectedStatus: "completed",
  },
  {
    id: "thread-ci-migration",
    description:
      "CircleCI to GitHub Actions migration: ChatGPT settles the self-hosted-runner strategy, Codex migrates 12 of 18 jobs, infra-lead email puts the rest on hold pending runner tokens.",
    documentIds: [
      "chatgpt-ci-migration",
      "codex-ci-workflows",
      "email-ci-runner-delay",
    ],
    expectedStatus: "blocked",
  },
];

/**
 * Documents that must produce NO activities: routine admin, trivial
 * rewording, repetitive churn with no outcome, and automated receipts.
 */
export const noiseDocumentIds: string[] = [
  "email-timesheet-reminder",
  "chatgpt-reword-request",
  "codex-logging-tweaks",
  "email-license-renewal",
];

/** The shared 7-day window every fixture timestamp falls inside. */
export const fixtureWindow: TimeRange = {
  start: "2026-09-05T00:00:00Z",
  end: "2026-09-11T23:59:59Z",
};
