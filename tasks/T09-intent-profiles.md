---
labels: [ready-for-agent]
title: Define the six intent reference profiles as validated constants
---

# T09 — Define the six intent reference profiles as validated constants

## Goal

Define the six hardcoded reference profiles — standup, manager update, end-of-day/end-of-week update (one shared profile), technical blog, LinkedIn post, accomplishments — as Zod-validated constants, each specifying audience, sections, include/exclude criteria, scoring weights, threshold, and output constraints.

## User-Visible Impact

The intent picker from T01 now maps to real intent definitions. This is what makes the same week of memory produce genuinely different outputs — the core demo differentiator (PRD user story 29) — once T13 renders outputs.

## PRD Context

PRD "Reference / intent model": "Hardcoded profiles as Zod-validated constants, six total: standup, manager update, end-of-day/end-of-week update (shared profile, time-range knob), technical blog, LinkedIn post, accomplishments." "Each profile owns: audience, output sections, include criteria (e.g. blog: interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, meaningful before/after), exclude criteria (e.g. blog: routine admin, trivial wording changes, repetitive debugging without outcome), scoring weights, threshold, output constraints." Dynamic profiles are out of scope for v1; new use cases are added by adding a profile only (user story 31).

Profile-specific requirements from user stories: standup (15) — completed work, in-progress work, blockers, next actions; NOT routine admin or trivial rewording. Manager update (16) — progress, deliverables, impact, decisions, blockers, dependencies, next steps. Blog (17) — interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, meaningful before/after changes; ignore routine work and repetitive debugging with no outcome. LinkedIn (18) — accomplishment-oriented narrative with impact framing. Accomplishments (19) — plain summary of completed, meaningful work. EOD/EOW (20) — same profile with different time ranges.

## Implementation Notes

- One profiles module exporting a validated `ReferenceProfile` per intent, keyed by `key` (matching the T01 picker constants — import from the shared constant module so picker and profiles cannot drift).
- `scoreWeights` must cover the five relevance dimensions (relevance, impact, novelty, completion, confidence) that T10's LLM judge scores; `threshold` is the 0–1 cutoff. Pick sensible defaults per profile (e.g., blog weights novelty high; standup weights completion and blockers-relevance high; manager weights impact and completion high; LinkedIn weights impact highest) — these are the intent-awareness dial, so make the differences between profiles deliberate and documented in the constants.
- `sections` define the output structure T12's generation fills (e.g., standup: Completed / In progress / Blockers / Next steps; manager: Progress & deliverables / Impact / Decisions / Blockers & dependencies / Next steps; blog: Problem / What we tried / What happened / Lessons learned).
- `includeCriteria`/`excludeCriteria` double as embedding pre-filter text in T10 — write them as concrete descriptive phrases (not single words) so similarity matching has substance.
- The EOD/EOW profile is ONE profile; "time-range knob" means the query path (T13) passes the range, the profile doesn't fork.

## Acceptance Criteria

1. Six profiles exist as constants, each validating against the `ReferenceProfile` schema.
2. Each profile specifies all PRD-required fields: audience, sections, includeCriteria, excludeCriteria, scoreWeights (all five dimensions), threshold, outputConstraints.
3. The blog profile's include criteria cover: interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, meaningful before/after; its exclude criteria cover: routine admin, trivial wording changes, repetitive debugging without outcome.
4. The standup profile excludes routine admin and trivial rewording; manager profile sections cover progress, deliverables, impact, decisions, blockers, dependencies, next steps.
5. EOD and EOW share a single profile (no duplicate profile with a baked-in range).
6. Profile keys match the intent picker options exactly (shared constant source).

## Testing Requirements

- Unit tests: all six profiles validate against the schema; keys are unique and match the picker constants; scoreWeights cover exactly the five dimensions; sections are non-empty.
- Data-level tests only — criteria phrasing itself is content, not behavior, so don't over-assert wording.

## Dependencies

- T02 (`ReferenceProfile` schema, shared constants from T01 if already extracted — otherwise extract them here and have T01's picker import from this module).

## Out of Scope

- Dynamic/arbitrary intent profile generation (PRD: v2).
- Relevance matching logic (T10), generation (T12), UI wiring (T13).
