---
labels: [ready-for-agent]
title: Add the stubbed end-to-end script and demo pre-ingest runbook
---

# T17 — Add the stubbed end-to-end script and demo pre-ingest runbook

## Goal

Finalize demo readiness: a deterministic end-to-end script that runs the full vertical slice (ingest → query → three outputs) against stubbed Cognee + faked LLM and asserts citation integrity across all outputs; plus a written pre-ingest runbook for the real-key golden-path run to execute before the 5-minute live demo.

## User-Visible Impact

The developer can prove the whole system works in one command with zero network dependency, and follow a short checklist to pre-ingest real data so the live demo only ever performs query-time work (relevance + generation) on stage — the PRD's demo posture.

## PRD Context

PRD "End-to-end" testing decision: "one script runs the vertical slice end-to-end against stubbed Cognee + stubbed LLM; before the demo, a manual golden-path run with real keys confirms live behavior (type-checks and tests verify code correctness, not feature correctness — the live run is the feature check)." PRD "Demo posture": "5-minute live click-through, no recording. Everything pre-ingested and cached before the demo; the only live LLM work on stage is query-time relevance + generation." Demo script: same 7 days → standup → manager update → blog → click the same claim across outputs.

## Implementation Notes

- The T07 e2e script is the starting point; extend it through the query path: after ingest (stubs), run all six intents (or at minimum the three demo modes) over "last 7 days", assert each returns valid `GeneratedOutput`, and assert citation integrity for every claim in every output.
- Keep it deterministic and key-free: `FakeLlm`/`FakeEmbeddings`/`StubCognee` throughout; `npm run e2e` must pass with no `.env` at all.
- The runbook (project README section or `docs/demo-runbook.md`) covers, in order: start Cognee Docker service (exact command from T08); run real ingestion with real keys (`OPENAI_API_KEY`, `COGNEE_API_URL`); confirm cognify completed and `activities.json` looks right (spot-check thread merge); golden-path manual click-through of the demo script (standup → manager → blog → claim click); cache verification (second app start performs no ingestion); shutdown. Include expected timings so the operator can spot a hung cognify.
- Add a pre-demo self-check to the runbook: run the stubbed e2e script as a smoke test right before the live run — it catches breakage without spending API budget.
- If real-export sample data from the user has landed by this task, the runbook's golden path should use it; otherwise fixture exports. Keep the runbook honest about which.

## Acceptance Criteria

1. `npm run e2e` runs ingest → query for at least standup, manager, and blog against stubs, deterministically, with no `.env`/keys, and exits green.
2. The script asserts, for every generated output: schema validity, non-empty sections, and citation integrity (every evidence id resolves).
3. The script asserts the cache guarantee: a second ingest invocation performs zero LLM/Cognee work.
4. The demo runbook exists with the ordered pre-demo steps, exact commands, expected timings, and a failure-triage note for each step (what to check if cognify hangs, if the store is stale, if generation is slow).
5. Following the runbook with real keys has been executed at least once manually (golden path) — record the result and any deviations in the runbook's completion notes.

## Testing Requirements

- The e2e script itself is the test; it must be wired into CI-or-pre-demo workflow as a plain repeatable command.
- Assertions are external-behavior only (outputs, call records, exit codes).
- No live API calls in the script; the real-key run is manual by design.

## Dependencies

- T13 (query path; transitively T07, T09–T12).

## Out of Scope

- CI platform setup (no repo hosting configured yet — a repeatable local command is enough).
- Demo recording or video production (PRD out of scope).
- Performance tuning beyond "demo-friendly time" already established in T13.
