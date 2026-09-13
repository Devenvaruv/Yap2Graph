"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivitiesPane } from "@/components/ActivitiesPane";
import { IntentPicker } from "@/components/IntentPicker";
import { OutputPane } from "@/components/OutputPane";
import { TimeRangeSelector } from "@/components/TimeRangeSelector";
import type { IntentKey, TimeRangeKey } from "@/lib/reference";

type DraftResponse = {
  title: string;
  markdown: string;
  sources: Array<{
    documentId: string | null;
    excerpt: string;
  }>;
  usedModel: boolean;
  modelError?: string;
  error?: string;
};

export default function Home() {
  const [intent, setIntent] = useState<IntentKey>("standup");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("last-7-days");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/cognee/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileKey: intent, timeRangeKey: timeRange }),
      });
      const payload = (await response.json()) as DraftResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `Draft request failed with ${response.status}`);
      }
      setDraft(payload);
    } catch (err) {
      setDraft(null);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyDraft() {
    if (!draft?.markdown) return;
    await navigator.clipboard.writeText(draft.markdown);
  }

  return (
    <main className="page">
      <header>
        <h1>Yap2Graph</h1>
        <p className="tagline">
          One shared memory of your working week, surfaced differently per intent.
        </p>
        <Link className="text-link" href="/mindmap">
          Open Cognee mind map
        </Link>
      </header>
      <IntentPicker value={intent} onChange={setIntent} />
      <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      <div className="action-row">
        <button
          type="button"
          className="primary-button"
          onClick={generateDraft}
          disabled={isLoading || timeRange === "custom"}
        >
          {isLoading ? "Generating..." : "Generate draft"}
        </button>
        {timeRange === "custom" ? (
          <p className="helper-text">Custom ranges are not wired into this quick Cognee draft view yet.</p>
        ) : null}
      </div>
      <div className="panes">
        <OutputPane
          title={draft?.title}
          markdown={draft?.markdown}
          isLoading={isLoading}
          error={error ?? draft?.modelError ?? null}
          onCopy={copyDraft}
        />
        <ActivitiesPane sources={draft?.sources ?? []} isLoading={isLoading} />
      </div>
    </main>
  );
}
