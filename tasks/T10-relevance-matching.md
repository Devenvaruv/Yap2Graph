---
labels: [ready-for-agent]
title: Implement hybrid relevance matching with surfaced per-activity scores
---

# T10 — Implement hybrid relevance matching with surfaced per-activity scores

## Goal

Implement the query-time relevance pipeline: embedding similarity between profile criteria and activity text pre-filters to a top-K shortlist, then one LLM call scores the shortlist on five dimensions (relevance, impact, novelty, completion, confidence, each 0–1), drops activities below the profile threshold, and returns per-activity scores for UI display.

## User-Visible Impact

This is the "what matters for this intent" decision engine. Its output (selected activities + scores) powers the "Activities used" pane with per-activity scores (PRD user story 23), so the user can see exactly why an activity was included or dropped. It's also the mechanism behind the core demo: standup and blog select different activities from the same week.

## PRD Context

PRD "Relevance matching (query time)": "Hybrid, deliberately simple. Embedding similarity between profile criteria and activity text pre-filters to a top-K shortlist; one LLM call then scores the shortlist on five dimensions (relevance, impact, novelty, completion, confidence, each 0–1) and drops activities below the profile threshold. Scores are surfaced in the UI." User story 22: selection is "explainable rather than magical." PRD "Testing Decisions" seam 2: "standup and blog profiles select and order *different* activities from the same corpus (the core demo invariant, tested); ... below-threshold activities are excluded."

## Implementation Notes

- Input: activity store + `ReferenceProfile` (+ time range filtering happens in T13's query path, not here — keep this stage range-agnostic). Output: selected activities with all five dimension scores, the weighted total, the threshold used, plus dropped activities with their scores (the UI's "why was this dropped" story).
- Pre-filter: embed profile criteria text (include + exclude criteria) and each activity's text (title + description + outcome is a good core; technologies help), cosine similarity via `EmbeddingClient`, take top-K. K should be a small constant (e.g., 10–15) — larger than the expected selected set, small enough to keep the judge call cheap.
- Judge: ONE `LlmClient` call (small model) scoring the whole shortlist with schema-validated JSON. Apply the profile's `scoreWeights` to compute the weighted score in code — never trust the LLM to do the arithmetic or the thresholding.
- Dimension definitions matter for the demo invariant: relevance = fits this profile's criteria; impact = mattered to project/outcome; novelty = new/interesting vs. routine; completion = how finished; confidence = how well-evidenced. Encode these in the scoring prompt.
- Deterministic ordering: sort selected activities by weighted score descending; ties broken stably (e.g., by `lastActiveTime`) so outputs and tests are stable.

## Acceptance Criteria

1. Given a fixture activity store, a profile, and canned embeddings + canned LLM scores, matching returns selected activities with all five dimension scores, weighted totals, and the threshold.
2. Standup and blog profiles, run against the same fixture store, select and order DIFFERENT activities — the core demo invariant, tested.
3. Activities scoring below the profile threshold are excluded but returned with their scores (dropped list).
4. The shortlist passed to the LLM judge respects the top-K embedding pre-filter (assertable via the fake embedding call records).
5. Weighted totals and thresholding are computed in code from the five dimensions and profile weights (LLM never does arithmetic).

## Testing Requirements

- Query-seam tests (PRD seam 2) with `FakeEmbeddings` + `FakeLlm`: the standup-vs-blog divergence invariant; below-threshold exclusion; dropped-activities-with-scores; code-computed weighting.
- Also a test that the noise/admin activity from the fixtures scores low or is excluded for standup and blog alike.
- No prompt-wording assertions, no live API calls.

## Dependencies

- T06 (activity store with fixture-generated activities), T09 (profiles).

## Out of Scope

- Sophisticated ML ranking beyond the hybrid scheme (PRD out of scope).
- Evidence retrieval (T11) and generation (T12).
- Time-range filtering (T13).
- UI rendering of scores (T14) — but return the data shaped so scores are displayable.
