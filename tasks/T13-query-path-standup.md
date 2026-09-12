---
labels: [ready-for-agent]
title: Wire the query path so the first evidence-backed standup renders in the UI
---

# T13 — Wire the query path: first evidence-backed standup renders in the UI

## Goal

Wire the complete query path behind a server API route: intent + time range in → profile selection → time-range filtering → relevance matching → evidence retrieval → one generation call → `GeneratedOutput` out. Connect the T01 UI shell so selecting "standup" + "last 7 days" renders a real, fixture-backed standup in the output pane. This completes the PRD's first vertical slice end-to-end.

## User-Visible Impact

The user opens the app, picks "Write my standup" with "last 7 days", and sees a real standup generated from the fixture week — the first time the product does its actual job in the browser (PRD user stories 15, 21).

## PRD Context

PRD "Activity extraction": "Query time does only: profile selection → relevance → evidence retrieval → one generation call." PRD "Further Notes": "First vertical slice: sample daily data → Cognee → activities → 'last 7 days' → standup reference profile → evidence-backed standup. Once that works end-to-end, generalize the same pipeline to manager update and blog — do not build all three in parallel." User story 21: time range today / last 3 / 7 / 14 days / custom. User story 20: EOD/EOW use the same profile with different ranges.

## Implementation Notes

- Server route (App Router, e.g. `src/app/api/generate/route.ts`): inputs are profile key + time range (preset or custom start/end). It loads the pre-ingested activity store (never triggers ingestion), filters activities by time range (on `startTime`/`lastActiveTime`), then runs T10 → T11 → T12. Real clients (OpenAI, real Cognee if running; stubbed Cognee fallback is acceptable for fixture-only dev) are injected server-side.
- Time-range filtering is a pure function on activities + range — test it directly (today / 3 / 7 / 14 / custom; boundary semantics: inclusive of range start, and activities whose `lastActiveTime` falls in range count even if started earlier — decide and encode once).
- The route should also return the per-activity selection data (selected + dropped with scores) alongside the output, shaped for T14's "Activities used" pane. Decide the response envelope once: `{ output, selectedActivities, droppedActivities }`.
- UI: the T01 picker calls the route and renders `sections`/claims as markdown in the output pane. Claims are not yet clickable (T14). Keep a loading state — generation takes a few seconds and the demo needs it to look intentional, not frozen.
- Ingestion must be run before querying (T07 command). If the store is missing/empty, the route returns a clear "run ingest first" error the UI surfaces.
- The whole query path must complete in demo-friendly time against the fixture corpus (a few seconds — one relevance call, N small searches, one generation call).

## Acceptance Criteria

1. `POST` (or GET) to the generate route with profile=standup and range=last-7-days returns a valid `GeneratedOutput` plus selected/dropped activity data, against the pre-ingested fixture store.
2. The UI renders the standup's sections and claims as markdown in the output pane after picking intent + range.
3. Time-range presets (today/3/7/14/custom) filter which activities reach the relevance stage — tested at the pure-function level, including boundary and custom-range cases.
4. Query path performs no ingestion work and makes at most: one embedding batch, one relevance LLM call, per-activity searches, one generation call.
5. Missing/empty activity store produces a clear actionable error in the UI.
6. The route works with the standup profile without any profile-specific branching.

## Acceptance criteria for the visible slice

7. Running ingest (T07) then the app, a user can produce an evidence-backed standup from "last 7 days" in one interaction — the PRD's first vertical slice, live.

## Testing Requirements

- Route-level integration test with all fakes injected (FakeLlm, FakeEmbeddings, StubCognee) and a fixture store: standup + range → valid response envelope; time-range filtering; empty-store error.
- Unit tests for the time-range filter function's boundary semantics.
- No live API calls in automated tests; a manual golden-path run with real keys is expected and noted (live run is the feature check, per PRD).

## Dependencies

- T01 (UI shell), T12 (generation; transitively T09–T11), T07 (ingested fixture store).

## Out of Scope

- Manager update and blog modes (T15) — standup only, per the PRD's "do not build all three in parallel."
- Clickable claims, evidence drawer, score pane (T14).
- Streaming/progressive rendering of the output.
