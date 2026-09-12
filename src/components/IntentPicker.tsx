"use client";

import { INTENTS, type IntentKey } from "@/lib/reference";

type IntentPickerProps = {
  value: IntentKey;
  onChange: (value: IntentKey) => void;
};

export function IntentPicker({ value, onChange }: IntentPickerProps) {
  return (
    <section className="picker" aria-labelledby="intent-heading">
      <h2 id="intent-heading">What do you need?</h2>
      <div className="option-grid" role="group" aria-label="Intent">
        {INTENTS.map((intent) => (
          <button
            key={intent.key}
            type="button"
            className="option"
            aria-pressed={value === intent.key}
            onClick={() => onChange(intent.key)}
          >
            <span className="option-label">{intent.label}</span>
            <span className="option-description">{intent.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
