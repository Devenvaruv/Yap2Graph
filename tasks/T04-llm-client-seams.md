---
labels: [ready-for-agent]
title: Add injectable LLM and embedding client seams with canned test fakes
---

# T04 — Add injectable LLM and embedding client seams with canned test fakes

## Goal

Put the LLM and embedding clients behind injectable interfaces, provide the OpenAI-backed production implementation, and provide deterministic fakes with canned responses — the enabling seam that keeps every later test free of live API calls and nondeterminism.

## User-Visible Impact

No direct UI impact. This unblocks testable versions of extraction (T05), merge (T06), relevance (T10), and generation (T12), and is the PRD's explicit requirement for deterministic tests (user story 32).

## PRD Context

PRD "Stack & runtime": OpenAI via the TS SDK; small model (gpt-4o-mini class) for map extraction, merge, and relevance scoring; larger model for final generation; `text-embedding-3-small` for embeddings; single `OPENAI_API_KEY` in `.env`. PRD user story 32: "LLM and embedding clients behind an injectable interface, so that tests run deterministically without live API calls." PRD "Testing Decisions" seam 4: "LLM and embedding clients sit behind interfaces; tests inject canned responses. No live API calls in tests."

## Implementation Notes

- Two interfaces, e.g. `LlmClient` (structured chat completion given messages + expected output schema) and `EmbeddingClient` (texts in → vectors out). All later pipeline code depends on these interfaces only, never on the OpenAI SDK directly.
- The `LlmClient` should support requesting JSON parsed/validated against a caller-provided Zod schema — the map (T05), merge (T06), scoring (T10), and generation (T12) passes all consume structured JSON, and the PRD demands Zod validation at every boundary. Decide once here whether validation/retry-on-invalid-JSON lives in the client or in callers, and apply it consistently.
- Model selection by purpose (small vs. large) should be a client concern (config), not scattered through pipeline code.
- Fakes: `FakeLlm` returns queued canned responses (callers enqueue expected completions in test setup) and `FakeEmbeddings` returns deterministic vectors (e.g., hash-based or caller-provided). Keep them in test utilities so every later task reuses them.
- `.env` key handling belongs to the OpenAI implementation only; fakes need no keys.

## Acceptance Criteria

1. `LlmClient` and `EmbeddingClient` interfaces exist and pipeline-facing code can depend on them without importing the OpenAI SDK.
2. OpenAI implementations exist: small model for extraction/merge/scoring, larger model for generation, `text-embedding-3-small` for embeddings, key from `.env`.
3. `FakeLlm` supports canned/queued structured responses and `FakeEmbeddings` returns deterministic vectors.
4. A client can be asked for schema-validated JSON output, and invalid JSON is retried or errors loudly (not silently passed through).
5. Unit tests exercise both fakes and the validation path with zero network calls.

## Testing Requirements

- Unit tests for the fakes (canned response ordering, deterministic embeddings) and for JSON-schema validation/retry behavior.
- A guard that the OpenAI implementation is only instantiated with a configured key (fails fast with a clear message).
- No live API calls anywhere in the test suite — this task sets that precedent for T05–T12.

## Dependencies

- T02 (Zod is the validation backbone of the structured-output contract).

## Out of Scope

- Any prompt content or pipeline logic (T05+).
- Streaming, token accounting, rate-limit handling — not needed for a 5-minute demo prototype.
- Non-OpenAI providers.
