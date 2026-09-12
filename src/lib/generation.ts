import type { Evidence } from "./evidence";
import type { ChatMessage, LlmClient } from "./llm";
import type { ActivityScore } from "./relevance";
import {
  GeneratedOutput,
  type Activity,
  type ReferenceProfile,
  type TimeRange,
} from "./schemas";

/**
 * An activity T10 selected, paired with its score. The generation prompt
 * shows the weightedTotal so the model can lead with the most relevant work;
 * the gate never uses it.
 */
export interface SelectedActivity {
  activity: Activity;
  score: ActivityScore;
}

/**
 * Loud failure after the single repair retry is exhausted. `violations` is
 * empty only when both attempts failed at the schema/transport level before
 * the integrity gate could run.
 */
export class GenerationError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[], lastError: string) {
    super(
      `Generation failed citation integrity after one repair attempt. ` +
        `Last error: ${lastError}`,
    );
    this.name = "GenerationError";
    this.violations = violations;
  }
}

/**
 * Citation-integrity + structural gate, asserted in code on every generation
 * (PRD: "asserted, not hoped for"). Returns human-readable violations; an
 * empty array means the output is safe to emit.
 *
 * Policy, decided once and enforced here (T14's clickability depends on the
 * uniformity): EVERY claim must carry at least one evidence id — connective
 * or introductory text is not exempt, because an uncited claim is a claim
 * the evidence drawer cannot open. The Claim schema permits empty
 * evidenceIds; this gate is the code-level policy the schema defers to.
 *
 * Checks:
 * - profileKey and timeRange match what was requested;
 * - section titles equal the profile's sections, same order;
 * - every claim has ≥ 1 evidence id;
 * - every evidence id resolves to a record in the supplied pool — an id
 *   belonging to an unselected/below-threshold activity is dangling by
 *   construction, because its evidence was never supplied.
 */
export function checkCitationIntegrity(
  output: GeneratedOutput,
  profile: ReferenceProfile,
  timeRange: TimeRange,
  evidence: readonly Evidence[],
): string[] {
  const violations: string[] = [];

  if (output.profileKey !== profile.key) {
    violations.push(
      `profileKey is "${output.profileKey}" but the requested profile is "${profile.key}".`,
    );
  }
  if (
    output.timeRange.start !== timeRange.start ||
    output.timeRange.end !== timeRange.end
  ) {
    violations.push(
      `timeRange ${output.timeRange.start}→${output.timeRange.end} does not match the requested ${timeRange.start}→${timeRange.end}.`,
    );
  }

  const expectedTitles = profile.sections.join("\n");
  const actualTitles = output.sections.map((s) => s.title).join("\n");
  if (actualTitles !== expectedTitles) {
    violations.push(
      `sections must be exactly the profile's sections in order: ${profile.sections.map((s) => `"${s}"`).join(", ")}.`,
    );
  }

  const poolIds = new Set(evidence.map((record) => record.id));
  output.sections.forEach((section, sectionIndex) => {
    section.claims.forEach((claim, claimIndex) => {
      const where = `section ${sectionIndex + 1} ("${section.title}"), claim ${claimIndex + 1}`;
      if (claim.evidenceIds.length === 0) {
        violations.push(
          `${where}: claim has no evidence ids — every claim must cite at least one evidence id.`,
        );
      }
      for (const id of claim.evidenceIds) {
        if (!poolIds.has(id)) {
          violations.push(
            `${where}: evidence id "${id}" does not resolve to any record in the supplied evidence pool.`,
          );
        }
      }
    });
  });

  return violations;
}

function describeActivity(selected: SelectedActivity): string {
  const { activity, score } = selected;
  const parts = [
    `ID: ${activity.id}`,
    `Title: ${activity.title}`,
    `Status: ${activity.status}`,
    `Relevance score: ${score.weightedTotal.toFixed(2)}`,
    `Description: ${activity.description}`,
  ];
  if (activity.technologies.length > 0) {
    parts.push(`Technologies: ${activity.technologies.join(", ")}`);
  }
  if (activity.beforeState || activity.afterState) {
    parts.push(
      `Before → after: ${activity.beforeState ?? "(unknown)"} → ${activity.afterState ?? "(unknown)"}`,
    );
  }
  if (activity.outcome) parts.push(`Outcome: ${activity.outcome}`);
  if (activity.blockers.length > 0) {
    parts.push(`Blockers: ${activity.blockers.join("; ")}`);
  }
  if (activity.nextSteps.length > 0) {
    parts.push(`Next steps: ${activity.nextSteps.join("; ")}`);
  }
  return parts.join("\n");
}

function describeEvidence(record: Evidence): string {
  return [
    `ID: ${record.id}`,
    `Activity: ${record.activityId}`,
    `Source: ${record.sourceType} — ${record.title}`,
    `Excerpt: ${record.excerpt}`,
  ].join("\n");
}

/**
 * Build the generation prompt. The model receives everything it needs to
 * write citable claims — activities with before/after state, outcome,
 * blockers, next steps, and the evidence pool with exact ids to cite.
 */
function buildGenerationMessages(
  profile: ReferenceProfile,
  timeRange: TimeRange,
  selected: readonly SelectedActivity[],
  evidence: readonly Evidence[],
): ChatMessage[] {
  const sections = profile.sections.map((s) => `- ${s}`).join("\n");
  const include = profile.includeCriteria.map((c) => `- ${c}`).join("\n");
  const exclude = profile.excludeCriteria.map((c) => `- ${c}`).join("\n");
  const activities = selected.map(describeActivity).join("\n\n---\n\n");
  const pool = evidence.map(describeEvidence).join("\n\n---\n\n");

  return [
    {
      role: "system",
      content:
        "You are a structured report generator. You respond only with valid JSON matching the requested schema. Every claim you write must cite the evidence it rests on by exact evidence id — never invent an id, never cite evidence that is not in the pool.",
    },
    {
      role: "user",
      content: `Generate a structured report for the profile below.

## Profile
Key: ${profile.key}
Audience: ${profile.audience}

Sections — use these EXACT titles, in this order, one entry per title:
${sections}

Include criteria (what matters):
${include}

${exclude ? `Exclude criteria (what to leave out):\n${exclude}\n\n` : ""}Output constraints (tone, length, framing — honor these):
${profile.outputConstraints}

## Time range
${timeRange.start} → ${timeRange.end}

## Selected activities (the only work this report may cover)
${activities || "(none)"}

## Evidence pool (the only ids a claim may cite)
${pool || "(none)"}

## Citation rules — mandatory
- Every claim MUST carry at least one evidence id from the pool, cited by the exact id string.
- Only cite evidence that supports the claim; the reader will open the cited evidence for every claim.
- Write the claim text as markdown suitable for the audience and constraints above.
- Return JSON matching the requested schema: profileKey "${profile.key}", the requested timeRange, and sections in the profile's order.`,
    },
  ];
}

/**
 * Generate the final structured output (T12): sections → claims, each claim
 * markdown plus evidence ids, validated by Zod and passed through the
 * citation-integrity gate. Free-form text is never accepted — the LLM seam
 * only returns schema-validated JSON, and this function throws rather than
 * emit output with dangling or missing citations.
 *
 * Profile-agnostic by design (user story 31): the same code path serves all
 * six profiles; only the inputs differ.
 *
 * Failure contract: an unusable first response (schema rejection from the
 * client, or an integrity-gate violation) triggers EXACTLY ONE repair retry
 * whose extra message includes the validation error, then fails loudly with
 * {@link GenerationError}. Output with dangling ids is never returned.
 */
export async function generateOutput(params: {
  profile: ReferenceProfile;
  timeRange: TimeRange;
  selected: readonly SelectedActivity[];
  evidence: readonly Evidence[];
  llm: LlmClient;
}): Promise<GeneratedOutput> {
  const { profile, timeRange, selected, evidence, llm } = params;

  let messages = buildGenerationMessages(profile, timeRange, selected, evidence);
  let lastViolations: string[] = [];
  let lastError = "";

  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt === 1) {
      messages = [
        ...messages,
        {
          role: "user",
          content:
            `Your previous response was rejected. Fix it and return ONLY valid JSON matching the schema.\n\n` +
            (lastViolations.length > 0
              ? `Validation errors:\n${lastViolations.map((v) => `- ${v}`).join("\n")}`
              : `Error: ${lastError}`),
        },
      ];
    }

    let output: GeneratedOutput;
    try {
      output = await llm.chatJson({
        messages,
        schema: GeneratedOutput,
        purpose: "generation",
        schemaHint:
          '{"profileKey": string, "timeRange": {"start": ISO8601, "end": ISO8601}, "sections": [{"title": string, "claims": [{"markdown": string, "evidenceIds": string[]}]}]}',
      });
    } catch (err) {
      lastError = (err as Error).message;
      lastViolations = [];
      continue;
    }

    const violations = checkCitationIntegrity(output, profile, timeRange, evidence);
    if (violations.length === 0) return output;
    lastViolations = violations;
    lastError = violations.join("; ");
  }

  throw new GenerationError(lastViolations, lastError);
}
