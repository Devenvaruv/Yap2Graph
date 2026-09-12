---
labels: [ready-for-agent]
title: Make claims clickable with an evidence drawer and per-activity score pane
---

# T14 — Make claims clickable with an evidence drawer and per-activity score pane

## Goal

Build the provenance UI: claims in the generated output render as clickable, highlighted elements; clicking opens an evidence drawer showing the source document metadata, the retrieved excerpt, and a link to the activity it supported. Add the "Activities used" pane showing each activity's relevance scores (and dropped activities with their scores).

## User-Visible Impact

The user can click any claim in a standup and see the exact conversation, email, or transcript excerpt behind it (PRD user story 26) — the trust moment of the demo. The score pane makes inclusion decisions explainable (user story 23).

## PRD Context

PRD "UI" requirements: "Output pane rendering markdown with clickable, highlighted claims. 'Activities used' pane with per-activity relevance scores. Evidence drawer on claim click." PRD "Evidence retrieval & generation": "Provenance card = adapter-provided source metadata + Cognee-retrieved excerpt + link to the activity it supported. A claim is rendered clickable; clicking opens the evidence drawer." User story 26: click a claim → open the evidence behind it (source document metadata + excerpt).

## Implementation Notes

- The generate route response (T13 envelope) already carries claims with `evidenceIds` and activity scores — this task is pure UI plus a small resolver: map `evidenceId` → evidence record. Either include evidence records in the route response (simplest; corpus is small) or add a lightweight evidence-by-id lookup endpoint. Prefer the simplest path; the demo never needs pagination.
- Claim rendering: markdown within a claim is rendered, the whole claim is a clickable/highlighted element (distinct visual treatment). Multiple evidence ids on a claim: drawer lists all, or tabs — your call, keep it simple.
- Drawer content = provenance card: source type + title + timestamp + participants (adapter-provided metadata), the excerpt (Cognee-retrieved), and a link/anchor to the supporting activity in the activities pane.
- Activities pane: selected activities with all five dimension scores, weighted total, threshold; dropped activities visibly grayed/secondary with their scores ("why it wasn't included").
- Clicking an evidence drawer's activity link scrolls/highlights that activity in the pane (the PRD's provenance card includes "link to the activity it supported").
- Accessibility basics on the interactive elements (keyboard-activatable claims, drawer closable) — cheap now, painful later.

## Acceptance Criteria

1. Every claim in the rendered output is visually highlighted and clickable.
2. Clicking a claim opens the evidence drawer showing that claim's evidence: source metadata (type, title, timestamp, participants), excerpt, and a link to the supporting activity.
3. Clicking a claim with multiple evidence ids surfaces all of them.
4. The "Activities used" pane lists selected activities with all five scores + weighted total + threshold, and dropped activities with their scores.
5. Following the drawer's activity link highlights the activity in the pane.
6. Rendering a fixture `GeneratedOutput` with evidence produces zero claims that fail to resolve to evidence (component-level integrity check in tests).

## Testing Requirements

- Component tests with a fixture output + evidence: claims render as clickable elements; clicking opens the drawer with the correct evidence record; multi-evidence claims show all; score pane shows selected and dropped with scores; activity link highlights.
- Interaction-level tests (Testing Library), not internal-state tests.
- No live API calls; the component suite runs on fixture data alone.

## Dependencies

- T13 (generate route + response envelope, output pane rendering).

## Out of Scope

- Editing or regenerating individual claims.
- Cross-output claim comparison views (the demo script demonstrates this by clicking the same claim across outputs manually).
- UI polish beyond the required capabilities (PRD out of scope).
