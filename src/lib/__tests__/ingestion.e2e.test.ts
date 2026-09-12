import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadActivities } from "../activity-store";
import { StubCognee } from "../cognee";
import { fixtureDocuments, fixtureThreads, noiseDocumentIds } from "../fixtures";
import {
  cannedExtractionResponsesFor,
  cannedThreadActivities,
} from "../fixtures/canned-extraction";
import {
  fixtureIngestionDocuments,
  fixtureRawExports,
} from "../fixtures/raw-exports";
import { loadIngestionCache, runIngestion, type RawExport } from "../ingestion";
import { FakeLlm } from "../llm";

/**
 * E2E (T07): the whole vertical slice — raw fixture exports → adapters →
 * map pass → merge pass → activity store → stubbed Cognee — with the
 * ingestion cache. Asserts only externally observable outcomes: store
 * contents, stub call records, cache behavior. No network, no API keys.
 */

const postmortemExport: RawExport = {
  name: "email-postmortem.json",
  sourceType: "email",
  raw: JSON.stringify({
    threads: [
      {
        threadId: "email-thread-912",
        subject: "Webhook duplicate-charge postmortem published",
        messages: [
          {
            messageId: "postmortem-published",
            from: "dev@example.com",
            to: ["payments-team@example.com"],
            date: "2026-09-11T12:00:00Z",
            subject: "Webhook duplicate-charge postmortem published",
            body: "I wrote up the duplicate-charge incident for the eng wiki: root cause, the processed_events fix, and the alert guardrails we added after it. Publishing it today.",
          },
        ],
      },
    ],
  }),
};

const postmortemExtraction = {
  candidates: [
    {
      id: "candidate-email-postmortem-published",
      documentId: "email-postmortem-published",
      title: "Webhook duplicate-charge postmortem published",
      description: "Candidate event from Webhook duplicate-charge postmortem published.",
      project: "billing-api",
      activityType: "documentation",
      startTime: "2026-09-11T12:00:00Z",
      lastActiveTime: "2026-09-11T12:00:00Z",
      status: "completed",
      technologies: ["Stripe", "Postgres"],
      blockers: [],
      nextSteps: [],
      confidence: 0.8,
    },
  ],
};

const postmortemActivity = {
  id: "activity-postmortem",
  title: "Published the duplicate-charge postmortem",
  description:
    "Wrote up the webhook duplicate-charge incident — root cause, the processed_events fix, and the alert guardrails — and published it to the eng wiki.",
  project: "billing-api",
  activityType: "documentation",
  startTime: "2026-09-11T12:00:00Z",
  lastActiveTime: "2026-09-11T12:00:00Z",
  status: "completed",
  technologies: ["Stripe", "Postgres"],
  blockers: [],
  nextSteps: [],
  beforeState: "The duplicate-charge incident was fixed but not written up.",
  afterState: "The incident, fix, and guardrails are documented on the eng wiki.",
  evidenceIds: ["email-postmortem-published"],
  confidence: 0.8,
};

const tempDirs: string[] = [];

function tempPaths(): { storePath: string; cachePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "yap2graph-t07-"));
  tempDirs.push(dir);
  return {
    storePath: join(dir, "activities.json"),
    cachePath: join(dir, "ingestion-cache.json"),
  };
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/**
 * A FakeLlm pre-loaded for one full pass over the three fixture exports:
 * one extraction response per fixture document (in call order), then the
 * canned merge response.
 */
function llmWithBaseQueue(): FakeLlm {
  const llm = new FakeLlm();
  for (const response of cannedExtractionResponsesFor(
    fixtureIngestionDocuments,
  )) {
    llm.enqueue(response);
  }
  return llm.enqueue({ activities: cannedThreadActivities });
}

function callCount(llm: FakeLlm, purpose: string): number {
  return llm.history.filter((call) => call.purpose === purpose).length;
}

function sortedIds(ids: readonly string[]): string {
  return [...ids].sort().join("\n");
}

describe("runIngestion (e2e)", () => {
  it("ingests the fixture exports end-to-end: adapters → map → merge → store with one Cognee add + cognify", async () => {
    const { storePath, cachePath } = tempPaths();
    const llm = llmWithBaseQueue();
    const cognee = new StubCognee();

    const result = await runIngestion(fixtureRawExports, {
      llm,
      cognee,
      storePath,
      cachePath,
    });

    expect(result.skipped).toBe(false);
    expect(result.documents).toHaveLength(13);
    expect(result.extractedDocuments).toHaveLength(13);

    const corpusById = new Map(
      fixtureDocuments.map((document) => [document.id, document]),
    );
    expect(result.documents.map((d) => d.id).sort()).toEqual(
      [...corpusById.keys()].sort(),
    );
    for (const document of result.documents) {
      const corpus = corpusById.get(document.id);
      expect(corpus, `missing corpus doc ${document.id}`).toBeDefined();
      expect(document.sourceType).toBe(corpus!.sourceType);
      expect(Date.parse(document.timestamp)).toBe(
        Date.parse(corpus!.timestamp),
      );
    }

    expect(callCount(llm, "extraction")).toBe(13);
    expect(result.candidates).toHaveLength(9);
    expect(result.candidates.map((c) => c.documentId).sort()).toEqual(
      fixtureThreads.flatMap((thread) => thread.documentIds).sort(),
    );
    expect(callCount(llm, "merge")).toBe(1);

    const stored = await loadActivities(storePath);
    expect(stored).toHaveLength(3);
    const documentsById = new Map(
      result.documents.map((d) => [d.id, d] as const),
    );
    for (const thread of fixtureThreads) {
      const activity = stored.find(
        (a) => sortedIds(a.evidenceIds) === sortedIds(thread.documentIds),
      );
      expect(activity, `no stored activity for ${thread.id}`).toBeDefined();
      expect(activity!.status).toBe(thread.expectedStatus);
      expect(activity!.beforeState).toBeTruthy();
      expect(activity!.afterState).toBeTruthy();
      const instants = thread.documentIds.map(
        (id) => Date.parse(documentsById.get(id)!.timestamp),
      );
      expect(Date.parse(activity!.startTime)).toBe(Math.min(...instants));
      expect(Date.parse(activity!.lastActiveTime)).toBe(Math.max(...instants));
    }
    for (const activity of stored) {
      for (const noiseId of noiseDocumentIds) {
        expect(activity.evidenceIds).not.toContain(noiseId);
      }
    }

    expect(cognee.addCalls).toHaveLength(1);
    expect(cognee.addCalls[0]).toEqual(fixtureIngestionDocuments);
    expect(cognee.cognifyCallCount).toBe(1);
    expect(result.addedToCognee).toHaveLength(13);
    expect(result.cognified).toBe(true);
  });

  it("performs zero LLM and Cognee work on a second unchanged run (cache hit)", async () => {
    const { storePath, cachePath } = tempPaths();
    await runIngestion(fixtureRawExports, {
      llm: llmWithBaseQueue(),
      cognee: new StubCognee(),
      storePath,
      cachePath,
    });
    const storeBefore = await readFile(storePath, "utf8");

    const llm = new FakeLlm();
    const cognee = new StubCognee();
    const result = await runIngestion(fixtureRawExports, {
      llm,
      cognee,
      storePath,
      cachePath,
    });

    expect(result.skipped).toBe(true);
    expect(llm.history).toHaveLength(0);
    expect(cognee.addCalls).toHaveLength(0);
    expect(cognee.cognifyCallCount).toBe(0);
    expect(result.extractedDocuments).toHaveLength(0);
    expect(result.addedToCognee).toHaveLength(0);
    expect(result.cognified).toBe(false);
    expect(result.activities).toHaveLength(3);
    expect(await readFile(storePath, "utf8")).toBe(storeBefore);

    const cache = await loadIngestionCache(cachePath);
    expect(Object.keys(cache.inputs).sort()).toEqual([
      "chatgpt.json",
      "coding-agent.json",
      "email.json",
    ]);
    expect(Object.keys(cache.addedDocuments)).toHaveLength(13);
  });

  it("re-ingests only a newly added export", async () => {
    const { storePath, cachePath } = tempPaths();
    await runIngestion(fixtureRawExports, {
      llm: llmWithBaseQueue(),
      cognee: new StubCognee(),
      storePath,
      cachePath,
    });

    const llm = new FakeLlm();
    llm.enqueue(postmortemExtraction);
    llm.enqueue({
      activities: [...cannedThreadActivities, postmortemActivity],
    });
    const cognee = new StubCognee();
    const result = await runIngestion([...fixtureRawExports, postmortemExport], {
      llm,
      cognee,
      storePath,
      cachePath,
    });

    expect(result.skipped).toBe(false);
    expect(callCount(llm, "extraction")).toBe(1);
    expect(callCount(llm, "merge")).toBe(1);
    expect(result.extractedDocuments.map((d) => d.id)).toEqual([
      "email-postmortem-published",
    ]);
    expect(result.activities).toHaveLength(4);
    const postmortem = result.activities.find(
      (a) => a.id === "activity-postmortem",
    );
    expect(postmortem).toBeDefined();
    expect(postmortem!.evidenceIds).toEqual(["email-postmortem-published"]);

    expect(cognee.addCalls).toHaveLength(1);
    expect(cognee.addCalls[0].map((d) => d.id)).toEqual([
      "email-postmortem-published",
    ]);
    expect(cognee.cognifyCallCount).toBe(1);
  });

  it("drops activities whose input export disappears (removal path)", async () => {
    const { storePath, cachePath } = tempPaths();
    const setupLlm = new FakeLlm();
    for (const response of cannedExtractionResponsesFor(
      fixtureIngestionDocuments,
    )) {
      setupLlm.enqueue(response);
    }
    setupLlm.enqueue(postmortemExtraction);
    setupLlm.enqueue({
      activities: [...cannedThreadActivities, postmortemActivity],
    });
    await runIngestion([...fixtureRawExports, postmortemExport], {
      llm: setupLlm,
      cognee: new StubCognee(),
      storePath,
      cachePath,
    });

    const llm = new FakeLlm();
    llm.enqueue({ activities: cannedThreadActivities });
    const cognee = new StubCognee();
    const result = await runIngestion(fixtureRawExports, {
      llm,
      cognee,
      storePath,
      cachePath,
    });

    expect(callCount(llm, "extraction")).toBe(0);
    expect(callCount(llm, "merge")).toBe(1);
    expect(result.activities.map((a) => a.id).sort()).toEqual([
      "activity-ci-migration",
      "activity-feed-caching",
      "activity-payment-webhook",
    ]);
    expect(cognee.addCalls).toHaveLength(0);
    expect(cognee.cognifyCallCount).toBe(0);
  });

  it("leaves the previous store intact when the merge pass fails, and a retry succeeds", async () => {
    const { storePath, cachePath } = tempPaths();
    await runIngestion(fixtureRawExports, {
      llm: llmWithBaseQueue(),
      cognee: new StubCognee(),
      storePath,
      cachePath,
    });
    const storeBefore = await readFile(storePath, "utf8");

    const llm = new FakeLlm();
    llm.enqueue(postmortemExtraction);
    llm.enqueueInvalid({ activities: [{ id: "activity-invalid" }] });
    const cognee = new StubCognee();
    await expect(
      runIngestion([...fixtureRawExports, postmortemExport], {
        llm,
        cognee,
        storePath,
        cachePath,
      }),
    ).rejects.toThrow();

    expect(await readFile(storePath, "utf8")).toBe(storeBefore);
    expect(cognee.addCalls).toHaveLength(0);

    const retryLlm = new FakeLlm();
    retryLlm.enqueue(postmortemExtraction);
    retryLlm.enqueue({
      activities: [...cannedThreadActivities, postmortemActivity],
    });
    const retryCognee = new StubCognee();
    const result = await runIngestion(
      [...fixtureRawExports, postmortemExport],
      { llm: retryLlm, cognee: retryCognee, storePath, cachePath },
    );

    expect(callCount(retryLlm, "extraction")).toBe(1);
    expect(result.activities).toHaveLength(4);
    expect(retryCognee.addCalls[0].map((d) => d.id)).toEqual([
      "email-postmortem-published",
    ]);
  });

  it("rejects empty input lists and duplicate export names", async () => {
    const { storePath, cachePath } = tempPaths();
    const deps = {
      llm: new FakeLlm(),
      cognee: new StubCognee(),
      storePath,
      cachePath,
    };
    await expect(runIngestion([], deps)).rejects.toThrow(/no raw exports/);
    await expect(
      runIngestion([...fixtureRawExports, fixtureRawExports[0]!], deps),
    ).rejects.toThrow(/Duplicate raw export name/);
  });

  it("fails loudly on a corrupt cache file without doing any work", async () => {
    const { storePath, cachePath } = tempPaths();
    await writeFile(cachePath, "{ not json", "utf8");

    const llm = new FakeLlm();
    const cognee = new StubCognee();
    await expect(
      runIngestion(fixtureRawExports, { llm, cognee, storePath, cachePath }),
    ).rejects.toThrow(/corrupt or incompatible/);
    expect(llm.history).toHaveLength(0);
  });

  it("rebuilds a missing store from the cache without re-extracting or re-adding to Cognee", async () => {
    const { storePath, cachePath } = tempPaths();
    await runIngestion(fixtureRawExports, {
      llm: llmWithBaseQueue(),
      cognee: new StubCognee(),
      storePath,
      cachePath,
    });
    await rm(storePath);

    const llm = new FakeLlm();
    llm.enqueue({ activities: cannedThreadActivities });
    const cognee = new StubCognee();
    const result = await runIngestion(fixtureRawExports, {
      llm,
      cognee,
      storePath,
      cachePath,
    });

    expect(result.skipped).toBe(false);
    expect(callCount(llm, "extraction")).toBe(0);
    expect(callCount(llm, "merge")).toBe(1);
    expect(cognee.addCalls).toHaveLength(0);
    expect(cognee.cognifyCallCount).toBe(0);
    expect(await loadActivities(storePath)).toHaveLength(3);
  });
});
