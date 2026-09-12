import { z } from "zod";
import { IntentKeySchema, type IntentKey } from "./reference";
import { ReferenceProfile } from "./schemas";

/**
 * The six hardcoded reference profiles (T09). Parsed against the
 * ReferenceProfile schema at module load, so a malformed profile fails loudly
 * at import time rather than at query time.
 *
 * Weights are deliberate per-profile intent dials (T10 normalizes them):
 * standup and end-of-period weight completion + relevance, manager and
 * LinkedIn weight impact, blog weights novelty, accomplishments weights
 * completion above all.
 *
 * End-of-day and end-of-week share ONE profile; the time-range knob is the
 * TimeRange the query path (T13) passes in — this module never forks on it.
 *
 * `includeCriteria`/`excludeCriteria` double as embedding pre-filter text
 * for T10, so they are written as concrete descriptive phrases.
 */
type ProfileDefinition = Omit<ReferenceProfile, "key"> & { key: IntentKey };

const definitions: readonly ProfileDefinition[] = [
  {
    key: "standup",
    audience: "Teammates at a daily standup",
    sections: ["Completed", "In progress", "Blockers", "Next steps"],
    includeCriteria: [
      "work completed with a concrete, verifiable outcome",
      "work actively in progress and where it stands",
      "blockers and dependencies, naming the specific thing that is stuck",
      "concrete next actions planned for the coming day",
    ],
    excludeCriteria: [
      "routine admin like timesheet reminders, expense filings, and calendar logistics",
      "trivial rewording or formatting-only changes with no functional impact",
      "automated notifications and receipts with no work content",
    ],
    // Standup is a movement report: what finished and what is stuck dominates.
    scoreWeights: {
      relevance: 0.9,
      impact: 0.5,
      novelty: 0.2,
      completion: 0.9,
      confidence: 0.7,
    },
    threshold: 0.5,
    outputConstraints:
      "First-person standup bullets, one line per item, lead with the outcome, no preamble or summary.",
  },
  {
    key: "manager-update",
    audience: "Your direct manager",
    sections: [
      "Progress & deliverables",
      "Impact",
      "Decisions",
      "Blockers & dependencies",
      "Next steps",
    ],
    includeCriteria: [
      "shipped deliverables and tangible progress against stated goals",
      "business or user impact of completed work, with numbers when available",
      "technical or product decisions made, and the rationale behind them",
      "blockers and cross-team dependencies that need visibility or escalation",
      "planned next steps with rough timing and owners",
    ],
    excludeCriteria: [
      "exploratory spikes with no conclusion or outcome yet",
      "routine maintenance and chores with no stakeholder-visible result",
      "trivial wording or formatting-only changes",
    ],
    // Managers weight impact and completion: what moved the goal and what
    // demonstrably got done; novelty is irrelevant to a status report.
    scoreWeights: {
      relevance: 0.8,
      impact: 0.9,
      novelty: 0.2,
      completion: 0.8,
      confidence: 0.7,
    },
    threshold: 0.55,
    outputConstraints:
      "Concise manager-facing prose grouped by the profile sections; state impact concretely, flag blockers with the ask, no fluff.",
  },
  {
    key: "technical-blog",
    audience: "Engineers reading a technical blog post",
    sections: ["Problem", "What we tried", "What happened", "Lessons learned"],
    includeCriteria: [
      "interesting technical problems that took real investigation to understand",
      "experiments and spikes that produced a clear result, positive or negative",
      "architecture or design decisions with genuine tradeoffs worth explaining",
      "unexpected failures, outages, or bugs whose root cause was surprising",
      "lessons learned that generalize beyond the specific project",
      "meaningful before/after changes with observable or measurable results",
    ],
    excludeCriteria: [
      "routine admin such as timesheets, invoices, license renewals, and scheduling",
      "trivial wording or copy changes with no behavioral impact",
      "repetitive debugging sessions that ended without a root cause or fix",
    ],
    // Blog is the novelty-driven profile: a familiar problem retold is not a
    // post, so novelty outweighs completion — failed experiments still count.
    scoreWeights: {
      relevance: 0.7,
      impact: 0.6,
      novelty: 0.9,
      completion: 0.5,
      confidence: 0.5,
    },
    threshold: 0.6,
    outputConstraints:
      "Narrative technical post in markdown: hook, concrete problem, what was tried, honest results, transferable lessons. No hype, no engagement bait.",
  },
  {
    key: "linkedin-post",
    audience: "Your professional network on LinkedIn",
    sections: ["Hook", "What I built", "Impact", "Closing takeaway"],
    includeCriteria: [
      "completed accomplishments with a clear, quantifiable impact",
      "work that maps to a compelling professional narrative",
      "before/after improvements that can be stated in one sentence",
    ],
    excludeCriteria: [
      "unfinished, blocked, or abandoned work",
      "internal-only process details invisible outside the team",
      "routine maintenance with no user-facing result",
    ],
    // LinkedIn leads with impact above everything; only finished, defensible
    // work survives a public audience, so completion stays high.
    scoreWeights: {
      relevance: 0.6,
      impact: 0.9,
      novelty: 0.6,
      completion: 0.8,
      confidence: 0.6,
    },
    threshold: 0.65,
    outputConstraints:
      "First-person professional narrative, 150-300 words, one clear accomplishment, impact framed concretely, no hashtags.",
  },
  {
    key: "accomplishments",
    audience: "Your future self, reviewing what got done",
    sections: ["Completed work"],
    includeCriteria: [
      "work marked completed with a stated outcome",
      "meaningful milestones, even small ones, that represent real progress",
      "problems solved and bugs fixed with verified results",
    ],
    excludeCriteria: [
      "work still in progress or blocked",
      "routine admin with no accomplishment attached",
      "experiments abandoned without a result",
    ],
    // Accomplishments is the completion-first profile: the plain record of
    // what got done, judged on finish, not on how interesting the journey was.
    scoreWeights: {
      relevance: 0.6,
      impact: 0.7,
      novelty: 0.3,
      completion: 0.9,
      confidence: 0.7,
    },
    threshold: 0.6,
    outputConstraints:
      "Plain, factual, first-person list of what got done. No embellishment and no audience framing.",
  },
  {
    key: "end-of-period-update",
    audience: "Yourself and your immediate team, wrapping up the period",
    sections: ["Completed", "In progress", "Carryover"],
    includeCriteria: [
      "everything finished in the selected period, however small",
      "work in progress with its current state",
      "items carrying over to the next period and why",
    ],
    excludeCriteria: [
      "routine automated notifications and receipts with no work content",
      "trivial edits with no real change",
    ],
    // A personal wrap-up is inclusive like a standup (relevance + completion)
    // but lower-stakes, so the threshold is the lowest of the six profiles.
    scoreWeights: {
      relevance: 0.8,
      impact: 0.5,
      novelty: 0.2,
      completion: 0.8,
      confidence: 0.6,
    },
    threshold: 0.45,
    outputConstraints:
      "Compact personal wrap-up in markdown bullets grouped by the profile sections; the time range comes from the query and is never restated.",
  },
];

export const REFERENCE_PROFILES: readonly ReferenceProfile[] = z
  .array(ReferenceProfile)
  .parse(definitions);

export const REFERENCE_PROFILE_KEYS: readonly IntentKey[] = IntentKeySchema.options;

const profilesByKey = new Map(
  REFERENCE_PROFILES.map((profile) => [profile.key, profile]),
);

export function getReferenceProfile(key: IntentKey): ReferenceProfile {
  const profile = profilesByKey.get(key);
  if (!profile) {
    throw new Error(`No reference profile defined for intent "${key}"`);
  }
  return profile;
}
