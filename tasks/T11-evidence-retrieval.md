---
labels: [ready-for-agent]
title: Retrieve evidence from Cognee seeded per selected activity
---

# T11 — Retrieve evidence from Cognee seeded per selected activity

## Goal

For each activity selected by relevance matching (T10), run Cognee search (summaries + chunks) seeded by that activity to retrieve supporting evidence excerpts, and assemble evidence records — source document metadata + excerpt + activity link — such that every evidence id resolves to a real document.

## User-Visible Impact

This is the provenance backbone: after T14, clicking any claim opens the evidence behind it. Every citation in every generated output (T12) resolves because of the guarantees established here — "trust in the output is mechanical, not aspirational" (PRD user story 27).

## PRD Context

PRD "Evidence retrieval & generation": "Cognee is load-bearing at query time: after cognify, Cognee search (summaries + chunks) runs seeded per selected activity to pull evidence excerpts backing each claim." "Provenance card = adapter-provided source metadata + Cognee-retrieved excerpt + link to the activity it supported." User story 24: evidence retrieved from Cognee "seeded per selected activity." User story 27: "citations resolve to real documents (no dangling evidence ids)."

## Implementation Notes

- Input: selected activities (T10 output). For each, build a search seed from the activity (title + key entities/technologies + outcome — enough for Cognee's semantic search to find the thread's documents) and call `CogneeClient.search` with both summaries and chunks query types.
- Evidence record shape (Zod-validated): `id`, `activityId`, `documentId` (the normalized `SourceDocument` id), `sourceType`, `title`, `timestamp`, `participants` (adapter-provided metadata), `excerpt` (Cognee-retrieved text). This is what T12's generation cites and T14's drawer renders.
- Integrity rule: an evidence record may only exist if its `documentId` is in the ingested corpus AND its excerpt came back from Cognee. Evidence ids should be deterministic (e.g., `{activityId}:{documentId}:{chunkIndex}`) so T12's citation-resolution assertion is reliable.
- Cognee results that can't be mapped to a known document id are dropped — never surfaced as unresolvable evidence. (This is the "no dangling ids" guarantee at the retrieval boundary; T12 asserts it again at the generation boundary.)
- Deduplicate: the same document excerpt retrieved for multiple activities stays per-activity (evidence is activity-scoped by design — the drawer links back to the activity it supported).
- Works against `StubCognee` in tests; the real client path is exercised in T08's manual golden-path run.

## Acceptance Criteria

1. Given selected fixture activities and a stubbed Cognee search, evidence retrieval returns validated evidence records — one set per activity, each with document metadata, excerpt, and activity link.
2. Every evidence record's `documentId` resolves to a document in the ingested corpus (tested: zero dangling ids).
3. Search is seeded per activity (assertable via stub call records: one search batch per selected activity, seeds derived from activity content).
4. Cognee results without a resolvable document mapping are dropped, not emitted.
5. An activity whose search returns nothing yields zero evidence for it without failing the whole retrieval.

## Testing Requirements

- Unit/integration tests with `StubCognee`: per-activity seeding, evidence record validation, document-id resolution guarantee, graceful empty-result handling.
- A test that deliberately includes an unmappable stub search result and asserts it's dropped.
- No live Cognee/LLM calls.

## Dependencies

- T07 (`CogneeClient` interface + stub; ingested corpus), T10 (selected activities).

## Out of Scope

- Generation and citation placement (T12).
- UI drawer (T14).
- Re-ranking or merging of retrieved chunks beyond dedup by exact id.
