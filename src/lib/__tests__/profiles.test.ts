import { describe, expect, it } from "vitest";
import { INTENTS, IntentKeySchema, type IntentKey } from "../reference";
import { SCORE_DIMENSIONS, ReferenceProfile } from "../schemas";
import {
  REFERENCE_PROFILES,
  REFERENCE_PROFILE_KEYS,
  getReferenceProfile,
} from "../profiles";

describe("intent reference profiles", () => {
  it("defines six profiles, each validating against the ReferenceProfile schema", () => {
    expect(REFERENCE_PROFILES).toHaveLength(6);
    for (const profile of REFERENCE_PROFILES) {
      expect(ReferenceProfile.safeParse(profile).success).toBe(true);
    }
  });

  it("has unique keys matching the intent picker constants exactly", () => {
    const keys = REFERENCE_PROFILES.map((profile) => profile.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...IntentKeySchema.options].sort());
    expect([...keys].sort()).toEqual(
      [...INTENTS.map((intent) => intent.key)].sort(),
    );
    expect([...REFERENCE_PROFILE_KEYS].sort()).toEqual([...keys].sort());
  });

  it("covers exactly the five scoring dimensions in every profile's scoreWeights", () => {
    for (const profile of REFERENCE_PROFILES) {
      expect(Object.keys(profile.scoreWeights).sort()).toEqual(
        [...SCORE_DIMENSIONS].sort(),
      );
    }
  });

  it("populates every PRD-required field on every profile", () => {
    for (const profile of REFERENCE_PROFILES) {
      expect(profile.audience.length).toBeGreaterThan(0);
      expect(profile.sections.length).toBeGreaterThan(0);
      expect(profile.includeCriteria.length).toBeGreaterThan(0);
      expect(profile.excludeCriteria.length).toBeGreaterThan(0);
      expect(profile.outputConstraints.length).toBeGreaterThan(0);
      expect(profile.threshold).toBeGreaterThanOrEqual(0);
      expect(profile.threshold).toBeLessThanOrEqual(1);
      for (const weight of Object.values(profile.scoreWeights)) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps EOD and EOW as one shared profile with no baked-in range", () => {
    const endOfPeriod = REFERENCE_PROFILES.filter(
      (profile) => profile.key === "end-of-period-update",
    );
    expect(endOfPeriod).toHaveLength(1);
    expect(
      REFERENCE_PROFILES.filter((profile) =>
        /end-of-(day|week)/.test(profile.key),
      ),
    ).toHaveLength(0);
  });

  it("blog include criteria cover the six PRD-required topics", () => {
    const blog = getReferenceProfile("technical-blog");
    const includeText = blog.includeCriteria.join(" ").toLowerCase();
    const requiredTopics = [
      "problem",
      "experiment",
      "architecture",
      "failur",
      "lesson",
      "before/after",
    ];
    for (const topic of requiredTopics) {
      expect(includeText).toContain(topic);
    }
  });

  it("blog exclude criteria cover the three PRD-required exclusions", () => {
    const blog = getReferenceProfile("technical-blog");
    const excludeText = blog.excludeCriteria.join(" ").toLowerCase();
    for (const topic of ["routine admin", "wording", "debugging"]) {
      expect(excludeText).toContain(topic);
    }
  });

  it("standup excludes routine admin and trivial rewording", () => {
    const standup = getReferenceProfile("standup");
    const excludeText = standup.excludeCriteria.join(" ").toLowerCase();
    expect(excludeText).toContain("routine admin");
    expect(excludeText).toContain("rewording");
  });

  it("manager update sections cover progress, deliverables, impact, decisions, blockers, dependencies, next steps", () => {
    const manager = getReferenceProfile("manager-update");
    const sectionsText = manager.sections.join(" ").toLowerCase();
    for (const topic of [
      "progress",
      "deliverables",
      "impact",
      "decisions",
      "blockers",
      "dependencies",
      "next steps",
    ]) {
      expect(sectionsText).toContain(topic);
    }
  });

  it("profile weights differ per profile — the intent-awareness dial is real", () => {
    const weightsOf = (key: IntentKey) => getReferenceProfile(key).scoreWeights;
    // Novelty is the blog's dominant dimension; it is near-zero for status-y profiles.
    expect(weightsOf("technical-blog").novelty).toBeGreaterThan(
      weightsOf("standup").novelty,
    );
    expect(weightsOf("technical-blog").novelty).toBeGreaterThan(
      weightsOf("manager-update").novelty,
    );
    // Impact dominates manager and LinkedIn over standup.
    expect(weightsOf("manager-update").impact).toBeGreaterThan(
      weightsOf("standup").impact,
    );
    expect(weightsOf("linkedin-post").impact).toBeGreaterThan(
      weightsOf("standup").impact,
    );
    // Accomplishments leads with completion over everything else.
    expect(weightsOf("accomplishments").completion).toBeGreaterThan(
      weightsOf("accomplishments").novelty,
    );
  });

  it("getReferenceProfile resolves every picker key and throws for unknown keys", () => {
    for (const intent of INTENTS) {
      expect(getReferenceProfile(intent.key).key).toBe(intent.key);
    }
    expect(() =>
      getReferenceProfile("not-an-intent" as never),
    ).toThrowError(/No reference profile/);
  });
});
