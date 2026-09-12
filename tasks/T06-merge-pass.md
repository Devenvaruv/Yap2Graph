---
labels: [ready-for-agent]
title: Implement the merge pass - deduplicated activities with evidence and before/after state
---

# T06 — Implement the merge pass: deduplicated activities with evidence and before/after state

## Goal

Implement pass 2 of extraction: the LLM merges candidate events across sources into a small set of deduplicated `Activity` records — each with carried-forward evidence ids, inferred before/after state, and full structured fields — persisted to an inspectable JSON activity store.

## User-Visible Impact

After this task (with T07), the user's scattered mentions of the same work collapse into one clean activity. This is the layer the UI's "Activities used" pane (T14) and activity browser (T18) display, and it makes the activity layer debuggable: activities are a diffable JSON file (PRD user stories 10–13).

## PRD Context

PRD "Activity extraction": "Pass 2 (merge): LLM merges candidates across sources into deduplicated activities, carrying evidence ids forward and inferring before/after state." User story 10: "discussed it in ChatGPT + changed the code + emailed 'done'" becomes one activity, not three. User story 11: activities carry title, description, project, activity type, start/last-active times, status, technologies/entities, outcome, blockers, next steps, evidence references, confidence. User story 12: before/after state "so that outputs express what *changed*, not just what was mentioned." User story 13: persisted as "a simple inspectable artifact (JSON)... without a database."

PRD "Testing Decisions" seam 1: "one merged activity per thread, evidence ids preserved through the merge, before/after state captured, noise documents produce no activities."

## Implementation Notes

- Input: `CandidateEvent[]` (from T05 or canned). Output: validated `Activity[]` written to a JSON file (expected scale per PRD: ~20–40 activities for a week).
- Merge logic runs via the small model on `LlmClient` with schema-validated JSON. Cross-source resolution is entirely here: candidates referring to the same underlying work (same project/topic, complementary types: discussion + code change + completion) collapse into one activity.
- Evidence integrity rule: an activity's `evidenceIds` may only contain document ids of the candidates merged into it. Assert this in code after the LLM responds — the LLM must not invent or drop evidence ids silently (PRD story 27: no dangling evidence ids; here, no invented ones either). Repair strategy: drop unknown ids and fail loudly if an activity ends up with zero evidence.
- Before/after inference: combine the "discussed/problem" state from early candidates with the "changed/shipped" state from later ones; `beforeState`/`afterState` are filled here (PRD schema comment: "change detection, filled by merge pass").
- `startTime`/`lastActiveTime` derive from the merged candidates' timestamps; `confidence` reflects evidence strength (e.g., single weak mention vs. three corroborating sources).
- The store is a plain JSON file (suggested `data/activities.json`), written atomically, and the module exposes load/save helpers that T07+ reuse.

## Acceptance Criteria

1. Given candidates from the T02 fixture threads, the merge produces exactly ONE activity per known cross-source thread (e.g., ChatGPT discussion + code change + completion email → one activity).
2. Each merged activity's `evidenceIds` includes all thread documents' ids and no ids that don't exist in the candidate set.
3. `beforeState`/`afterState` are populated with what changed, not just what was mentioned.
4. Candidates from noise documents produce no activities (they are dropped in the merge).
5. Activities validate against the `Activity` schema and persist to an inspectable JSON file via the store helpers.
6. An LLM response referencing unknown evidence ids is caught (repaired or errored), never silently accepted.

## Testing Requirements

- Pipeline-seam test (PRD seam 1, merge half): canned candidates in → merged activities out, asserting items 1–4 above. This is the precedent-setting test for the whole pipeline seam.
- Store helper test: save then load round-trips the activity list.
- No prompt- wording or call-order assertions; no live API calls.

## Dependencies

- T05 (map pass + `CandidateEvent` schema from T02).

## Out of Scope

- Ingestion orchestration and caching (T07).
- Cognee upload of source documents (T07/T08).
- Any query-time logic (relevance/generation).
