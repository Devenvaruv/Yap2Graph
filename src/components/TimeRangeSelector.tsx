"use client";

import { TIME_RANGES, type TimeRangeKey } from "@/lib/reference";

type TimeRangeSelectorProps = {
  value: TimeRangeKey;
  onChange: (value: TimeRangeKey) => void;
};

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <section className="picker" aria-labelledby="time-range-heading">
      <h2 id="time-range-heading">Time range</h2>
      <div className="option-row" role="group" aria-label="Time range">
        {TIME_RANGES.map((range) => (
          <button
            key={range.key}
            type="button"
            className="chip"
            aria-pressed={value === range.key}
            onClick={() => onChange(range.key)}
          >
            {range.label}
          </button>
        ))}
      </div>
    </section>
  );
}
