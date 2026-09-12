# `src/lib` — data contracts and fixture corpus

`schemas.ts` is the single source of truth for every data contract in the
pipeline. Adapters (T03), the map/merge passes (T05/T06), profiles (T09),
relevance (T10), generation (T12), and the UI import schemas and inferred
types from this one module — never redeclare them.

## Schema semantics (decisions downstream tasks should not guess at)

- **Evidence ids are document ids.** Every `evidenceIds` entry anywhere in
  the system (`Activity`, `GeneratedOutput` claims) references a
  `SourceDocument.id`. The merge pass builds `Activity.evidenceIds` as the
  union of the merged `CandidateEvent.documentId`s; nothing else mints
  evidence ids. The T12 citation gate and the T14 evidence drawer resolve
  ids against the document corpus.
- **`CandidateEvent`** (map-pass output, T05) is a bounded subset of
  `Activity` plus `documentId`. It deliberately has no `beforeState` /
  `afterState` (merge-only) and no `evidenceIds` (`documentId` is the
  evidence link; `.strict()` rejects the stray key). `project`, `status`,
  and `outcome` are optional because a single document may not state them;
  the merge pass resolves them into required `Activity` fields.
- **`Activity`** requires at least one evidence id — a zero-evidence
  activity fails validation (T06's "no invented evidence, fail loudly"
  rule). `beforeState`/`afterState` and `outcome` are optional and filled
  by the merge pass when the evidence supports them.
- `activityType` is an **open vocabulary** (LLM-extracted). Suggested
  values: `implementation`, `debugging`, `design`, `research`,
  `discussion`, `review`, `deployment`, `migration`, `admin`. Do not turn
  it into an enum without a migration story for extracted data.
- `status` is a closed enum: `completed | in_progress | blocked | abandoned`.
- **`ReferenceProfile.scoreWeights`** covers exactly the five dimensions
  T10 judges (`relevance`, `impact`, `novelty`, `completion`,
  `confidence`). Each weight is 0–1 emphasis; they are **not** required to
  sum to 1 — T10 normalizes when computing the weighted total.
  `outputConstraints` is a free-form string passed into the generation
  prompt (tone, length, framing).
- **`GeneratedOutput` claims** may carry an empty `evidenceIds` array
  (trivial connective text); the require-citation policy is enforced by
  T12's integrity gate in code, not by the schema. Sections may also be
  empty of claims (e.g. "Blockers: none").
- All schemas use `.strict()` — unknown keys fail validation, which turns
  LLM key typos (e.g. `evidenceId`) into loud boundary errors instead of
  silently dropped data.
- Timestamps are ISO 8601 strings; `Z`-suffixed UTC and explicit offsets
  are both accepted.

## Fixture corpus (`src/lib/fixtures/`)

`documents.json` holds 13 normalized `SourceDocument`s standing in for the
user's real exports until those land. `index.ts` validates every document
against the schema at import time (a broken fixture fails loudly wherever
it is imported) and exports `fixtureDocuments`, `fixtureThreads`,
`noiseDocumentIds`, and `fixtureWindow`.

The corpus window is **2026-09-05 through 2026-09-11** — a "last 7 days"
query from 2026-09-12 selects the entire corpus.

Known cross-source threads (T06 must merge each into exactly one activity
whose `evidenceIds` equal the thread's document ids):

| Thread | ChatGPT | Coding agent | Email | Expected status |
| --- | --- | --- | --- | --- |
| payment-webhook | `chatgpt-webhook-retry` | `codex-webhook-idempotency` | `email-webhook-shipped` | completed |
| feed-caching | `chatgpt-feed-cache` | `codex-feed-redis` | `email-feed-latency` | completed |
| ci-migration | `chatgpt-ci-migration` | `codex-ci-workflows` | `email-ci-runner-delay` | blocked |

Noise documents (must produce no activities; standup and blog profiles
must both exclude them):

- `email-timesheet-reminder` — routine automated admin
- `chatgpt-reword-request` — trivial rewording, no work content
- `codex-logging-tweaks` — repetitive churn, everything reverted, no outcome
- `email-license-renewal` — automated receipt

Document ids are deliberately human-readable (not export-realistic) so
tests, activity stores, and evidence drawers stay debuggable.
