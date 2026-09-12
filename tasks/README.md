# Task Index — Intent-Aware Personal Research & Memory System

Source: `PRD.md` (status: ready-for-agent). No issue tracker is configured yet; tasks live here as individual files with the `ready-for-agent` label and can be ported to a tracker when one is set up.

## Milestones (in build order)

| # | Task | Depends on |
|---|------|------------|
| M1 — Visible shell | [T01](T01-scaffold-app-shell.md) Scaffold the Next.js app shell with intent picker and time-range selector | — |
| M2 — Data contracts | [T02](T02-core-schemas-and-fixtures.md) Define core Zod schemas and sample fixture corpus | — |
| | [T03](T03-source-adapters.md) Build the three source adapters behind the normalized document contract | T02 |
| | [T04](T04-llm-client-seams.md) Add injectable LLM and embedding client seams with canned test fakes | T02 |
| M3 — Ingestion & activity layer | [T05](T05-map-pass.md) Implement the map pass: candidate events per source document | T02, T04 |
| | [T06](T06-merge-pass.md) Implement the merge pass: deduplicated activities with evidence and before/after state | T05 |
| | [T07](T07-ingestion-orchestration.md) Orchestrate the cached ingestion pipeline end-to-end with a stubbed Cognee | T03, T05, T06 |
| | [T08](T08-cognee-integration.md) Integrate the real Cognee REST service (add, cognify, search) | T07 |
| M4 — Intent & query pipeline | [T09](T09-intent-profiles.md) Define the six intent reference profiles as validated constants | T02 |
| | [T10](T10-relevance-matching.md) Implement hybrid relevance matching with surfaced per-activity scores | T06, T09 |
| | [T11](T11-evidence-retrieval.md) Retrieve evidence from Cognee seeded per selected activity | T07, T10 |
| | [T12](T12-structured-generation.md) Generate structured, citation-carrying output with asserted citation integrity | T11, T09 |
| M5 — First vertical slice | [T13](T13-query-path-standup.md) Wire the query path so the first evidence-backed standup renders in the UI | T01, T12 |
| M6 — Full demo surface | [T14](T14-claims-evidence-drawer.md) Make claims clickable with an evidence drawer and per-activity score pane | T13 |
| | [T15](T15-manager-and-blog-modes.md) Deliver manager-update and technical-blog modes from the same memory | T13 |
| | [T16](T16-remaining-profiles.md) Complete LinkedIn, accomplishments, and end-of-day/week output modes | T15 |
| | [T18](T18-activity-browser.md) Add the activity browser view | T06, T13 |
| M7 — Demo readiness | [T17](T17-e2e-and-demo-runbook.md) Add the stubbed end-to-end script and demo pre-ingest runbook | T13 |

## Global constraints (apply to every task)

- Single-user, localhost, no auth. API keys in `.env` only.
- TypeScript everywhere; Next.js (App Router) is the single full-stack app.
- Zod validation at every boundary (adapter output, merge output, relevance output, generation output).
- No live LLM/embedding API calls in tests — inject canned responses via the LLM client seam.
- Out of scope for v1 (PRD): auth, multi-tenancy, dynamic profiles, screenshot/image adapters, GitHub/Slack/Linear integrations, Neo4j/Qdrant backends, scheduled ingestion, demo recording, UI polish beyond required capabilities.

## Porting to a tracker

Each file uses frontmatter with `title` and `labels: [ready-for-agent]`. When an issue tracker is configured, create one issue per file (title = H1, body = rest of file) and apply the `ready-for-agent` label.
