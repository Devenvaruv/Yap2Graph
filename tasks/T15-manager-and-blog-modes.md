---
labels: [ready-for-agent]
title: Deliver manager-update and technical-blog modes from the same memory
---

# T15 — Deliver manager-update and technical-blog modes from the same memory

## Goal

Turn on the manager update and technical blog output modes end-to-end: same pre-ingested memory, different profiles, clearly different outputs in both selection and structure. This is the core demo differentiator made visible — intent-awareness, not formatting.

## User-Visible Impact

The user picks "Update my manager" or "Write a technical blog" on the same 7 days and gets visibly different outputs: the manager update leads with deliverables, impact, and decisions; the blog surfaces interesting problems, failures, and lessons learned while ignoring the routine admin the standup also skipped (PRD user story 29).

## PRD Context

PRD core demo: "the exact same 7 days of memory generates a standup, a manager update, and a technical blog that are clearly different — because the relevance criteria are different, not just the formatting." User story 16 (manager: progress, deliverables, impact, decisions, blockers, dependencies, next steps), user story 17 (blog: interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, meaningful before/after; ignoring routine work and repetitive debugging with no outcome), user story 29. Demo script: "same 7 days → standup → manager update → blog → click the same claim across outputs to show different evidence weighting."

## Implementation Notes

- The pipeline is already profile-agnostic (T13 criterion 6); this task is mostly verification plus whatever small gaps surface: profile prompt-fit (blog needs before/after state and failure narratives emphasized; manager needs impact framing), score-weight tuning, and section rendering variety.
- Verify with the fixture corpus that the three profiles produce *different selected activity sets and/or different ordering*, not just different section headings. If standup/manager/blog select identically on the fixtures, tune the profile criteria/weights (T09 constants) — the fixtures were built with threads that should diverge (e.g., an interesting-but-unshipped experiment: blog-yes, manager-maybe; routine completed admin-adjacent task: standup-yes, blog-no).
- The "click the same claim across outputs" demo moment needs claims backed by the same evidence to appear in multiple outputs with different framing — check the fixtures support this (a thread cited by both standup and blog) and adjust fixtures if not (fixture changes are allowed here; keep T06's pipeline test green).
- Ensure the UI mode switch is smooth: no page reload needed between generating different intents on the same range.

## Acceptance Criteria

1. Manager update generates end-to-end from the same fixture store with sections covering progress/deliverables, impact, decisions, blockers & dependencies, next steps.
2. Technical blog generates end-to-end with problem/attempt/outcome/lessons structure, including before/after framing where the activities support it.
3. On the same 7-day range, standup / manager / blog outputs differ in selected activities or their ordering — not merely in section headings (asserted by test).
4. The noise fixtures (routine admin, trivial rewording, outcome-less debugging) are excluded from the blog output (tested).
5. An activity that is blog-worthy but low-manager-relevance (or vice versa) demonstrably diverges between the two outputs on the fixture corpus.
6. Switching intent in the UI and regenerating works without reload; each generation completes in demo-friendly time.

## Testing Requirements

- Route-level tests (fakes injected) for both new modes: valid `GeneratedOutput`, correct sections, citation integrity (reusing T12's guarantees).
- The three-way divergence test: same store, three profiles → selections/orderings differ (extends T10's two-way invariant to the full pipeline).
- Blog-excludes-noise test at the route level.
- No live API calls in automated tests.

## Dependencies

- T13 (query path + standup slice), T14 (rendering; can proceed in parallel — this task needs only T13).

## Out of Scope

- LinkedIn, accomplishments, EOD/EOW modes (T16).
- Prompt-perfection for prose quality; the PRD's bar is clearly-differentiated, evidence-backed structure.
