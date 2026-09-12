---
labels: [ready-for-agent]
title: Scaffold the Next.js app shell with intent picker and time-range selector
---

# T01 — Scaffold the Next.js app shell with intent picker and time-range selector

## Goal

Create a runnable Next.js (App Router) TypeScript app on localhost that shows the demo UI skeleton: an intent picker ("What do you need?"), a time-range selector, and placeholder panes for the generated output and the activities used. Set up the project conventions (Zod, test runner, `.env`) that all later tasks build on.

## User-Visible Impact

The user can open `http://localhost:3000`, see the product taking shape — the six intents, the time-range options, and the output/activities panes — and confirm the app runs with a single command.

## PRD Context

PRD "UI" section requires: an intent picker with the six intents (standup, manager update, LinkedIn post, technical blog, accomplishments, end-of-day/week update); a time-range selector (today / last 3 / 7 / 14 days / custom); an output pane; an "Activities used" pane; and an evidence drawer (built in T14 — placeholder here). PRD "Stack & runtime": TypeScript everywhere, Next.js App Router as the single full-stack app, OpenAI via TS SDK, single `OPENAI_API_KEY` in `.env`, localhost, no authentication.

## Implementation Notes

- Greenfield repo (currently only `PRD.md` and `tasks/` exist). Use `create-next-app` with TypeScript and App Router defaults.
- Assumption: **Vitest** as the test runner (TS-native, works well with Next without extra config). If a different runner is already configured, follow it — nothing is configured yet.
- Suggested layout (light, not prescriptive): `src/app` for routes, `src/components` for UI, `src/lib` for pipeline logic.
- The six intent options and five time-range options should live in one shared constant module so T09's profiles and the picker never drift apart. Placeholder profiles keyed by `key` are fine here; T09 replaces them with full validated profiles.
- Create `.env.example` with `OPENAI_API_KEY` and `COGNEE_API_URL` (Cognee Docker REST service; T08 uses it). Do not commit real keys.
- Selection state (intent + time range) can be client-side for now; T13 wires it to the query API.
- No styling framework is mandated by the PRD; keep it minimal — the user owns layout and demo polish (PRD "Out of scope": UI polish beyond required capabilities).

## Acceptance Criteria

1. `npm run dev` starts the app and `http://localhost:3000` renders without errors.
2. The intent picker shows exactly the six intents from the PRD.
3. The time-range selector offers today / last 3 / last 7 / last 14 / custom.
4. Output pane and "Activities used" pane render as labeled placeholders.
5. `.env.example` exists with `OPENAI_API_KEY` and `COGNEE_API_URL`; real `.env` is gitignored.
6. A smoke test asserts the page renders and all six intents appear.

## Testing Requirements

- Smoke test at the page level (e.g., Vitest + Testing Library rendering the home route): six intents and time-range options are present.
- No test of internal component state or styling.

## Dependencies

None. (T02 is also dependency-free and can proceed in parallel.)

## Out of Scope

- Any LLM, Cognee, or pipeline logic.
- Evidence drawer, clickable claims, score display (T14).
- Real profile definitions with criteria/weights (T09).
- Authentication, deployment, UI polish.
