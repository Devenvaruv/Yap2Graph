"use client";

import { useState } from "react";
import { ActivitiesPane } from "@/components/ActivitiesPane";
import { IntentPicker } from "@/components/IntentPicker";
import { OutputPane } from "@/components/OutputPane";
import { TimeRangeSelector } from "@/components/TimeRangeSelector";
import type { IntentKey, TimeRangeKey } from "@/lib/reference";

export default function Home() {
  const [intent, setIntent] = useState<IntentKey>("standup");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("last-7-days");

  return (
    <main className="page">
      <header>
        <h1>Yap2Graph</h1>
        <p className="tagline">
          One shared memory of your working week, surfaced differently per intent.
        </p>
      </header>
      <IntentPicker value={intent} onChange={setIntent} />
      <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      <div className="panes">
        <OutputPane />
        <ActivitiesPane />
      </div>
    </main>
  );
}
