"use client";

import { ChevronLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: { step: "Step" },
  ru: { step: "Шаг" },
  pl: { step: "Krok" },
} as const;

export type WizardStep = {
  key: string;
  title: ReactNode;
  blurb?: ReactNode;
  content: ReactNode;
  canContinue?: boolean;
};

export function Wizard({
  steps,
  title,
  onDone,
  doneLabel,
  onCancel,
  step: controlledStep,
  onStepChange,
  className,
}: {
  steps: WizardStep[];
  title: ReactNode;
  onDone: () => void;
  doneLabel?: ReactNode;
  onCancel?: () => void;
  step?: number;
  onStepChange?: (step: number) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const copy = COPY[locale];
  const [internalStep, setInternalStep] = useState(0);
  const controlled = controlledStep !== undefined;
  const raw = controlled ? controlledStep : internalStep;
  const step = Math.min(Math.max(raw, 0), Math.max(steps.length - 1, 0));
  const total = steps.length;
  const last = step >= total - 1;
  const current = steps[step];
  const canContinue = current?.canContinue !== false;

  const go = (next: number) => {
    if (!controlled) setInternalStep(next);
    onStepChange?.(next);
  };
  const back = () => {
    if (step === 0) onCancel?.();
    else go(step - 1);
  };
  const forward = () => {
    if (!canContinue) return;
    if (last) onDone();
    else go(step + 1);
  };

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <header className="shrink-0">
        <div className="flex items-center gap-2">
          {step > 0 || onCancel ? (
            <button
              type="button"
              onClick={back}
              className="-ml-1.5 rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
              aria-label={step === 0 ? t("common.cancel") : t("common.back")}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-display text-lg tracking-wide text-amber-100">
            {title}
          </h2>
          <span className="eyebrow shrink-0 text-[10px] text-stone-500" aria-live="polite">
            {copy.step} {step + 1} / {total}
          </span>
        </div>
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-stone-800/80"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-300 to-amber-200 shadow-glow-gold transition-[width] duration-[380ms] ease-snap"
            style={{ width: `${total ? ((step + 1) / total) * 100 : 0}%` }}
          />
        </div>
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-[380ms] ease-snap"
          style={{ transform: `translateX(-${step * 100}%)` }}
        >
          {steps.map((s, i) => (
            <section
              key={s.key}
              className="h-full w-full shrink-0 overflow-y-auto px-0.5"
              aria-hidden={i !== step}
              inert={i !== step}
            >
              <h3 className="font-display text-base tracking-wide text-amber-200">{s.title}</h3>
              {s.blurb ? <p className="mt-1 text-sm text-stone-400">{s.blurb}</p> : null}
              <div className="mt-3">{s.content}</div>
            </section>
          ))}
        </div>
      </div>

      <footer className="mt-4 flex shrink-0 items-center justify-end gap-2">
        {step > 0 ? (
          <button type="button" onClick={back} className={ui.btnSecondary}>
            {t("common.back")}
          </button>
        ) : null}
        <button type="button" onClick={forward} disabled={!canContinue} className={ui.btnPrimary}>
          {last ? (doneLabel ?? t("common.finish")) : t("common.next")}
        </button>
      </footer>
    </div>
  );
}
