---
labels: [ready-for-agent]
title: Integrate the real Cognee REST service (add, cognify, search)
---

# T08 — Integrate the real Cognee REST service (add, cognify, search)

## Goal

Replace the stub with a real `CogneeClient` that talks to the Cognee Docker REST service for `add` (store raw documents), `cognify` (build the knowledge graph), and `search` (summaries + chunk search), wired into the ingestion orchestrator.

## User-Visible Impact

The user's raw corpus is genuinely stored in Cognee with the knowledge graph built (PRD user story 6), which is what makes later evidence retrieval semantic rather than keyword-only (T11). No new UI yet, but this is the load-bearing integration for every clickable claim in the demo.

## PRD Context

PRD "Stack & runtime": "Cognee runs as its Docker REST service (Cognee is a Python library; the TS pipeline calls its REST API for add / cognify / search). Default storage backends (NetworkX + LanceDB) inside the container — no Neo4j, no Qdrant, no external databases." PRD user story 6: raw corpus stored with cognify so evidence retrieval is semantic. PRD "Evidence retrieval & generation": "Cognee is load-bearing at query time: after cognify, Cognee search (summaries + chunks) runs seeded per selected activity."

## Implementation Notes

- Implement the `CogneeClient` interface defined in T07 against the Cognee REST API (base URL from `COGNEE_API_URL` in `.env`, e.g. the local Docker service). Consult the running service's OpenAPI/docs for exact endpoint shapes — do not guess them; verify against the actual Docker container.
- `add` receives the normalized documents (the PRD stores the raw corpus as normalized documents — the corpus in Cognee is the normalized representation, keeping evidence metadata intact). Include source metadata in what's added so search results can map back to `SourceDocument` ids.
- `search` should support the query types Cognee exposes for summaries and chunks; T11 will call it per activity — expose a small typed surface (query, type) now and keep response normalization (excerpt text + document linkage) inside the client.
- Long-running `cognify`: handle polling/awaiting completion status; surface progress or at least a clear "still building" state so the pre-ingest runbook (T17) knows when it's done.
- All existing e2e tests keep using `StubCognee` — the real client gets its own tests with mocked HTTP. Add a tiny manual verification script or npm script (e.g. `npm run cognee:check`) that pings the service for a health/status endpoint.
- Document the exact `docker run` command for the Cognee service in the project README or `.env.example` comments.

## Acceptance Criteria

1. `RealCogneeClient` implements the T07 `CogneeClient` interface (add, cognify, search) against the configured REST base URL.
2. Ingestion with the real client stores the normalized corpus and completes cognify (status awaited, not fire-and-forget).
3. A search against the cognified corpus returns real summaries/chunks that link back to source document ids.
4. All existing tests still pass using `StubCognee` — no test in the suite requires Docker or a live Cognee.
5. HTTP-level unit tests cover the client's request shapes and response normalization with mocked fetch.

## Testing Requirements

- Unit tests with mocked HTTP (no Docker dependency): request construction, polling of cognify status, response normalization, and error surfacing.
- Manual golden-path verification with the real Docker service is expected and should be documented (exact steps in the task's completion notes or README) — this is the PRD's "live run is the feature check" posture.
- No live service calls in automated tests.

## Dependencies

- T07 (orchestrator + `CogneeClient` interface + stub).

## Out of Scope

- Production Cognee backends (Neo4j, Qdrant) — default local backends only (PRD out of scope).
- Evidence-retrieval seeding logic per activity (T11).
- UI changes.
