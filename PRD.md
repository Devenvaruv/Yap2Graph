# PRD: Intent-Aware Personal Research & Memory System (Hackathon Prototype)

**Status:** ready-for-agent
**Type:** Hackathon prototype (5-minute live demo)
**Scope:** Single-user, localhost, no auth

---

## Problem Statement

My real work is scattered across ChatGPT conversations, coding-agent sessions, and email. Every time I need a standup, a manager update, an end-of-week summary, or a blog post about what I did, I have to manually re-read everything and re-synthesize it — once per audience, every time.

A generic summarizer doesn't solve this, because "what matters" depends on intent. A standup needs blockers and next steps. A technical blog needs interesting problems, failures, and lessons learned — and should ignore routine admin work. A manager update needs deliverables and impact. Prompting an LLM with "summarize my week" produces the same undifferentiated blob for every audience.

What's missing is a system with actual memory structure: raw activity stored once, meaningful work extracted as activities, and a relevance pipeline that decides what matters for the specific intent — with every claim traceable back to the conversations and emails it came from.

## Solution

A localhost web app with four layers over one shared memory:

1. **Raw memory (Cognee).** Real data exports — ChatGPT, Gmail, coding-agent transcripts — are normalized by pluggable source adapters into a common document representation and stored in Cognee, which builds the knowledge graph ("cognify"). This answers *"what was actually said or done?"*
2. **Activity layer.** At ingest time, a two-pass map-merge LLM extraction turns raw documents into a small set of deduplicated activities. Multiple pieces of evidence referring to the same work — a ChatGPT discussion, the code change, the "I finished it" email — collapse into ONE activity with before/after state, outcome, blockers, and typed evidence links. This answers *"what meaningful work occurred?"*
3. **Reference/intent model.** Hardcoded profiles (standup, manager update, end-of-day/week update, technical blog, LinkedIn post, accomplishments) each define what matters: include criteria, exclude criteria, scoring weights, threshold, and output sections. This answers *"what matters for this intent?"*
4. **Research & generation.** Hybrid relevance matching (embedding pre-filter + LLM scoring on relevance/impact/novelty/completion/confidence) selects activities; Cognee search seeded per selected activity retrieves supporting evidence; generation produces a structured output where every important claim carries citations. This answers *"what happened that matters for this intent?"*

The core demo: the **exact same 7 days of memory** generates a standup, a manager update, and a technical blog that are clearly different — because the relevance criteria are different, not just the formatting. Every claim is clickable and opens the evidence behind it.

## User Stories

### Ingestion & raw memory

1. As a user, I want to import my ChatGPT conversations export, so that my past AI-assisted discussions become part of my long-term memory.
2. As a user, I want to import my Gmail export, so that email threads and outcomes feed my activity history.
3. As a user, I want to import my coding-agent transcripts (Codex etc.), so that what I actually built is captured, not just discussed.
4. As a user, I want all sources normalized into a common document representation (id, source type, title, timestamp, participants, content, metadata) before entering the pipeline, so that the research logic never knows or cares where data came from.
5. As a developer, I want to add a new source adapter later without touching the extraction, relevance, or generation logic, so that integrations never force pipeline rewrites.
6. As a user, I want my raw corpus stored in Cognee with the knowledge graph built (cognify), so that evidence retrieval is semantic rather than keyword-only.
7. As a user, I want ingestion to run once and be cached, so that query time is fast and the live demo never waits on ingestion.
8. As a user, I want everything running locally with API keys in `.env` and no authentication, so that the prototype stays simple and my data stays on my machine.

### Activity layer

9. As a user, I want candidate events extracted per source document (map pass), so that nothing meaningful is missed.
10. As a user, I want candidates merged across sources into deduplicated activities (merge pass), so that "discussed it in ChatGPT + changed the code + emailed 'done'" becomes one activity, not three.
11. As a user, I want each activity to carry title, description, project, activity type, start/last-active times, status, technologies/entities, outcome, blockers, next steps, evidence references, and confidence, so that outputs are grounded in structured work units.
12. As a user, I want activities to capture before/after state, so that outputs express what *changed*, not just what was mentioned.
13. As a user, I want activities persisted as a simple inspectable artifact (JSON), so that I can debug and diff the activity layer without a database.
14. As a user, I want to browse the full activity list in the UI, so that I can see what the system believes I did.

### Intent & relevance

15. As a user, I want to pick "Write my standup" and get completed work, in-progress work, blockers, and next actions — and NOT routine admin or trivial rewording.
16. As a user, I want to pick "Update my manager" and get progress, deliverables, impact, decisions, blockers, dependencies, and next steps.
17. As a user, I want to pick "Write a technical blog" and get interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, and meaningful before/after changes — ignoring routine work and repetitive debugging with no outcome.
18. As a user, I want to pick "Write a LinkedIn post" and get an accomplishment-oriented narrative with impact framing.
19. As a user, I want to pick "What did I accomplish?" and get a plain summary of completed, meaningful work.
20. As a user, I want end-of-day and end-of-week updates to use the same profile with different time ranges, so that one profile serves both.
21. As a user, I want to select a time range (today / last 3 / 7 / 14 days / custom), so that outputs reflect the window I care about.
22. As a user, I want relevance computed by embedding pre-filter plus an LLM judge scoring each activity on relevance, impact, novelty, completion, and confidence (0–1), so that selection is explainable rather than magical.
23. As a user, I want to see the per-activity scores, so that I can understand why an activity was included or dropped.

### Evidence & provenance

24. As a user, I want evidence retrieved from Cognee (summaries + chunk search) seeded per selected activity, so that claims are backed by the actual source excerpts.
25. As a user, I want every important claim in an output to carry citations to underlying evidence, so that nothing is asserted without provenance.
26. As a user, I want to click a claim in an output and open the evidence behind it (source document metadata + excerpt), so that I can verify why the system included it.
27. As a user, I want citations to resolve to real documents (no dangling evidence ids), so that trust in the output is mechanical, not aspirational.

### Output & demo

28. As a user, I want generation to produce structured output (sections containing claims with markdown and evidence ids) validated by schema, so that free-form text can never silently lose provenance.
29. As a user, I want the same 7 days of memory to produce clearly different standup / manager / blog outputs, so that the value of intent-awareness is visible in one glance.
30. As an audience member at the demo, I want to watch the same pre-ingested week generate three different outputs live in under 5 minutes, so that the core idea lands without flaky waits.
31. As a developer, I want to add a new output use case by adding a reference profile only, so that output modes never require rewriting the system.
32. As a developer, I want the LLM and embedding clients behind an injectable interface, so that tests run deterministically without live API calls.

## Implementation Decisions

### Stack & runtime

- **TypeScript everywhere.** Next.js (App Router) as the single full-stack app: React UI plus server-side pipeline logic in one codebase.
- **Cognee runs locally through the uv-managed Python service in `cognee-service/`** (Cognee is a Python library; the TS pipeline calls its localhost REST API for add / cognify / search). Default local storage backends (NetworkX + LanceDB) persist under `cognee-service/.cognee/` — no Neo4j, Qdrant, remote service, or external database.
- **OpenAI via the TS SDK.** Small model (gpt-4o-mini class) for map extraction, merge, and relevance scoring; larger model for final generation; `text-embedding-3-small` for embeddings. Single `OPENAI_API_KEY` in `.env`.

### Source adapters

- Three adapters for v1: **ChatGptAdapter** (conversations export), **EmailAdapter** (Gmail export), **CodingAgentAdapter** (Codex-style transcripts). Screenshots/images deferred.
- Adapter contract: raw export in → normalized `SourceDocument` out. All downstream logic (extraction, merge, relevance, retrieval, generation) consumes only the normalized representation.
- The user owns real-export parsing/fixtures; the adapter contract is the stable interface between user-owned parsing and agent-owned pipeline.

### Normalized document & core schemas

These type shapes encode the design decisions (from the design grilling, trimmed to the decision-rich parts):

```ts
SourceDocument {
  id, sourceType: "chatgpt" | "email" | "coding_agent",
  title, timestamp, participants[], content, metadata
}

Activity {
  id, title, description, project, activityType,
  startTime, lastActiveTime, status,
  technologies[], outcome, blockers[], nextSteps[],
  beforeState, afterState,      // change detection, filled by merge pass
  evidenceIds[], confidence
}

ReferenceProfile {
  key, audience, sections[],
  includeCriteria[], excludeCriteria[],
  scoreWeights, threshold, outputConstraints
}

GeneratedOutput {
  profileKey, timeRange,
  sections: [{ title, claims: [{ markdown, evidenceIds[] }] }]
}
```

- Schemas validated with **Zod** at every boundary (adapter output, merge output, relevance output, generation output).
- Activity store: **JSON file** (~20–40 activities expected for a week) — inspectable, diffable, no database.

### Activity extraction (ingest time)

- **Two-pass map-merge.** Pass 1 (map): LLM extracts candidate events per source document, bounded by that document. Pass 2 (merge): LLM merges candidates across sources into deduplicated activities, carrying evidence ids forward and inferring before/after state. Cross-source activity resolution lives entirely in the merge pass.
- Extraction runs **at ingest time and is cached**. Query time does only: profile selection → relevance → evidence retrieval → one generation call.

### Reference / intent model

- **Hardcoded profiles as Zod-validated constants**, six total: standup, manager update, end-of-day/end-of-week update (shared profile, time-range knob), technical blog, LinkedIn post, accomplishments ("what did I accomplish").
- **Dynamic profiles for arbitrary requests are out of scope for v1.**
- Each profile owns: audience, output sections, include criteria (e.g. blog: interesting problems, experiments, architecture decisions, unexpected failures, lessons learned, meaningful before/after), exclude criteria (e.g. blog: routine admin, trivial wording changes, repetitive debugging without outcome), scoring weights, threshold, output constraints.

### Relevance matching (query time)

- **Hybrid, deliberately simple.** Embedding similarity between profile criteria and activity text pre-filters to a top-K shortlist; one LLM call then scores the shortlist on five dimensions (relevance, impact, novelty, completion, confidence, each 0–1) and drops activities below the profile threshold. Scores are surfaced in the UI.

### Evidence retrieval & generation

- **Cognee is load-bearing at query time:** after cognify, Cognee search (summaries + chunks) runs seeded per selected activity to pull evidence excerpts backing each claim.
- **Generation produces structured JSON** (sections → claims with markdown + evidence ids), Zod-validated, then rendered by the UI. Free-form text is never accepted, because free-form text cannot carry provenance reliably.
- **Provenance card** = adapter-provided source metadata + Cognee-retrieved excerpt + link to the activity it supported.
- A claim is rendered clickable; clicking opens the evidence drawer. Citation integrity (every evidence id resolves) is asserted, not hoped for.

### UI (user-owned layout; these are the requirements it must satisfy)

- Intent picker ("What do you need?": standup, manager update, LinkedIn post, technical blog, accomplishments, end-of-day/week update).
- Time-range selector (today / 3 / 7 / 14 days / custom).
- Output pane rendering markdown with clickable, highlighted claims.
- "Activities used" pane with per-activity relevance scores.
- Evidence drawer on claim click.

### Demo posture

- 5-minute live click-through, no recording. Everything pre-ingested and cached before the demo; the only live LLM work on stage is query-time relevance + generation.
- Demo script (user-owned): same 7 days → standup → manager update → blog → click the same claim across outputs to show different evidence weighting.

## Testing Decisions

**What makes a good test here:** assert external behavior only — given inputs (fixture documents, canned LLM/embedding responses), assert observable outputs (merged activities, selected activities, structured output, citation integrity). Never assert prompt wording, internal call ordering, or private state.

**Seams** (greenfield repo — all seams are new; chosen at the highest level that keeps LLM nondeterminism out):

1. **Pipeline seam (highest):** normalized documents in → activity store out. The map-merge extraction is tested as a whole against a small fixture corpus with known cross-source threads (one thread = ChatGPT discussion + code change + completion email). Assert: one merged activity per thread, evidence ids preserved through the merge, before/after state captured, noise documents produce no activities.
2. **Query seam:** activity store + profile + canned scores in → structured output out. Assert: standup and blog profiles select and order *different* activities from the same corpus (the core demo invariant, tested); every evidence id in the output resolves to a real document/excerpt; below-threshold activities are excluded.
3. **Adapter seam:** raw export file in → normalized documents out. Contract tests on the user-owned parsing; a minimal sample fixture keeps the pipeline testable before real exports land.
4. **LLM client injection seam (enabling seam for 1–3):** LLM and embedding clients sit behind interfaces; tests inject canned responses. No live API calls in tests.

**Prior art:** none — empty repo. These tests set the precedent.

**End-to-end:** one script runs the vertical slice end-to-end against stubbed Cognee + stubbed LLM; before the demo, a manual golden-path run with real keys confirms live behavior (type-checks and tests verify code correctness, not feature correctness — the live run is the feature check).

## Out of Scope

- Authentication, billing, multi-tenancy, production deployment.
- Dynamic/arbitrary intent profile generation ("meeting with my CTO" → temporary profile) — v2.
- Screenshot/image source adapter (including OCR/vision).
- GitHub, Slack, Linear, and additional integrations.
- Sophisticated ML ranking beyond the hybrid embedding + LLM-judge scheme.
- Production Cognee backends (Neo4j, Qdrant) — default local backends only.
- Scheduled/background ingestion, watch folders, sync.
- Demo recording or video production.
- UI polish beyond the required capabilities (user owns layout and demo script).

## Further Notes

- **First vertical slice:** sample daily data → Cognee → activities → "last 7 days" → standup reference profile → evidence-backed standup. Once that works end-to-end, generalize the same pipeline to manager update and blog — do not build all three in parallel.
- **Division of labor:** user owns real-export parsing/fixtures and the UI layout/demo script; the pipeline, profiles, relevance, provenance, backend, and adapter *contract* are agent-buildable against sample fixtures.
- **Implementation order (from the design grilling):** clean ingestion abstraction → Cognee integration → activity extraction → activity schema → intent/reference schemas → relevance matching → evidence/provenance → the three working output modes → UI wiring.
- **Repo state:** not yet a git repository and no issue tracker is configured; this PRD lives as a local file. The `ready-for-agent` status is recorded here until a tracker exists — publish there if one is set up.
