import { describe, expect, it } from "vitest";
import { cannedThreadActivities } from "../fixtures/canned-extraction";
import type { Activity } from "../schemas";
import { filterActivitiesByTimeRange, resolveTimeRange } from "../time-range";

/**
 * T13 unit tests for the pure time-range functions. `now` is fixed so preset
 * resolution is deterministic; the fixture corpus (2026-09-05 → 2026-09-11)
 * is deliberately one week behind it.
 */

const NOW = new Date("2026-09-12T10:30:00Z");

/** A minimal activity whose only variables are the two timestamps. */
function activityAt(id: string, startTime: string, lastActiveTime: string): Activity {
  return {
    ...cannedThreadActivities[0],
    id,
    startTime,
    lastActiveTime,
  };
}

describe("resolveTimeRange — presets", () => {
  it("today is the current UTC day, inclusive of both ends", () => {
    expect(resolveTimeRange("today", NOW)).toEqual({
      start: "2026-09-12T00:00:00.000Z",
      end: "2026-09-12T23:59:59.999Z",
    });
  });

  it.each([
    ["last-3-days", "2026-09-10T00:00:00.000Z"],
    ["last-7-days", "2026-09-06T00:00:00.000Z"],
    ["last-14-days", "2026-08-30T00:00:00.000Z"],
  ] as const)("'%s' spans whole UTC calendar days ending today", (key, expectedStart) => {
    const range = resolveTimeRange(key, NOW);
    expect(range.start).toBe(expectedStart);
    expect(range.end).toBe("2026-09-12T23:59:59.999Z");
  });

  it("wider presets are supersets of narrower ones (today ⊆ 3 ⊆ 7 ⊆ 14 days)", () => {
    const [today, three, seven, fourteen] = [
      resolveTimeRange("today", NOW),
      resolveTimeRange("last-3-days", NOW),
      resolveTimeRange("last-7-days", NOW),
      resolveTimeRange("last-14-days", NOW),
    ];
    expect(new Date(three.start).getTime()).toBeLessThanOrEqual(
      new Date(today.start).getTime(),
    );
    expect(new Date(seven.start).getTime()).toBeLessThanOrEqual(
      new Date(three.start).getTime(),
    );
    expect(new Date(fourteen.start).getTime()).toBeLessThanOrEqual(
      new Date(seven.start).getTime(),
    );
    for (const range of [today, three, seven, fourteen]) {
      expect(range.end).toBe(today.end);
    }
  });

  it("resolves relative to the supplied `now`, not the wall clock", () => {
    const range = resolveTimeRange("today", new Date("2026-09-07T23:00:00Z"));
    expect(range.start).toBe("2026-09-07T00:00:00.000Z");
    expect(range.end).toBe("2026-09-07T23:59:59.999Z");
  });
});

describe("resolveTimeRange — custom", () => {
  it("passes explicit start/end through unchanged", () => {
    const custom = { start: "2026-09-01T08:00:00Z", end: "2026-09-10T18:00:00Z" };
    expect(resolveTimeRange("custom", NOW, custom)).toEqual(custom);
  });

  it("rejects a start after the end", () => {
    expect(() =>
      resolveTimeRange("custom", NOW, {
        start: "2026-09-10T00:00:00Z",
        end: "2026-09-01T00:00:00Z",
      }),
    ).toThrow(/start must not be after end/);
  });

  it("rejects a custom key with no start/end", () => {
    expect(() => resolveTimeRange("custom", NOW)).toThrow(/requires start\/end/);
  });

  it("rejects non-ISO-8601 timestamps", () => {
    expect(() =>
      resolveTimeRange("custom", NOW, { start: "yesterday", end: "2026-09-10T00:00:00Z" }),
    ).toThrow(/not valid ISO-8601/);
  });
});

describe("filterActivitiesByTimeRange — boundary semantics", () => {
  const range = { start: "2026-09-10T00:00:00Z", end: "2026-09-11T23:59:59Z" };

  it("includes an activity whose lastActiveTime is exactly the range start", () => {
    const { inRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z")],
      range,
    );
    expect(inRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("includes an activity whose startTime is exactly the range end", () => {
    const { inRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-11T23:59:59Z", "2026-09-12T06:00:00Z")],
      range,
    );
    expect(inRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("includes work started before the window but still active inside it", () => {
    const { inRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-05T09:00:00Z", "2026-09-10T14:00:00Z")],
      range,
    );
    expect(inRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("includes work started inside the window that is still active after it", () => {
    const { inRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-11T10:00:00Z", "2026-09-20T10:00:00Z")],
      range,
    );
    expect(inRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("excludes work that went quiet before the range start", () => {
    const { outOfRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-05T09:00:00Z", "2026-09-09T23:59:59.999Z")],
      range,
    );
    expect(outOfRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("excludes work that starts after the range end", () => {
    const { outOfRange } = filterActivitiesByTimeRange(
      [activityAt("a", "2026-09-12T00:00:00Z", "2026-09-15T00:00:00Z")],
      range,
    );
    expect(outOfRange.map((a) => a.id)).toEqual(["a"]);
  });

  it("splits a mixed list and preserves input order within each bucket", () => {
    const activities = [
      activityAt("before", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"),
      activityAt("inside", "2026-09-10T12:00:00Z", "2026-09-11T12:00:00Z"),
      activityAt("after", "2026-09-12T00:00:00Z", "2026-09-20T00:00:00Z"),
      activityAt("straddling", "2026-09-01T00:00:00Z", "2026-09-10T00:00:01Z"),
    ];
    const { inRange, outOfRange } = filterActivitiesByTimeRange(activities, range);
    expect(inRange.map((a) => a.id)).toEqual(["inside", "straddling"]);
    expect(outOfRange.map((a) => a.id)).toEqual(["before", "after"]);
  });

  it("an empty range-widening edge: zero-length range still matches an activity active exactly then", () => {
    const point = { start: "2026-09-10T12:00:00Z", end: "2026-09-10T12:00:00Z" };
    const { inRange } = filterActivitiesByTimeRange(
      [
        activityAt("active-then", "2026-09-01T00:00:00Z", "2026-09-10T12:00:00Z"),
        activityAt("never", "2026-09-10T12:00:01Z", "2026-09-11T00:00:00Z"),
      ],
      point,
    );
    expect(inRange.map((a) => a.id)).toEqual(["active-then"]);
  });
});

describe("filterActivitiesByTimeRange — against the fixture week", () => {
  it("last-7-days from the fixture 'today' covers all three fixture activities", () => {
    const range = resolveTimeRange("last-7-days", NOW);
    const { inRange } = filterActivitiesByTimeRange(cannedThreadActivities, range);
    expect(inRange).toHaveLength(cannedThreadActivities.length);
  });

  it("today excludes every fixture activity (the fixture week is in the past)", () => {
    const range = resolveTimeRange("today", NOW);
    const { inRange, outOfRange } = filterActivitiesByTimeRange(
      cannedThreadActivities,
      range,
    );
    expect(inRange).toEqual([]);
    expect(outOfRange).toHaveLength(cannedThreadActivities.length);
  });
});
