---
labels: [ready-for-agent]
title: Implement the map pass - extract candidate events per source document
---

# T05 — Implement the map pass: candidate events per source document

## Goal

Implement pass 1 of the two-pass extraction: for each normalized `SourceDocument`, the small LLM extracts candidate events — bounded to that single document, with no cross-source resolution — each linked to its source document as evidence.

## User-Visible Impact

No direct UI impact. This is the first LLM stage of ingestion (T07): it guarantees "nothing meaningful is missed" (PRD user story 9) before the merge pass deduplicates. After T07 it runs on the user's imported data.

## PRD Context

PRD "Activity extraction (ingest time)": "Pass 1 (map): LLM extracts candidate events per source document, bounded by that document. Pass 2 (merge): LLM merges candidates across sources... Cross-source activity resolution lives entirely in the merge pass." PRD user story 9: candidates extracted per source document "so that nothing meaningful is missed." Extraction runs at ingest time and is cached (user story 7).

## Implementation Notes

- Input: `SourceDocument[]`. Output: `CandidateEvent[]` using the schema from T02, each carrying the source `documentId` so evidence linking survives into the merge pass.
- Use the small model via `LlmClient` (T04) with schema-validated JSON output. Design the prompt around: what happened, project, activity type, status/outcome as stated *in this document*, participants, and timestamps mentioned. Explicitly instruct: extract only what this document supports; do not invent cross-document context.
- A document may yield zero candidates (routine admin chatter) or several (a long conversation covering multiple topics).
- Keep per-document extraction independent and parallelizable — that's what makes it "map."
- Caching of extraction results is orchestrated in T07; this task exposes a pure function/service that the orchestrator (and tests) call.

## Acceptance Criteria

1. Given the T02 fixture documents and a `FakeLlm` with canned responses, the map pass returns validated `CandidateEvent[]` with correct source `documentId` links.
2. A noise document whose canned response is "no events" yields zero candidates without error.
3. A document with multiple distinct topics can yield multiple candidates.
4. Candidates never reference documents other than their own source (bounded extraction — asserted by test).
5. Invalid LLM output fails validation loudly rather than producing half-parsed candidates.

## Testing Requirements

- Unit tests with `FakeLlm` canned responses: expected candidates out per fixture document; noise → none; bounded-to-source assertion.
- Test observable outputs (candidates) only — never prompt wording or call ordering (PRD testing philosophy).
- No live API calls.

## Dependencies

- T02 (schemas, fixtures), T04 (LLM seam + fakes).

## Out of Scope

- Cross-source merging/deduplication (T06).
- Before/after state inference across documents (merge pass responsibility).
- Caching/orchestration (T07).
