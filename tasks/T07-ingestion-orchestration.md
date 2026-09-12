---
labels: [ready-for-agent]
title: Orchestrate the cached ingestion pipeline end-to-end with a stubbed Cognee
---

# T07 — Orchestrate the cached ingestion pipeline end-to-end with a stubbed Cognee

## Goal

Build the ingestion orchestrator: raw export fixtures → adapters → map pass → merge pass → `activities.json`, with a stubbed Cognee seam (add/cognify called but faked), plus ingestion caching so a second run is a no-op. Provide a single command (e.g. `npm run ingest`) that runs the whole thing deterministically with fakes.

## User-Visible Impact

No direct UI impact yet (T13 renders the results). This is the "ingestion runs once and is cached" guarantee (PRD user story 7) that makes the live demo never wait on ingestion, and it's the first time the whole vertical pipeline runs end-to-end in one command.

## PRD Context

PRD user story 7: "ingestion to run once and be cached, so that query time is fast and the live demo never waits on ingestion." PRD "Activity extraction": "Extraction runs at ingest time and is cached. Query time does only: profile selection → relevance → evidence retrieval → one generation call." PRD "End-to-end" testing decision: "one script runs the vertical slice end-to-end against stubbed Cognee + stubbed LLM." PRD user story 6: raw corpus stored in Cognee with the graph built (cognify) — the real integration is T08; here the seam is stubbed.

## Implementation Notes

- Define a `CogneeClient` interface now (add documents / cognify / search) with a `StubCognee` implementation (in-memory, records calls, `search` returns canned excerpts). T08 swaps in the real REST implementation behind the same interface; T11's evidence retrieval tests reuse the stub.
- Orchestrator flow: locate raw fixtures → run each adapter (T03) → map pass (T05) → merge pass (T06) → save `activities.json` (T06 store) → push raw documents to Cognee `add` → trigger `cognify`. Order between store-save and Cognee calls is yours to choose; make failure of one stage leave inspectable partial state rather than corrupting the store.
- Caching: skip already-ingested inputs (hash of normalized documents or raw inputs is a simple cache key persisted next to the store). Cache invalidation beyond "delete the cache file and re-run" is out of scope.
- The e2e script (`npm run e2e` or similar) wires StubCognee + FakeLlm + fixture exports and asserts the final observable state: expected activities in the store, Cognee `add`/`cognify` each called once, second run performs no LLM/Cognee work. This script is the deterministic harness T17 extends for demo readiness.
- Keep the orchestrator as plain TS (importable by the script and by a future API route) — no Next.js-specific coupling.

## Acceptance Criteria

1. One command ingests the fixture exports end-to-end: adapters → map → merge → `activities.json`, with StubCognee `add` and `cognify` each called exactly once with the normalized documents.
2. The resulting `activities.json` matches the pipeline-seam expectations from T06 (one activity per thread, evidence preserved, noise dropped).
3. Running ingestion a second time with unchanged inputs performs zero LLM calls and zero Cognee calls (cache hit), verified by the fakes' call records.
4. Changing/adding an input re-ingests only what's new or errors clearly — no silent staleness.
5. The e2e script passes deterministically with no network access and no API keys required.

## Testing Requirements

- E2E test (PRD's "one script... end-to-end against stubbed Cognee + stubbed LLM"): the full flow above including the cache-hit assertion.
- Assert externally observable outcomes only: store contents, stub call records, cache behavior.
- No live API calls; test must pass with `OPENAI_API_KEY` unset.

## Dependencies

- T03 (adapters), T05 (map pass), T06 (merge pass + store).

## Out of Scope

- Real Cognee REST integration (T08).
- Real user exports — fixtures only (user owns real-export parsing).
- Watch folders / scheduled / background ingestion (PRD out of scope).
- Query-time logic (relevance, evidence retrieval, generation — T10+).
