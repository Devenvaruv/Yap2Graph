import { z } from "zod";
import { RealCogneeClient, type CogneeSearchResult, type CogneeSearchType } from "@/lib/cognee";
import { OpenAiLlmClient } from "@/lib/llm";
import { getReferenceProfile } from "@/lib/profiles";
import { IntentKeySchema, TimeRangeKeySchema, TIME_RANGES } from "@/lib/reference";
import { resolveTimeRange } from "@/lib/time-range";

const DraftRequest = z
  .object({
    profileKey: IntentKeySchema,
    timeRangeKey: TimeRangeKeySchema.exclude(["custom"]),
  })
  .strict();

const DraftModelOutput = z
  .object({
    title: z.string().min(1),
    markdown: z.string().min(1),
  })
  .strict();

type DraftSource = {
  documentId: string | null;
  excerpt: string;
};

const MAX_SOURCES = 10;

const HUMANIZER_GUIDANCE = [
  "Rewrite AI-sounding retrieved snippets into natural human prose.",
  "Keep only what the sources support. Do not invent facts, metrics, dates, names, or outcomes.",
  "Remove chunk/meta language such as 'This chunk is about', 'This discusses', and 'linked to'.",
  "Avoid chatbot residue, staged openers, one-line closers, sales language, decorative bold labels, forced triads, and em dashes.",
  "Use plain first-person language when the selected profile is personal or social.",
].join(" ");

function uniqueSources(results: readonly CogneeSearchResult[]): DraftSource[] {
  const seen = new Set<string>();
  const sources: DraftSource[] = [];

  for (const result of results) {
    const excerpt = result.excerpt.trim();
    if (!excerpt) continue;

    const key = `${result.documentId ?? "unknown"}:${excerpt.slice(0, 220)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ documentId: result.documentId, excerpt });
    if (sources.length >= MAX_SOURCES) break;
  }

  return sources;
}

function searchQuery(profileKey: z.infer<typeof IntentKeySchema>): string {
  const profile = getReferenceProfile(profileKey);
  return [
    profile.audience,
    ...profile.includeCriteria,
    "ChatGPT Codex email recent work decisions blockers progress outcomes",
  ].join("\n");
}

function fallbackDraft(
  profileKey: z.infer<typeof IntentKeySchema>,
  timeRangeKey: z.infer<typeof TimeRangeKeySchema>,
  sources: readonly DraftSource[],
): { title: string; markdown: string } {
  const profile = getReferenceProfile(profileKey);
  const rangeLabel = TIME_RANGES.find((range) => range.key === timeRangeKey)?.label ?? timeRangeKey;
  const bullets = sources
    .slice(0, 6)
    .map((source) => {
      const excerpt = humanizeExcerpt(source.excerpt);
      return excerpt ? `- ${excerpt}${source.excerpt.length > 280 ? "..." : ""}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return {
    title: `${profile.audience} draft`,
    markdown:
      `## ${rangeLabel}\n\n` +
      (bullets ||
        "No matching Cognee snippets came back for this profile yet. Run live ingestion and cognify again, then retry."),
  };
}

function humanizeExcerpt(excerpt: string): string {
  return excerpt
    .replace(/\s+/g, " ")
    .replace(/^This chunk is about\s+/i, "")
    .replace(/^This chunk discusses\s+/i, "")
    .replace(/^This chunk covers\s+/i, "")
    .replace(/^This discusses\s+/i, "")
    .replace(/^This is about\s+/i, "")
    .replace(/^The chunk is about\s+/i, "")
    .trim()
    .replace(/^[Tt]he /, "The ")
    .slice(0, 280);
}

async function safeSearch(
  cognee: RealCogneeClient,
  query: string,
  type: CogneeSearchType,
): Promise<{ results: CogneeSearchResult[]; error?: string }> {
  try {
    return { results: await cognee.search(query, type) };
  } catch (err) {
    return { results: [], error: `${type}: ${(err as Error).message}` };
  }
}

async function modelDraft(params: {
  profileKey: z.infer<typeof IntentKeySchema>;
  timeRangeKey: z.infer<typeof TimeRangeKeySchema>;
  sources: readonly DraftSource[];
  apiKey: string;
}): Promise<{ title: string; markdown: string }> {
  const { profileKey, timeRangeKey, sources, apiKey } = params;
  const profile = getReferenceProfile(profileKey);
  const timeRange = resolveTimeRange(timeRangeKey, new Date());
  const llm = new OpenAiLlmClient({ apiKey });
  const sourceText = sources
    .map(
      (source, index) =>
        `Source ${index + 1}${source.documentId ? ` (${source.documentId})` : ""}:\n${source.excerpt}`,
    )
    .join("\n\n---\n\n");

  return llm.chatJson({
    purpose: "generation",
    schema: DraftModelOutput,
    schemaHint: '{"title": string, "markdown": string}',
    messages: [
      {
        role: "system",
        content: HUMANIZER_GUIDANCE,
      },
      {
        role: "user",
        content: `The text below comes from Cognee search snippets. Some snippets are meta summaries, not reader-facing prose. Infer only the supported work themes and rewrite them as a human-readable draft.

Profile key: ${profile.key}
Audience: ${profile.audience}
Sections to cover when relevant: ${profile.sections.join(", ")}
Output constraints: ${profile.outputConstraints}
Time range: ${timeRange.start} to ${timeRange.end}

Cognee snippets:
${sourceText || "(none)"}

Return JSON with:
- title: a short natural title, not a decorative heading.
- markdown: the finished reader-facing draft only.

Rules:
- Do not write "This chunk", "the sources", "Cognee", "retrieved snippets", or anything about the drafting process.
- Do not prefix literal markdown characters with backslashes.
- If writing a LinkedIn post, make it sound like one real update from me, in first person, without hashtags.
- If the snippets are too mixed to support one post, write a short honest update about the main supported work and leave out unrelated snippets.`,
      },
    ],
  });
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = DraftRequest.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((issue) => issue.message).join("; ") },
      { status: 400 },
    );
  }

  const apiUrl = process.env.COGNEE_API_URL ?? "http://localhost:8010";
  const datasetName = process.env.COGNEE_DATASET_NAME ?? "main_dataset";
  const cognee = new RealCogneeClient({ apiUrl, datasetName });
  const query = searchQuery(parsed.data.profileKey);

  const [summaryResults, chunkResults] = await Promise.all([
    safeSearch(cognee, query, "summaries"),
    safeSearch(cognee, query, "chunks"),
  ]);

  if (
    summaryResults.results.length === 0 &&
    chunkResults.results.length === 0 &&
    summaryResults.error &&
    chunkResults.error
  ) {
    return Response.json(
      { error: `Cognee search failed: ${summaryResults.error}; ${chunkResults.error}` },
      { status: 502 },
    );
  }
  const sources = uniqueSources([...summaryResults.results, ...chunkResults.results]);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  let usedModel = false;
  let modelError: string | undefined;
  let draft = fallbackDraft(parsed.data.profileKey, parsed.data.timeRangeKey, sources);

  if (apiKey) {
    try {
      draft = await modelDraft({ ...parsed.data, sources, apiKey });
      usedModel = true;
    } catch (err) {
      console.error("OpenAI draft polish failed:", err);
      modelError = "OpenAI polish failed; showing a Cognee extractive draft.";
    }
  }

  return Response.json({
    ...draft,
    sources,
    usedModel,
    modelError,
  });
}
