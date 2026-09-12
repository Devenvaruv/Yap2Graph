---
labels: [ready-for-agent]
title: Complete LinkedIn, accomplishments, and end-of-day/week output modes
---

# T16 — Complete LinkedIn, accomplishments, and end-of-day/week output modes

## Goal

Bring the remaining three output modes live so all six intents in the picker work end-to-end: LinkedIn post (accomplishment narrative with impact framing), accomplishments ("What did I accomplish?" plain summary of completed meaningful work), and end-of-day/end-of-week updates (the shared EOD/EOW profile driven by the time-range knob).

## User-Visible Impact

Every option in the intent picker produces a real output. The user can run "What did I accomplish?" for a plain summary, an accomplishment-framed LinkedIn draft, and a same-day EOD update vs. a full-week EOW update from one profile (PRD user stories 18–20).

## PRD Context

User story 18: LinkedIn post = "accomplishment-oriented narrative with impact framing." User story 19: accomplishments = "a plain summary of completed, meaningful work." User story 20: "end-of-day and end-of-week updates to use the same profile with different time ranges, so that one profile serves both." PRD "Reference / intent model": EOD/EOW is one shared profile with a time-range knob.

## Implementation Notes

- EOD/EOW: one profile key in the picker maps to the query path's range parameter — "today" range ⇒ end-of-day update, "last 7 days" ⇒ end-of-week update. The T01 picker's six options map to profile keys + range defaults; decide how EOD/EOW presents (single "End of day/week update" intent where the range does the work, with the picker defaulting sensibly). No new pipeline code — this validates the time-range knob design.
- LinkedIn: output constraints in the profile should drive tone/length (first-person, impact-led, hook opening); verify generation honors `outputConstraints` — if constraints are being ignored, strengthen how they're passed to the generator prompt rather than special-casing LinkedIn in code.
- Accomplishments: completion score weight highest; excludes in-progress and trivial work. Plain = no narrative flourish; sections like "Completed" / "Impact".
- If a mode's quality depends on profile tweaks (weights, criteria, constraints), adjust the T09 constants — the design intent is that new output modes never require pipeline changes (user story 31). Any pipeline change needed here is a smell to flag.

## Acceptance Criteria

1. LinkedIn post generates end-to-end from the fixture store with accomplishment-oriented, impact-framed claims — all cited.
2. Accomplishments mode generates a plain summary limited to completed, meaningful work (in-progress and trivial fixtures excluded — tested).
3. End-of-day update (today range) and end-of-week update (7-day range) both generate from the same single profile, producing appropriately-scoped outputs (EOD excludes older threads — tested).
4. All six picker intents produce a valid `GeneratedOutput` through the same route and pipeline with zero profile-specific code branches.
5. Citation integrity holds for all three new modes (every evidence id resolves — existing guarantees, verified per mode).

## Testing Requirements

- Route-level tests per mode (fakes injected): valid output, expected section structure, citation integrity.
- Accomplishments exclusion test (in-progress/trivial fixtures absent).
- EOD-vs-EOW scoping test: same profile, two ranges, different activity sets.
- No live API calls.

## Dependencies

- T15 (manager + blog modes prove multi-profile operation).

## Out of Scope

- Dynamic profile generation from arbitrary requests (PRD v2).
- Cross-posting, publishing, or scheduling to LinkedIn.
- Further prose-quality tuning beyond meeting the profile requirements.
