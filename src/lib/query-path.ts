import { z } from "zod";
import { DEFAULT_ACTIVITY_STORE_PATH, loadActivities } from "./activity-store";
import { GenerationError, generateOutput } from "./generation";
import type { Evidence } from "./evidence";
import { retrieveEvidence } from "./evidence";
import type { EmbeddingClient, LlmClient } from "./llm";
import { getReferenceProfile } from "./profiles";
import { matchActivities, type ActivityScore } from "./relevance";
import { IntentKeySchema, TimeRangeKeySchema } from "./reference";
import { GeneratedOutput } from "./schemas";
import type {
  Activity,
  SourceDocument,
  TimeRange,
} from "./schemas";
import { filterActivitiesByTimeRange, resolveTimeRange } from "./time-range";
import type { CogneeClient } from "./cognee";

/**
 * Request contract for the generate route (T13): profile key + time range.
 * `customStart`/`customEnd` are ISO-8601 instants required exactly when
 * `timeRangeKey` is "custom" — the semantic validation (parseable ISO,
 * start ≤ end) happens once, in {@link resolveTimeRange}.
 */
export const GenerateRequest = z
  .object({
    profileKey: IntentKeySchema,
    timeRangeKey: TimeRangeKeySchema,
    customStart: z.string().optional(),
    customEnd: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.timeRangeKey === "custom") {
      if (!value.customStart || !value.customEnd) {
        ctx.addIssue({
          code: "custom",
          path: ["customStart"],
          message:
            'customStart and customEnd are required when timeRangeKey is "custom".',
        });
      }
    } else if (value.customStart !== undefined || value.customEnd !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["customStart"],
        message:
          'customStart/customEnd are only valid when timeRangeKey is "custom".',
      });
    }
  });
export type GenerateRequest = z.infer<typeof GenerateRequest>;

/** An activity paired with its relevance score, for the "Activities used" pane (T14). */
export interface ActivitySelection {
  activity: Activity;
  score: ActivityScore;
}

/**
 * Response envelope, decided once for T13 and shaped for T14: the generated
 * output, the activities generation was allowed to draw on (selected), and
 * the in-range activities relevance dropped below threshold (dropped).
 */
export interface GenerateResponse {
  output: GeneratedOutput;
  selectedActivities: ActivitySelection[];
  droppedActivities: ActivitySelection[];
}

export type QueryPathErrorCode =
  | "invalid-request"
  | "missing-credentials"
  | "store-not-ready"
  | "generation-failed";

/** Route-mappable pipeline failure: `status` is the HTTP status to return. */
export class QueryPathError extends Error {
  readonly code: QueryPathErrorCode;
  readonly status: number;

  constructor(code: QueryPathErrorCode, message: string, status: number) {
    super(message);
    this.name = "QueryPathError";
    this.code = code;
    this.status = status;
  }
}

/** Parse and validate an untrusted request body. Throws {@link QueryPathError} on failure. */
export function parseGenerateRequest(body: unknown): GenerateRequest {
  const parsed = GenerateRequest.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new QueryPathError("invalid-request", `Invalid request: ${issues}`, 400);
  }
  return parsed.data;
}

/** Injectable dependencies — every client is a seam; tests pass fakes. */
export interface QueryPathDeps {
  llm: LlmClient;
  embeddings: EmbeddingClient;
  cognee: CogneeClient;
  corpus: readonly SourceDocument[];
  storePath?: string;
  now?: Date;
}

function toSelection(
  scores: readonly ActivityScore[],
  activitiesById: ReadonlyMap<string, Activity>,
): ActivitySelection[] {
  return scores.flatMap((score) => {
    const activity = activitiesById.get(score.activityId);
    return activity ? [{ activity, score }] : [];
  });
}

function emptyOutput(profileKey: string, timeRange: TimeRange, sections: readonly string[]): GeneratedOutput {
  return GeneratedOutput.parse({
    profileKey,
    timeRange,
    sections: sections.map((title) => ({ title, claims: [] })),
  });
}

/**
 * Run the complete query path (T13): profile selection → time-range filtering
 * → relevance matching (T10) → evidence retrieval (T11) → one generation call
 * (T12). Query time never ingests: the pre-ingested activity store is read
 * as-is, and a missing or empty store fails with the actionable "run ingest
 * first" error instead of triggering ingestion.
 *
 * Call budget: one embedding batch, one relevance LLM call, two searches per
 * selected activity, one generation call. The single exception is an empty
 * selection (no in-range activities, or everything below threshold): the only
 * citation-gate-passing output then is the profile's sections with zero
 * claims, which is constructed in code rather than paid for as an LLM call
 * that cannot return anything else.
 */
export async function runQueryPath(
  request: GenerateRequest,
  deps: QueryPathDeps,
): Promise<GenerateResponse> {
  const profile = getReferenceProfile(request.profileKey);

  let activities: Activity[];
  try {
    activities = await loadActivities(deps.storePath ?? DEFAULT_ACTIVITY_STORE_PATH);
  } catch (err) {
    throw new QueryPathError(
      "store-not-ready",
      `No readable activity store at "${deps.storePath ?? DEFAULT_ACTIVITY_STORE_PATH}" — run "npm run ingest" first. (${(err as Error).message})`,
      503,
    );
  }
  if (activities.length === 0) {
    throw new QueryPathError(
      "store-not-ready",
      `The activity store at "${deps.storePath ?? DEFAULT_ACTIVITY_STORE_PATH}" is empty — run "npm run ingest" first.`,
      503,
    );
  }

  let timeRange: TimeRange;
  try {
    timeRange = resolveTimeRange(
      request.timeRangeKey,
      deps.now ?? new Date(),
      request.timeRangeKey === "custom"
        ? { start: request.customStart!, end: request.customEnd! }
        : undefined,
    );
  } catch (err) {
    throw new QueryPathError("invalid-request", (err as Error).message, 400);
  }

  const { inRange } = filterActivitiesByTimeRange(activities, timeRange);
  const activitiesById = new Map(inRange.map((activity) => [activity.id, activity]));

  const relevance = await matchActivities(inRange, profile, deps.llm, deps.embeddings);
  const selected = toSelection(relevance.selected, activitiesById);
  const dropped = toSelection(relevance.dropped, activitiesById);

  if (selected.length === 0) {
    return {
      output: emptyOutput(profile.key, timeRange, profile.sections),
      selectedActivities: [],
      droppedActivities: dropped,
    };
  }

  const evidence: Evidence[] = await retrieveEvidence(
    selected.map((entry) => entry.activity),
    deps.corpus,
    deps.cognee,
  );

  let output: GeneratedOutput;
  try {
    output = await generateOutput({
      profile,
      timeRange,
      selected,
      evidence,
      llm: deps.llm,
    });
  } catch (err) {
    if (err instanceof GenerationError) {
      throw new QueryPathError("generation-failed", err.message, 502);
    }
    throw err;
  }

  return {
    output,
    selectedActivities: selected,
    droppedActivities: dropped,
  };
}
