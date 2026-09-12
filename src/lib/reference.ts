import { z } from "zod";

export const IntentKeySchema = z.enum([
  "standup",
  "manager-update",
  "linkedin-post",
  "technical-blog",
  "accomplishments",
  "end-of-period-update",
]);

export const TimeRangeKeySchema = z.enum([
  "today",
  "last-3-days",
  "last-7-days",
  "last-14-days",
  "custom",
]);

export type IntentKey = z.infer<typeof IntentKeySchema>;
export type TimeRangeKey = z.infer<typeof TimeRangeKeySchema>;

const IntentProfileSchema = z.object({
  key: IntentKeySchema,
  label: z.string().min(1),
  description: z.string().min(1),
});

const TimeRangeOptionSchema = z.object({
  key: TimeRangeKeySchema,
  label: z.string().min(1),
});

export type IntentProfile = z.infer<typeof IntentProfileSchema>;
export type TimeRangeOption = z.infer<typeof TimeRangeOptionSchema>;

// Placeholder profiles; the intent layer replaces these with full validated profiles.
export const INTENTS: readonly IntentProfile[] = IntentProfileSchema.array().parse([
  {
    key: "standup",
    label: "Standup",
    description: "Completed and in-progress work, blockers, and next actions.",
  },
  {
    key: "manager-update",
    label: "Manager update",
    description: "Progress, deliverables, impact, decisions, blockers, and dependencies.",
  },
  {
    key: "linkedin-post",
    label: "LinkedIn post",
    description: "An accomplishment-oriented narrative with impact framing.",
  },
  {
    key: "technical-blog",
    label: "Technical blog",
    description: "Interesting problems, experiments, decisions, failures, and lessons learned.",
  },
  {
    key: "accomplishments",
    label: "What did I accomplish?",
    description: "A plain summary of completed, meaningful work.",
  },
  {
    key: "end-of-period-update",
    label: "End-of-day / end-of-week update",
    description: "One update profile driven by the selected time range.",
  },
]);

export const TIME_RANGES: readonly TimeRangeOption[] = TimeRangeOptionSchema.array().parse([
  { key: "today", label: "Today" },
  { key: "last-3-days", label: "Last 3 days" },
  { key: "last-7-days", label: "Last 7 days" },
  { key: "last-14-days", label: "Last 14 days" },
  { key: "custom", label: "Custom" },
]);
