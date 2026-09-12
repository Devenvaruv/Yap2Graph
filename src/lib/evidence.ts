import { z } from "zod";
import type { CogneeClient } from "./cognee";
import { SOURCE_TYPES, type Activity, type SourceDocument } from "./schemas";

const isoTimestamp = z.string().datetime({ offset: true });

/**
 * One retrieved evidence excerpt backing a selected activity (T11). The
 * provenance card T14 renders and T12 cites: adapter-provided source
 * metadata + the Cognee-retrieved excerpt + the activity it supports.
 *
 * `id` is deterministic (`{activityId}:{documentId}:{chunkIndex}`) so T12's
 * citation-resolution assertion is reliable, and evidence is activity-scoped
 * by design — the same excerpt retrieved for two activities exists twice,
 * once per activity.
 */
export const Evidence = z
  .object({
    id: z.string().min(1),
    activityId: z.string().min(1),
    documentId: z.string().min(1),
    sourceType: z.enum(SOURCE_TYPES),
    title: z.string().min(1),
    timestamp: isoTimestamp,
    participants: z.array(z.string()),
    excerpt: z.string().min(1),
  })
  .strict();
export type Evidence = z.infer<typeof Evidence>;

/**
 * Build the per-activity search seed: title, description, technologies, and
 * outcome give Cognee's semantic search enough signal to find the thread's
 * documents without dragging in unrelated noise.
 */
function buildSearchSeed(activity: Activity): string {
  const parts = [activity.title, activity.description];
  if (activity.technologies.length > 0) {
    parts.push(activity.technologies.join(", "));
  }
  if (activity.outcome) parts.push(activity.outcome);
  return parts.join("\n");
}

/**
 * Retrieve evidence from Cognee seeded per selected activity (T11). For each
 * activity, search runs with both summaries and chunks query types seeded by
 * that activity; results map back to corpus documents.
 *
 * Integrity guarantees, enforced here so no dangling id ever reaches
 * generation (T12 asserts them again at its boundary):
 * - a record exists only if its `documentId` resolves to a document in the
 *   ingested corpus AND its excerpt came back from Cognee — anything else is
 *   dropped, never surfaced as unresolvable evidence;
 * - an activity whose search returns nothing yields zero evidence without
 *   failing the whole retrieval;
 * - exact duplicate excerpts (same document + same text, e.g. returned by
 *   both query types) collapse to one record per activity.
 *
 * Records are returned flat in activity order, then per-activity retrieval
 * order (summaries before chunks) — deterministic for stable tests and UI.
 */
export async function retrieveEvidence(
  activities: readonly Activity[],
  corpus: readonly SourceDocument[],
  cognee: CogneeClient,
): Promise<Evidence[]> {
  const documentsById = new Map(corpus.map((document) => [document.id, document]));
  const records: Evidence[] = [];

  for (const activity of activities) {
    const seed = buildSearchSeed(activity);
    const summaries = await cognee.search(seed, "summaries");
    const chunks = await cognee.search(seed, "chunks");

    const seenExcerpts = new Set<string>();
    let chunkIndex = 0;
    for (const result of [...summaries, ...chunks]) {
      if (result.documentId === null) continue;
      const document = documentsById.get(result.documentId);
      if (!document) continue;
      if (result.excerpt.trim().length === 0) continue;

      const dedupKey = `${document.id}::${result.excerpt}`;
      if (seenExcerpts.has(dedupKey)) continue;
      seenExcerpts.add(dedupKey);

      records.push(
        Evidence.parse({
          id: `${activity.id}:${document.id}:${chunkIndex}`,
          activityId: activity.id,
          documentId: document.id,
          sourceType: document.sourceType,
          title: document.title,
          timestamp: document.timestamp,
          participants: document.participants,
          excerpt: result.excerpt,
        }),
      );
      chunkIndex += 1;
    }
  }

  return records;
}
