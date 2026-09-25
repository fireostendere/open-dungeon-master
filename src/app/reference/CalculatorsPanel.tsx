"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  CALCULATORS,
  calculatorDisplay,
  localizeCalculatorResult,
  travelDistanceDisplayValue,
  travelDistanceStoredValue,
  type CalcInput,
} from "@/lib/reference/calculators";

// Every table calculation on one screen.
//
// No route: src/lib/reference/calculators.ts is pure, so it runs here and the
// numbers move as the inputs do. Each answer shows its PARTS under the
// headline, because the point is not the number, it is being able to see
// which input produced it.

export function CalculatorsPanel() {
  const { locale, unitSystem } = useI18n();
  const [openId, setOpenId] = useState(CALCULATORS[0]?.id ?? "");
  const [inputs, setInputs] = useState<Record<string, CalcInput>>(() =>
    Object.fromEntries(CALCULATORS.map((calculator) => [calculator.id, { ...calculator.defaults }])),
  );

  const calculator = CALCULATORS.find((entry) => entry.id === openId) ?? CALCULATORS[0];
  const input = inputs[calculator.id] ?? calculator.defaults;
  const display = calculatorDisplay(calculator, locale, unitSystem);
  const result = localizeCalculatorResult(
    calculator.id,
    calculator.run(input, unitSystem, locale),
    locale,
  );

  function set(key: string, value: string) {
    setInputs((previous) => ({
      ...previous,
      [calculator.id]: { ...(previous[calculator.id] ?? calculator.defaults), [key]: value },
    }));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CALCULATORS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setOpenId(entry.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              entry.id === calculator.id
                ? "border-amber-600 bg-stone-900 text-amber-100"
                : "border-stone-700 text-stone-400 hover:border-amber-800 hover:text-stone-200",
            )}
          >
            {calculatorDisplay(entry, locale, unitSystem).label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-sm text-stone-400">{display.blurb}</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {display.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
              {field.label}
              {field.kind === "number" && field.suffix ? ` (${field.suffix})` : ""}
            </span>
            {field.kind === "number" ? (
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={
                  calculator.id === "travel" && field.key === "miles"
                    ? travelDistanceDisplayValue(input[field.key] ?? "", unitSystem)
                    : String(input[field.key] ?? "")
                }
                onChange={(event) =>
                  set(
                    field.key,
                    calculator.id === "travel" && field.key === "miles"
                      ? travelDistanceStoredValue(event.target.value, unitSystem)
                      : event.target.value,
                  )
                }
                className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
              />
            ) : (
              <select
                value={String(input[field.key] ?? "")}
                onChange={(event) => set(field.key, event.target.value)}
                className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300"
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
      </div>

      <div className="rounded-xl border border-stone-800 bg-stone-950/60 p-4">
        <p className="font-display text-2xl text-amber-100">{result.headline}</p>
        <ul className="mt-3 space-y-2">
          {result.parts.map((part) => (
            <li key={part.label} className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-stone-400">{part.label}</span>
              <span className="text-right">
                <span className="block text-sm text-stone-200">{part.value}</span>
                {part.detail ? (
                  <span className="block text-xs text-stone-500">{part.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {result.note ? (
          <p className="mt-3 border-t border-stone-800 pt-3 text-xs text-stone-500">{result.note}</p>
        ) : null}
      </div>
    </div>
  );
}
