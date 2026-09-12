---
labels: [ready-for-agent]
title: Define core Zod schemas and the sample fixture corpus
---

# T02 — Define core Zod schemas and the sample fixture corpus

## Goal

Define the four core Zod schemas from the PRD (plus the map-pass candidate schema), and build a small sample fixture corpus of normalized documents containing known cross-source work threads and noise, so every later task (adapters, extraction, relevance, generation, tests) has stable data contracts to build against.

## User-Visible Impact

No direct UI impact. This unblocks the adapter contract (T03), the LLM seams (T04), and every pipeline test — the fixtures become the stand-in for the user's real exports until those land.

## PRD Context

PRD "Normalized document & core schemas" defines the type shapes exactly:

```ts
SourceDocument {
  id, sourceType: "chatgpt" | "email" | "coding_agent",
  title, timestamp, participants[], content, metadata
}

Activity {
  id, title, description, project, activityType,
  startTime, lastActiveTime, status,
  technologies[], outcome, blockers[], nextSteps[],
  beforeState, afterState,      // change detection, filled by merge pass
  evidenceIds[], confidence
}

ReferenceProfile {
  key, audience, sections[],
  includeCriteria[], excludeCriteria[],
  scoreWeights, threshold, outputConstraints
}

GeneratedOutput {
  profileKey, timeRange,
  sections: [{ title, claims: [{ markdown, evidenceIds[] }] }]
}
```

PRD "Testing Decisions" seam 1 requires "a small fixture corpus with known cross-source threads (one thread = ChatGPT discussion + code change + completion email)" and asserts "noise documents produce no activities". PRD "Schemas validated with Zod at every boundary."

## Implementation Notes

- Add a `CandidateEvent` schema for the map pass (T05 output): the PRD's two-pass design extracts "candidate events per source document" which the merge pass consumes. Shape is your call — keep it a bounded subset of `Activity` plus the source `documentId` so evidence linking works. Record the final shape here in this file's comments or a schema README so downstream tasks don't guess.
- Fixtures live as JSON under a fixtures directory (suggested: `src/lib/fixtures/` or `tests/fixtures/`). Keep them small: 2–3 distinct cross-source threads (each thread = one ChatGPT conversation + one coding-agent transcript + one completion email about the same work) plus 3–4 noise documents (routine admin email, trivial rewording chat, repetitive debugging with no outcome) that the PRD's blog/standup profiles must exclude.
- Make threads unambiguous for testing: distinct projects/topics, overlapping timestamps within a 7-day window (so "last 7 days" selects them all), and content that clearly states before/after state (e.g., discussed problem → code changed → "shipped it" email).
- Export both schemas and inferred TypeScript types from one module so adapters, pipeline, and UI import a single source of truth.

## Acceptance Criteria

1. Zod schemas exist for `SourceDocument`, `CandidateEvent`, `Activity`, `ReferenceProfile`, `GeneratedOutput`, exported with inferred TS types.
2. The fixture corpus contains at least 2 cross-source threads (chatgpt + coding_agent + email documents each) and at least 3 noise documents, all within a shared 7-day window.
3. Every fixture document parses successfully against `SourceDocument`.
4. Schemas reject malformed input (e.g., unknown `sourceType`, missing `evidenceIds`) — demonstrated by test.
5. Thread membership is documented (which fixture documents belong to which thread) so T06's merge test can assert against it.

## Testing Requirements

- Unit tests: each fixture validates against its schema; at least one negative case per schema rejects invalid data.
- No tests of private helpers — schema-level contract tests only.

## Dependencies

None.

## Out of Scope

- Adapter implementations (T03) — fixtures are already-normalized documents.
- Real user export parsing (user-owned per PRD division of labor).
- Activity store persistence format decisions beyond the schema (T06/T07).
