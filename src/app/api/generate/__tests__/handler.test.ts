import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { saveActivities } from "@/lib/activity-store";
import { StubCognee, type CogneeSearchResult } from "@/lib/cognee";
import { cannedThreadActivities } from "@/lib/fixtures/canned-extraction";
import { fixtureDocuments } from "@/lib/fixtures";
import { FakeEmbeddings, FakeLlm } from "@/lib/llm";
import { getReferenceProfile } from "@/lib/profiles";
import type { GenerateResponse } from "@/lib/query-path";
import type { QueryPathDeps } from "@/lib/query-path";
import { handleGenerateRequest } from "../handler";

/**
 * T13 route-level integration tests: the full query path (profile selection
 * → time-range filtering → relevance → evidence retrieval → generation)
 * behind the exact HTTP contract POST /api/generate uses. All clients are
 * fakes — zero live API calls — and the activity store is a temp-file copy of
 * the fixture week, so these tests double as the fixture-backed golden path.
 */

const NOW = new Date("2026-09-12T10:30:00Z");
const standupProfile = getReferenceProfile("standup");
const LAST_7_DAYS_RANGE = {
  start: "2026-09-06T00:00:00.000Z",
  end: "2026-09-12T23:59:59.999Z",
};

const tempDirs: string[] = [];

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "yap2graph-t13-"));
  tempDirs.push(dir);
  return join(dir, "activities.json");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Fixture {
  llm: FakeLlm;
  embeddings: FakeEmbeddings;
  cognee: StubCognee;
  storePath: string;
}

async function fixtureStore(activities = cannedThreadActivities): Promise<string> {
  const storePath = tempStorePath();
  await saveActivities(activities, storePath);
  return storePath;
}

function depsFor(fixture: Fixture): QueryPathDeps {
  return {
    llm: fixture.llm,
    embeddings: fixture.embeddings,
    cognee: fixture.cognee,
    corpus: fixtureDocuments,
    storePath: fixture.storePath,
    now: NOW,
  };
}

/** All five dimensions equal → weightedTotal equals that value for any weights. */
function scoringResponse(entries: Array<{ activityId: string; value: number }>) {
  return {
    scores: entries.map((entry) => ({
      activityId: entry.activityId,
      relevance: entry.value,
      impact: entry.value,
      novelty: entry.value,
      completion: entry.value,
      confidence: entry.value,
    })),
  };
}

function searchResult(documentId: string, excerpt: string): CogneeSearchResult {
  return { documentId, excerpt };
}

describe("POST /api/generate (handler with fakes injected)", () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns the response envelope for standup + last-7-days against the fixture store", async () => {
    const storePath = await fixtureStore();
    const llm = new FakeLlm();
    const cognee = new StubCognee();

    llm.enqueue(
      scoringResponse([
        { activityId: "activity-payment-webhook", value: 0.9 },
        { activityId: "activity-feed-caching", value: 0.8 },
        { activityId: "activity-ci-migration", value: 0.3 },
      ]),
    );
    llm.enqueue({
      profileKey: "standup",
      timeRange: LAST_7_DAYS_RANGE,
      sections: [
        {
          title: "Completed",
          claims: [
            {
              markdown: "- Fixed duplicate Stripe webhook charges in billing-api.",
              evidenceIds: ["activity-payment-webhook:chatgpt-webhook-retry:0"],
            },
            {
              markdown: "- Added a Redis cache layer to the mobile-backend feed endpoint.",
              evidenceIds: ["activity-feed-caching:chatgpt-feed-cache:0"],
            },
          ],
        },
        { title: "In progress", claims: [] },
        { title: "Blockers", claims: [] },
        {
          title: "Next steps",
          claims: [
            {
              markdown: "- Monitor duplicate-charge metrics after the webhook fix.",
              evidenceIds: ["activity-payment-webhook:email-webhook-shipped:2"],
            },
          ],
        },
      ],
    });

    // Per selected activity, in relevance order: summaries search, then chunks.
    cognee
      .enqueueSearchResults([
        searchResult("chatgpt-webhook-retry", "Root cause: Stripe retries re-processed events."),
        searchResult("codex-webhook-idempotency", "Added processed_events transactional check."),
      ])
      .enqueueSearchResults([
        searchResult("email-webhook-shipped", "Webhook fix is live; zero duplicate charges."),
      ])
      .enqueueSearchResults([
        searchResult("chatgpt-feed-cache", "Chose Redis over a materialized view for the feed."),
      ])
      .enqueueSearchResults([
        searchResult("codex-feed-redis", "Implemented 60s write-invalidated Redis cache."),
        searchResult("email-feed-latency", "Feed p95 is 90ms in production."),
      ]);

    const response = await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "last-7-days" }),
      depsFor({ llm, embeddings: new FakeEmbeddings(), cognee, storePath }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as GenerateResponse;

    expect(body.output.profileKey).toBe("standup");
    expect(body.output.timeRange).toEqual(LAST_7_DAYS_RANGE);
    expect(body.output.sections.map((s) => s.title)).toEqual(standupProfile.sections);

    expect(body.selectedActivities.map((entry) => entry.activity.id)).toEqual([
      "activity-payment-webhook",
      "activity-feed-caching",
    ]);
    expect(body.selectedActivities[0]!.score.weightedTotal).toBeCloseTo(0.9, 5);
    expect(body.selectedActivities[1]!.score.weightedTotal).toBeCloseTo(0.8, 5);
    expect(body.droppedActivities.map((entry) => entry.activity.id)).toEqual([
      "activity-ci-migration",
    ]);
    expect(body.droppedActivities[0]!.score.weightedTotal).toBeCloseTo(0.3, 5);
  });

  it("stays within the call budget and performs no ingestion work", async () => {
    const storePath = await fixtureStore();
    const llm = new FakeLlm();
    const embeddings = new FakeEmbeddings();
    const cognee = new StubCognee();

    llm.enqueue(
      scoringResponse([
        { activityId: "activity-payment-webhook", value: 0.9 },
        { activityId: "activity-feed-caching", value: 0.8 },
        { activityId: "activity-ci-migration", value: 0.3 },
      ]),
    );
    llm.enqueue({
      profileKey: "standup",
      timeRange: LAST_7_DAYS_RANGE,
      sections: [
        {
          title: "Completed",
          claims: [
            {
              markdown: "- Fixed duplicate Stripe webhook charges.",
              evidenceIds: ["activity-payment-webhook:chatgpt-webhook-retry:0"],
            },
          ],
        },
        { title: "In progress", claims: [] },
        { title: "Blockers", claims: [] },
        { title: "Next steps", claims: [] },
      ],
    });
    cognee
      .enqueueSearchResults([searchResult("chatgpt-webhook-retry", "Retry storm root cause.")])
      .enqueueSearchResults([searchResult("email-webhook-shipped", "Fix is live.")])
      .enqueueSearchResults([searchResult("chatgpt-feed-cache", "Redis decision.")])
      .enqueueSearchResults([searchResult("codex-feed-redis", "Cache implementation.")]);

    const response = await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "last-7-days" }),
      depsFor({ llm, embeddings, cognee, storePath }),
    );
    expect(response.status).toBe(200);

    expect(embeddings.history).toHaveLength(1);
    expect(llm.history.map((call) => call.purpose)).toEqual(["scoring", "generation"]);
    expect(cognee.searchCalls).toHaveLength(4);
    expect(cognee.addCalls).toHaveLength(0);
    expect(cognee.cognifyCallCount).toBe(0);
    expect(cognee.searchCalls.map((call) => call.type)).toEqual([
      "summaries",
      "chunks",
      "summaries",
      "chunks",
    ]);
  });

  it("filters activities out of the time range before relevance (today has no fixture activity)", async () => {
    const storePath = await fixtureStore();
    const llm = new FakeLlm();
    const embeddings = new FakeEmbeddings();
    const cognee = new StubCognee();

    const response = await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "today" }),
      depsFor({ llm, embeddings, cognee, storePath }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as GenerateResponse;
    expect(body.selectedActivities).toEqual([]);
    expect(body.droppedActivities).toEqual([]);
    expect(body.output.sections.map((s) => s.title)).toEqual(standupProfile.sections);
    expect(body.output.sections.every((s) => s.claims.length === 0)).toBe(true);

    // Nothing reached relevance, evidence retrieval, or generation.
    expect(embeddings.history).toHaveLength(0);
    expect(llm.history).toHaveLength(0);
    expect(cognee.searchCalls).toHaveLength(0);
  });

  it("runs a custom range through the pipeline end-to-end", async () => {
    const storePath = await fixtureStore();
    const llm = new FakeLlm();
    const cognee = new StubCognee();
    const customRange = { start: "2026-09-07T00:00:00Z", end: "2026-09-07T23:59:59Z" };

    llm.enqueue(
      scoringResponse([{ activityId: "activity-payment-webhook", value: 0.9 }]),
    );
    llm.enqueue({
      profileKey: "standup",
      timeRange: customRange,
      sections: [
        {
          title: "Completed",
          claims: [
            {
              markdown: "- Fixed duplicate Stripe webhook charges in billing-api.",
              evidenceIds: ["activity-payment-webhook:chatgpt-webhook-retry:0"],
            },
          ],
        },
        { title: "In progress", claims: [] },
        { title: "Blockers", claims: [] },
        { title: "Next steps", claims: [] },
      ],
    });
    cognee
      .enqueueSearchResults([searchResult("chatgpt-webhook-retry", "Retry root cause.")])
      .enqueueSearchResults([searchResult("codex-webhook-idempotency", "Idempotency check.")]);

    const response = await handleGenerateRequest(
      postRequest({
        profileKey: "standup",
        timeRangeKey: "custom",
        customStart: customRange.start,
        customEnd: customRange.end,
      }),
      depsFor({ llm, embeddings: new FakeEmbeddings(), cognee, storePath }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as GenerateResponse;
    expect(body.output.timeRange).toEqual(customRange);
    expect(body.selectedActivities.map((entry) => entry.activity.id)).toEqual([
      "activity-payment-webhook",
    ]);
    expect(body.droppedActivities).toEqual([]);
    expect(cognee.searchCalls).toHaveLength(2);
  });

  it("surfaces a run-ingest-first error when the store is missing", async () => {
    const missingPath = join(tmpdir(), `yap2graph-t13-missing-${Date.now()}.json`);
    const response = await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "last-7-days" }),
      {
        llm: new FakeLlm(),
        embeddings: new FakeEmbeddings(),
        cognee: new StubCognee(),
        corpus: fixtureDocuments,
        storePath: missingPath,
        now: NOW,
      },
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("store-not-ready");
    expect(body.error).toContain("npm run ingest");
  });

  it("surfaces a run-ingest-first error when the store is empty", async () => {
    const storePath = await fixtureStore([]);
    const response = await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "last-7-days" }),
      {
        llm: new FakeLlm(),
        embeddings: new FakeEmbeddings(),
        cognee: new StubCognee(),
        corpus: fixtureDocuments,
        storePath,
        now: NOW,
      },
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("store-not-ready");
    expect(body.error).toContain("npm run ingest");
  });

  it("rejects invalid request bodies with 400", async () => {
    const deps: QueryPathDeps = {
      llm: new FakeLlm(),
      embeddings: new FakeEmbeddings(),
      cognee: new StubCognee(),
      corpus: fixtureDocuments,
      storePath: await fixtureStore(),
      now: NOW,
    };

    const cases: Array<{ label: string; body: unknown }> = [
      { label: "unknown profile", body: { profileKey: "bogus", timeRangeKey: "today" } },
      { label: "unknown time range", body: { profileKey: "standup", timeRangeKey: "yesterday" } },
      { label: "custom without start/end", body: { profileKey: "standup", timeRangeKey: "custom" } },
      {
        label: "custom end before start",
        body: {
          profileKey: "standup",
          timeRangeKey: "custom",
          customStart: "2026-09-10T00:00:00Z",
          customEnd: "2026-09-08T00:00:00Z",
        },
      },
      {
        label: "custom values with a preset key",
        body: {
          profileKey: "standup",
          timeRangeKey: "last-7-days",
          customStart: "2026-09-05T00:00:00Z",
          customEnd: "2026-09-11T23:59:59Z",
        },
      },
      { label: "extra unknown field", body: { profileKey: "standup", timeRangeKey: "today", extra: 1 } },
    ];

    for (const testCase of cases) {
      const response = await handleGenerateRequest(postRequest(testCase.body), deps);
      expect(response.status, testCase.label).toBe(400);
      const body = (await response.json()) as { code: string; error: string };
      expect(body.code, testCase.label).toBe("invalid-request");
    }

    const notJson = await handleGenerateRequest(postRequest("not json{"), deps);
    expect(notJson.status).toBe(400);
    const notJsonBody = (await notJson.json()) as { code: string };
    expect(notJsonBody.code).toBe("invalid-request");
  });

  it("includes every fixture activity's title in the relevance prompt (range filtering feeds relevance)", async () => {
    const storePath = await fixtureStore();
    const llm = new FakeLlm();
    const cognee = new StubCognee();

    llm.enqueue(
      scoringResponse([
        { activityId: "activity-payment-webhook", value: 0.9 },
        { activityId: "activity-feed-caching", value: 0.8 },
        { activityId: "activity-ci-migration", value: 0.3 },
      ]),
    );
    llm.enqueue({
      profileKey: "standup",
      timeRange: LAST_7_DAYS_RANGE,
      sections: [
        {
          title: "Completed",
          claims: [
            {
              markdown: "- Fixed duplicate Stripe webhook charges.",
              evidenceIds: ["activity-payment-webhook:chatgpt-webhook-retry:0"],
            },
          ],
        },
        { title: "In progress", claims: [] },
        { title: "Blockers", claims: [] },
        { title: "Next steps", claims: [] },
      ],
    });
    cognee
      .enqueueSearchResults([searchResult("chatgpt-webhook-retry", "Retry root cause.")])
      .enqueueSearchResults([searchResult("email-webhook-shipped", "Fix is live.")])
      .enqueueSearchResults([searchResult("chatgpt-feed-cache", "Redis decision.")])
      .enqueueSearchResults([searchResult("codex-feed-redis", "Cache implementation.")]);

    await handleGenerateRequest(
      postRequest({ profileKey: "standup", timeRangeKey: "last-7-days" }),
      depsFor({ llm, embeddings: new FakeEmbeddings(), cognee, storePath }),
    );

    const scoringPrompt = llm.history[0]!.messages[1]!.content;
    for (const activity of cannedThreadActivities) {
      expect(scoringPrompt).toContain(activity.title);
    }
  });
});
