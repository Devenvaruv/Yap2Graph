import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadActivities, saveActivities } from "../activity-store";
import type { Activity } from "../schemas";

const activity: Activity = {
  id: "activity-payment-webhook",
  title: "Fixed duplicate Stripe webhook charges in billing-api",
  description: "Idempotent Stripe webhook handler backed by processed_events.",
  project: "billing-api",
  activityType: "implementation",
  startTime: "2026-09-07T10:15:00Z",
  lastActiveTime: "2026-09-09T09:30:00Z",
  status: "completed",
  technologies: ["Stripe", "Postgres"],
  outcome: "Zero duplicate charges after 24h in production.",
  blockers: [],
  nextSteps: [],
  beforeState: "Retries re-processed payments; ~3 customers double-charged daily.",
  afterState: "Retries are no-ops at the transaction boundary.",
  evidenceIds: ["chatgpt-webhook-retry", "codex-webhook-idempotency"],
  confidence: 0.95,
};

const tempDirs: string[] = [];

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "yap2graph-store-"));
  tempDirs.push(dir);
  return join(dir, "activities.json");
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("activity store", () => {
  it("round-trips the activity list through save and load", async () => {
    const filePath = await tempStorePath();

    await saveActivities([activity], filePath);

    await expect(loadActivities(filePath)).resolves.toEqual([activity]);
  });

  it("creates missing parent directories on save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yap2graph-store-"));
    tempDirs.push(dir);
    const filePath = join(dir, "nested", "deeply", "activities.json");

    await saveActivities([], filePath);

    await expect(loadActivities(filePath)).resolves.toEqual([]);
  });

  it("rejects a store file that does not validate against the Activity schema", async () => {
    const filePath = await tempStorePath();
    await writeFile(filePath, JSON.stringify([{ id: "not-an-activity" }]), "utf8");

    await expect(loadActivities(filePath)).rejects.toThrow(/failed validation/);
  });
});
