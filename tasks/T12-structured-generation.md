---
labels: [ready-for-agent]
title: Generate structured, citation-carrying output with asserted citation integrity
---

# T12 — Generate structured, citation-carrying output with asserted citation integrity

## Goal

Implement the final generation stage: the larger LLM produces a `GeneratedOutput` — sections containing claims, each claim markdown plus evidence ids — validated by Zod, with citation integrity asserted in code: every evidence id in the output resolves to a real evidence record, or the output is repaired/rejected. Free-form text is never accepted.

## User-Visible Impact

After T13 wires it, the user sees a real generated standup where every important claim is clickable and traceable (PRD user stories 25–26). Structured output is also what guarantees "free-form text can never silently lose provenance" (user story 28).

## PRD Context

PRD "Evidence retrieval & generation": "Generation produces structured JSON (sections → claims with markdown + evidence ids), Zod-validated, then rendered by the UI. Free-form text is never accepted, because free-form text cannot carry provenance reliably." "A claim is rendered clickable; clicking opens the evidence drawer. Citation integrity (every evidence id resolves) is asserted, not hoped for." PRD "Stack & runtime": larger model for final generation. PRD "Testing Decisions" seam 2: "every evidence id in the output resolves to a real document/excerpt; below-threshold activities are excluded."

## Implementation Notes

- Input: profile (T09), selected activities with scores (T10), evidence records (T11). Output: `GeneratedOutput` — `profileKey`, `timeRange`, `sections: [{ title, claims: [{ markdown, evidenceIds[] }] }]`.
- Use the large model via `LlmClient` with schema-validated JSON. The prompt receives activities (with before/after state, outcome, blockers, next steps) and the evidence pool (ids + excerpts), and must fill the profile's `sections`, citing evidence ids per claim. Honor profile `outputConstraints` (e.g., tone, length, LinkedIn impact framing).
- Citation integrity gate (in code, after the LLM responds): every `evidenceIds` entry must exist in the evidence pool; every claim must carry at least one evidence id for important assertions. On violation: one repair retry that includes the validation error, then a loud failure. Never emit output with dangling ids — this is the PRD's "asserted, not hoped for."
- Claims the LLM writes without citations for trivial connective text (section intros) can be allowed only if the profile's constraints permit; otherwise require evidence everywhere. Decide once, encode in validation, and keep it consistent — the T14 UI's clickability depends on it.
- The generator is profile-agnostic: same code path for all six profiles (user story 31: new use case = new profile only).

## Acceptance Criteria

1. Given a profile, selected activities, and evidence records (fixtures/canned LLM), generation returns a `GeneratedOutput` validating against the schema.
2. Output sections match the profile's defined sections.
3. Every evidence id in every claim resolves to a supplied evidence record — asserted by an explicit integrity check that runs on every generation (and is covered by a test with a deliberately dangling id that gets repaired or rejected).
4. Claims render as markdown strings with their citations attached — no free-form unstructured text is ever returned by the generator.
5. The same generator code path works unchanged for standup and blog profiles (only inputs differ).
6. An invalid first LLM response triggers exactly one repair retry with the validation error included, then fails loudly.

## Testing Requirements

- Query-seam tests (PRD seam 2) with `FakeLlm`: canned generation in → structured output out; citation resolution for every id; below-threshold (unsupplied) activities never appear; the dangling-id repair/reject path; one-retry behavior.
- Test the integrity gate directly with a hand-crafted invalid output.
- No prompt-wording assertions, no live API calls.

## Dependencies

- T11 (evidence records), T09 (profiles).

## Out of Scope

- UI rendering, clickable claims, drawer (T13/T14).
- Query API route and time-range handling (T13).
- Multi-model routing or fallbacks beyond the repair retry.
