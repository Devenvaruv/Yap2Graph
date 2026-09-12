import { z } from "zod";

export const SOURCE_TYPES = ["chatgpt", "email", "coding_agent"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ACTIVITY_STATUSES = [
  "completed",
  "in_progress",
  "blocked",
  "abandoned",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const SCORE_DIMENSIONS = [
  "relevance",
  "impact",
  "novelty",
  "completion",
  "confidence",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

const isoTimestamp = z.string().datetime({ offset: true });
const zeroToOne = z.number().min(0).max(1);

/**
 * Normalized document — the only representation every source adapter (T03)
 * emits and every downstream stage consumes. `metadata` carries
 * source-specific provenance (from/to, conversation id, session id, ...).
 */
export const SourceDocument = z
  .object({
    id: z.string().min(1),
    sourceType: z.enum(SOURCE_TYPES),
    title: z.string().min(1),
    timestamp: isoTimestamp,
    participants: z.array(z.string()),
    content: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type SourceDocument = z.infer<typeof SourceDocument>;

/**
 * Map-pass output (T05): one candidate event extracted from a single
 * document, bounded to that document. `documentId` IS the evidence link —
 * the merge pass (T06) unions documentIds into Activity.evidenceIds, so
 * candidates deliberately carry no evidenceIds of their own. Optional
 * fields (project, status, outcome) reflect what one document can actually
 * support; the merge pass resolves them.
 */
export const CandidateEvent = z
  .object({
    id: z.string().min(1),
    documentId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    project: z.string().min(1).optional(),
    activityType: z.string().min(1),
    startTime: isoTimestamp,
    lastActiveTime: isoTimestamp,
    status: z.enum(ACTIVITY_STATUSES).optional(),
    technologies: z.array(z.string()),
    outcome: z.string().optional(),
    blockers: z.array(z.string()),
    nextSteps: z.array(z.string()),
    confidence: zeroToOne,
  })
  .strict();
export type CandidateEvent = z.infer<typeof CandidateEvent>;

/**
 * Merged, deduplicated work unit (T06 output, activity store record).
 * evidenceIds reference SourceDocument ids and must be non-empty — an
 * activity with zero evidence fails validation. beforeState/afterState are
 * inferred by the merge pass, so they are optional until it fills them.
 */
export const Activity = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    project: z.string().min(1),
    activityType: z.string().min(1),
    startTime: isoTimestamp,
    lastActiveTime: isoTimestamp,
    status: z.enum(ACTIVITY_STATUSES),
    technologies: z.array(z.string()),
    outcome: z.string().optional(),
    blockers: z.array(z.string()),
    nextSteps: z.array(z.string()),
    beforeState: z.string().optional(),
    afterState: z.string().optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidence: zeroToOne,
  })
  .strict();
export type Activity = z.infer<typeof Activity>;

/**
 * Weight per scoring dimension (T09 defines them per profile, T10 applies
 * them). Weights are 0–1 emphasis values, NOT required to sum to 1 — the
 * relevance matcher normalizes when computing the weighted total.
 */
export const ScoreWeights = z
  .object({
    relevance: zeroToOne,
    impact: zeroToOne,
    novelty: zeroToOne,
    completion: zeroToOne,
    confidence: zeroToOne,
  })
  .strict();
export type ScoreWeights = z.infer<typeof ScoreWeights>;

/**
 * Hardcoded intent profile (T09). `sections` are output section titles the
 * generator (T12) must fill; include/exclude criteria double as embedding
 * pre-filter text (T10); `outputConstraints` is a free-form string passed
 * into the generation prompt (tone, length, framing).
 */
export const ReferenceProfile = z
  .object({
    key: z.string().min(1),
    audience: z.string().min(1),
    sections: z.array(z.string().min(1)).min(1),
    includeCriteria: z.array(z.string().min(1)).min(1),
    excludeCriteria: z.array(z.string().min(1)),
    scoreWeights: ScoreWeights,
    threshold: zeroToOne,
    outputConstraints: z.string().min(1),
  })
  .strict();
export type ReferenceProfile = z.infer<typeof ReferenceProfile>;

export const TimeRange = z
  .object({
    start: isoTimestamp,
    end: isoTimestamp,
  })
  .strict();
export type TimeRange = z.infer<typeof TimeRange>;

/**
 * One claim inside a generated output. evidenceIds may be empty for trivial
 * connective text — the require-citation policy is enforced by T12's
 * integrity gate in code, not by this schema.
 */
export const Claim = z
  .object({
    markdown: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type Claim = z.infer<typeof Claim>;

export const OutputSection = z
  .object({
    title: z.string().min(1),
    claims: z.array(Claim),
  })
  .strict();
export type OutputSection = z.infer<typeof OutputSection>;

/**
 * Generation result (T12). Structured JSON only — free-form text is never
 * accepted because it cannot carry provenance.
 */
export const GeneratedOutput = z
  .object({
    profileKey: z.string().min(1),
    timeRange: TimeRange,
    sections: z.array(OutputSection).min(1),
  })
  .strict();
export type GeneratedOutput = z.infer<typeof GeneratedOutput>;
