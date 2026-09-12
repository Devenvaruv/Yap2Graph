import type { TimeRangeKey } from "./reference";
import type { Activity, TimeRange } from "./schemas";

const MS_PER_DAY = 86_400_000;

export interface CustomTimeRange {
  start: string;
  end: string;
}

export interface TimeRangeFilterResult {
  /** Activities whose active interval overlaps the requested range. */
  inRange: Activity[];
  /** Activities that neither started nor were active inside the range. */
  outOfRange: Activity[];
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + MS_PER_DAY - 1);
}

/**
 * Resolve a UI time-range key into an absolute {@link TimeRange}, decided
 * once for the whole app (T13):
 *
 * - presets are whole UTC calendar days ending today, inclusive — "last 3
 *   days" is [startOfDay(now - 2d), endOfDay(now)], so every wider preset is
 *   a superset of every narrower one (today ⊆ 3 ⊆ 7 ⊆ 14 days);
 * - "custom" passes the caller's explicit start/end through unchanged.
 *
 * `now` is a parameter, not a clock read, so tests and the route are
 * deterministic.
 */
export function resolveTimeRange(
  key: TimeRangeKey,
  now: Date,
  custom?: CustomTimeRange,
): TimeRange {
  if (key === "custom") {
    if (!custom) {
      throw new Error('resolveTimeRange: key "custom" requires start/end.');
    }
    const startMs = new Date(custom.start).getTime();
    const endMs = new Date(custom.end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new Error(
        `resolveTimeRange: custom range is not valid ISO-8601: ${custom.start} → ${custom.end}.`,
      );
    }
    if (startMs > endMs) {
      throw new Error(
        `resolveTimeRange: custom range start must not be after end (${custom.start} → ${custom.end}).`,
      );
    }
    return { start: custom.start, end: custom.end };
  }

  const days: Record<Exclude<TimeRangeKey, "custom">, number> = {
    today: 1,
    "last-3-days": 3,
    "last-7-days": 7,
    "last-14-days": 14,
  };
  const width = days[key];
  return {
    start: startOfUtcDay(new Date(now.getTime() - (width - 1) * MS_PER_DAY)).toISOString(),
    end: endOfUtcDay(now).toISOString(),
  };
}

/**
 * Filter activities by an absolute time range. Boundary semantics, decided
 * once (T13): an activity counts when its active interval [startTime,
 * lastActiveTime] overlaps the requested range at all, inclusive of both
 * range bounds — so work started before the window but still active inside
 * it counts, and work started inside the window that is still ongoing counts
 * too. Only work that neither started nor was active inside the window is
 * excluded.
 */
export function filterActivitiesByTimeRange(
  activities: readonly Activity[],
  range: TimeRange,
): TimeRangeFilterResult {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();

  const inRange: Activity[] = [];
  const outOfRange: Activity[] = [];
  for (const activity of activities) {
    const startsAt = new Date(activity.startTime).getTime();
    const lastActiveAt = new Date(activity.lastActiveTime).getTime();
    const overlaps = startsAt <= rangeEnd && lastActiveAt >= rangeStart;
    if (overlaps) {
      inRange.push(activity);
    } else {
      outOfRange.push(activity);
    }
  }
  return { inRange, outOfRange };
}
