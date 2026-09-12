---
labels: [ready-for-agent]
title: Add the activity browser view
---

# T18 — Add the activity browser view

## Goal

Add a UI view that lists the full activity store — every activity the system believes the user did, with its structured fields — so the activity layer is inspectable in the app, not only in the JSON file.

## User-Visible Impact

The user can browse what the system believes they did (PRD user story 14): each activity's title, project, type, status, times, outcome, blockers, next steps, technologies, evidence count, and confidence — the debugging/transparency surface for the activity layer.

## PRD Context

PRD user story 14: "browse the full activity list in the UI, so that I can see what the system believes I did." User story 13: activities persisted as a simple inspectable artifact. The Activity schema fields (T02): id, title, description, project, activityType, startTime, lastActiveTime, status, technologies, outcome, blockers, nextSteps, beforeState, afterState, evidenceIds, confidence.

## Implementation Notes

- Simple route/page (e.g. `/activities`) plus a server-side read of the activity store (or a small API route) — read-only; no editing.
- List view with expandable detail (or a master-detail layout): the list shows the scannable fields (title, project, type, status, last active, confidence, evidence count); expansion shows description, before/after state, outcome, blockers, next steps, technologies.
- Time-range filter reuse: the same range options as the main page (today/3/7/14/custom) filtering on the same semantics as T13's filter function — reuse that pure function, don't fork it.
- Empty/missing store state: same "run ingest first" surfacing as T13.
- Linking from T14's evidence drawer to an activity should be able to target this view's activity detail (or the activities pane); keep the target consistent with T14's choice.

## Acceptance Criteria

1. `/activities` (or equivalent) lists all activities from the pre-ingested store.
2. Each activity shows the core scannable fields; detail is expandable with the full structured fields including before/after state, blockers, next steps, and confidence.
3. Time-range filtering works and uses the same filter semantics as the query path.
4. Empty/missing store shows the actionable "run ingest" state.
5. An activity's evidence count matches its `evidenceIds` length (rendered consistently with the data).

## Testing Requirements

- Page/route-level tests with a fixture store: activities render with expected fields; range filtering; empty-store state.
- Reuse of the shared time-range filter is verifiable by behavior (same boundary semantics as T13's tests), not by import inspection.

## Dependencies

- T06 (activity store), T13 (filter function, app wiring conventions).

## Out of Scope

- Editing, deleting, or manually creating activities.
- Search/sort/pagination — the corpus is ~20–40 activities for a week.
