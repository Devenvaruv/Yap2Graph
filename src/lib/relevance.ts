import { z } from "zod";
import type { Activity, ReferenceProfile, ScoreDimension } from "./schemas";
import { SCORE_DIMENSIONS } from "./schemas";
import type { EmbeddingClient, LlmClient } from "./llm";

/**
 * Per-activity relevance scores (PRD story 22, 23). The five dimensions are
 * scored by the LLM judge; the weighted total is computed in code from the
 * profile's weights — the LLM never does arithmetic or thresholding.
 */
export interface ActivityScore {
  activityId: string;
  dimensions: Record<ScoreDimension, number>;
  weightedTotal: number;
}

/**
 * Relevance pipeline result. Selected activities pass the profile threshold;
 * dropped activities failed it. Both lists carry full scores so the UI can
 * show "why was this dropped" (PRD story 23).
 */
export interface RelevanceResult {
  profileKey: string;
  threshold: number;
  selected: ActivityScore[];
  dropped: ActivityScore[];
}

/**
 * Cosine similarity between two vectors. Returns 0 for zero-length vectors
 * rather than NaN — a missing embedding signal means "no match", not "error".
 */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build the text representation of an activity for embedding. Title,
 * description, outcome, and technologies give the embedding model enough
 * signal to match against profile criteria without bloating the token count.
 */
function activityEmbeddingText(activity: Activity): string {
  const parts = [activity.title, activity.description];
  if (activity.outcome) parts.push(activity.outcome);
  if (activity.technologies.length > 0) {
    parts.push(activity.technologies.join(", "));
  }
  return parts.join("\n");
}

/**
 * Build the text representation of a profile's criteria for embedding.
 * Include and exclude criteria are concatenated so the embedding captures
 * both what matters and what to filter out.
 */
function profileCriteriaText(profile: ReferenceProfile): string {
  const parts = [...profile.includeCriteria];
  if (profile.excludeCriteria.length > 0) {
    parts.push("Exclude:", ...profile.excludeCriteria);
  }
  return parts.join("\n");
}

/**
 * Compute the weighted total score from the five dimensions and the profile's
 * weights. Weights are 0–1 emphasis values, normalized to sum to 1 before
 * applying — this keeps the weighted total in [0, 1] regardless of whether
 * the profile uses all dimensions equally.
 */
function computeWeightedTotal(
  dimensions: Record<ScoreDimension, number>,
  weights: Record<ScoreDimension, number>,
): number {
  const totalWeight = SCORE_DIMENSIONS.reduce((sum, dim) => sum + weights[dim], 0);
  if (totalWeight === 0) return 0;
  const weighted = SCORE_DIMENSIONS.reduce(
    (sum, dim) => sum + dimensions[dim] * (weights[dim] / totalWeight),
    0,
  );
  return weighted;
}

/**
 * Schema for the LLM judge's response. Each activity in the shortlist gets
 * five dimension scores in [0, 1]. The LLM provides raw scores; code applies
 * weights and threshold.
 */
const LlmScoreResponse = z.object({
  scores: z.array(
    z.object({
      activityId: z.string(),
      relevance: z.number().min(0).max(1),
      impact: z.number().min(0).max(1),
      novelty: z.number().min(0).max(1),
      completion: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/**
 * Pre-filter: embed profile criteria and each activity, compute cosine
 * similarity, return the top-K activity IDs. K is a small constant — larger
 * than the expected selected set, small enough to keep the judge call cheap.
 */
async function embeddingPreFilter(
  activities: readonly Activity[],
  profile: ReferenceProfile,
  embeddingClient: EmbeddingClient,
  topK: number,
): Promise<string[]> {
  if (activities.length === 0) return [];

  const profileText = profileCriteriaText(profile);
  const activityTexts = activities.map(activityEmbeddingText);

  const [profileEmbedding, ...activityEmbeddings] = await embeddingClient.embed([
    profileText,
    ...activityTexts,
  ]);

  const scored = activities.map((activity, idx) => ({
    id: activity.id,
    similarity: cosineSimilarity(profileEmbedding, activityEmbeddings[idx]),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK).map((s) => s.id);
}

/**
 * Build the prompt for the LLM judge. The prompt encodes the five dimension
 * definitions (relevance, impact, novelty, completion, confidence) so the
 * model knows what each score means. Profile criteria are included so the
 * judge can assess relevance against this specific intent.
 */
function buildJudgePrompt(
  shortlist: readonly Activity[],
  profile: ReferenceProfile,
): string {
  const activityDescriptions = shortlist
    .map((a) => {
      const parts = [`ID: ${a.id}`, `Title: ${a.title}`, `Description: ${a.description}`];
      if (a.outcome) parts.push(`Outcome: ${a.outcome}`);
      if (a.status) parts.push(`Status: ${a.status}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `You are scoring activities for relevance to a specific intent profile.

Profile: ${profile.key}
Audience: ${profile.audience}

Include criteria (what matters):
${profile.includeCriteria.map((c) => `- ${c}`).join("\n")}

${profile.excludeCriteria.length > 0 ? `Exclude criteria (what to filter out):\n${profile.excludeCriteria.map((c) => `- ${c}`).join("\n")}` : ""}

Score each activity on these five dimensions (0–1, where 1 is highest):

1. **Relevance**: How well does this activity fit the profile's include criteria and avoid the exclude criteria?
2. **Impact**: How much did this activity matter to the project or produce a meaningful outcome?
3. **Novelty**: How interesting, surprising, or non-routine is this activity?
4. **Completion**: How finished or resolved is this activity?
5. **Confidence**: How well-evidenced and concrete is this activity (vs. vague or speculative)?

Activities to score:

${activityDescriptions}

Return a JSON object with a "scores" array containing one entry per activity, in the same order. Each entry must have: activityId (string), relevance (number 0–1), impact (number 0–1), novelty (number 0–1), completion (number 0–1), confidence (number 0–1).`;
}

/**
 * Call the LLM judge to score the shortlist. Returns a map of activityId →
 * dimension scores. The LLM provides raw scores; the caller applies weights.
 */
async function llmJudge(
  shortlist: readonly Activity[],
  profile: ReferenceProfile,
  llmClient: LlmClient,
): Promise<Map<string, Record<ScoreDimension, number>>> {
  if (shortlist.length === 0) return new Map();

  const prompt = buildJudgePrompt(shortlist, profile);
  const response = await llmClient.chatJson({
    messages: [
      { role: "system", content: "You are a relevance scoring engine. Respond only with valid JSON matching the requested schema." },
      { role: "user", content: prompt },
    ],
    schema: LlmScoreResponse,
    purpose: "scoring",
  });

  const scoreMap = new Map<string, Record<ScoreDimension, number>>();
  for (const entry of response.scores) {
    scoreMap.set(entry.activityId, {
      relevance: entry.relevance,
      impact: entry.impact,
      novelty: entry.novelty,
      completion: entry.completion,
      confidence: entry.confidence,
    });
  }
  return scoreMap;
}

export interface MatchOptions {
  /** Number of activities to pass to the LLM judge after embedding pre-filter. Default 12. */
  topK?: number;
}

/**
 * Run the hybrid relevance matching pipeline (PRD "Relevance matching
 * (query time)"): embedding pre-filter → LLM judge → weighted scoring →
 * threshold filtering. Returns selected and dropped activities with full
 * scores so the UI can explain inclusion/exclusion decisions.
 *
 * This stage is range-agnostic — time-range filtering happens in the query
 * path (T13), not here. The caller passes in the activities that fall within
 * the selected window.
 */
export async function matchActivities(
  activities: readonly Activity[],
  profile: ReferenceProfile,
  llmClient: LlmClient,
  embeddingClient: EmbeddingClient,
  options: MatchOptions = {},
): Promise<RelevanceResult> {
  const topK = options.topK ?? 12;

  if (activities.length === 0) {
    return {
      profileKey: profile.key,
      threshold: profile.threshold,
      selected: [],
      dropped: [],
    };
  }

  // Step 1: Embedding pre-filter to top-K
  const shortlistIds = await embeddingPreFilter(
    activities,
    profile,
    embeddingClient,
    topK,
  );
  const shortlist = activities.filter((a) => shortlistIds.includes(a.id));

  // Step 2: LLM judge scores the shortlist
  const scoreMap = await llmJudge(shortlist, profile, llmClient);

  // Step 3: Compute weighted totals and build ActivityScore records
  const scored: ActivityScore[] = shortlist.map((activity) => {
    const dimensions = scoreMap.get(activity.id) ?? {
      relevance: 0,
      impact: 0,
      novelty: 0,
      completion: 0,
      confidence: 0,
    };
    return {
      activityId: activity.id,
      dimensions,
      weightedTotal: computeWeightedTotal(dimensions, profile.scoreWeights),
    };
  });

  // Step 4: Sort by weighted total descending, ties broken by lastActiveTime
  // (deterministic ordering for stable tests and UI).
  const activityMap = new Map(activities.map((a) => [a.id, a]));
  scored.sort((a, b) => {
    if (b.weightedTotal !== a.weightedTotal) {
      return b.weightedTotal - a.weightedTotal;
    }
    const aTime = activityMap.get(a.activityId)?.lastActiveTime ?? "";
    const bTime = activityMap.get(b.activityId)?.lastActiveTime ?? "";
    return bTime.localeCompare(aTime);
  });

  // Step 5: Split into selected (>= threshold) and dropped (< threshold)
  const selected: ActivityScore[] = [];
  const dropped: ActivityScore[] = [];
  for (const score of scored) {
    if (score.weightedTotal >= profile.threshold) {
      selected.push(score);
    } else {
      dropped.push(score);
    }
  }

  return {
    profileKey: profile.key,
    threshold: profile.threshold,
    selected,
    dropped,
  };
}
