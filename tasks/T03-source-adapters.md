---
labels: [ready-for-agent]
title: Build the ChatGPT, Gmail, and coding-agent source adapters behind the normalized document contract
---

# T03 — Build the three source adapters behind the normalized document contract

## Goal

Implement the three v1 source adapters — `ChatGptAdapter` (conversations export), `EmailAdapter` (Gmail export), `CodingAgentAdapter` (Codex-style transcripts) — each turning a raw export fixture into validated normalized `SourceDocument`s. This establishes the stable adapter contract between user-owned real-export parsing and the agent-owned pipeline.

## User-Visible Impact

No direct UI impact yet. This is the entry point of the ingestion pipeline (T07) — after T07, imported data flows through these adapters into the user's memory. The contract itself is what lets the user drop in real exports later without pipeline changes.

## PRD Context

PRD "Source adapters": three adapters for v1; adapter contract is "raw export in → normalized `SourceDocument` out. All downstream logic (extraction, merge, relevance, retrieval, generation) consumes only the normalized representation." "The user owns real-export parsing/fixtures; the adapter contract is the stable interface between user-owned parsing and agent-owned pipeline." Screenshots/images deferred. PRD "Testing Decisions" seam 3: "raw export file in → normalized documents out. Contract tests on the user-owned parsing; a minimal sample fixture keeps the pipeline testable before real exports land."

## Implementation Notes

- Shared adapter interface, roughly: `adapt(rawInput): SourceDocument[]` — decide the raw input type (file path, parsed JSON, string) and keep it uniform across the three adapters so T07's orchestrator is source-agnostic.
- Sample raw-export fixtures are stand-ins for real exports, not the real formats: a small ChatGPT `conversations.json`-shaped sample, a Gmail takeout/mbox-shaped sample, a Codex-style transcript sample. Keep each minimal (1–3 items). The user will replace parsing internals with real-export logic later — isolate format-specific parsing inside each adapter so the contract never changes.
- Zod-validate adapter output at the boundary (PRD: validation at every boundary). Invalid items should fail loudly (throw with context), not silently drop — silent drops would hide parsing bugs in the user's real exports.
- Map raw fields to normalized fields deliberately: participants (chat authors, email from/to, agent/user), timestamps (use the most meaningful event time), titles (conversation title, email subject, session/task name), and keep anything losslessly useful in `metadata`.

## Acceptance Criteria

1. A shared adapter interface exists and all three adapters implement it.
2. Each adapter turns its sample raw fixture into `SourceDocument[]` that passes Zod validation.
3. Output documents carry correct `sourceType` ("chatgpt" | "email" | "coding_agent"), meaningful titles, timestamps, participants, and metadata.
4. Contract tests pass for all three adapters against the sample fixtures.
5. Malformed raw input produces a clear validation error, not a silent empty result.

## Testing Requirements

- Adapter-seam contract tests (PRD seam 3): raw fixture in → validated normalized documents out, one suite per adapter.
- Assert observable output only (documents), not internal parsing steps.
- No LLM or network involvement in these tests.

## Dependencies

- T02 (schemas and normalized-document fixtures).

## Out of Scope

- Real full-fidelity export parsing (user-owned; the samples prove the contract).
- Screenshot/image adapters (PRD out of scope).
- Any downstream pipeline logic (map/merge happen in T05/T06).
- Additional integrations (GitHub, Slack, Linear — PRD out of scope).
