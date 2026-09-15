"use client";

import { Globe, Ruler } from "lucide-react";
import { nextLocale, useI18n } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, locale, toggleLocale, unitSystem, toggleUnitSystem } = useI18n();
  const next = nextLocale(locale);
  const nextLanguageName =
    next === "ru"
      ? t("language.russian")
      : next === "pl"
        ? t("language.polish")
        : t("language.english");
  const languageTooltip = t("language.switchShort", { language: nextLanguageName });
  const languageLabel = t("language.switchTo", { language: nextLanguageName });
  const unitsTooltip =
    unitSystem === "metric" ? t("language.metricHelp") : t("language.imperialHelp");
  const unitsLabel = t("language.switchUnits");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/80 p-0.5 backdrop-blur-xs",
        className,
      )}
    >
      <Tooltip content={languageTooltip} side="bottom">
        <button
          type="button"
          onClick={toggleLocale}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/15 px-2 py-1 text-xs font-medium text-amber-200 transition-all",
            "hover:bg-amber-400/20 focus-visible:outline-hidden",
          )}
          aria-label={languageLabel}
        >
          <Globe className="size-3.5 text-amber-400/80" />
          <span className="font-semibold tracking-wide uppercase">{locale}</span>
        </button>
      </Tooltip>

      <span className="h-3.5 w-px bg-stone-800" aria-hidden="true" />

      <Tooltip content={unitsTooltip} side="bottom">
        <button
          type="button"
          onClick={toggleUnitSystem}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono transition-all",
            "hover:bg-amber-400/10 hover:text-amber-200 focus-visible:outline-hidden",
            unitSystem === "metric"
              ? "border border-stone-700/60 bg-stone-800/80 text-stone-200"
              : "text-stone-400",
          )}
          aria-label={unitsLabel}
        >
          <Ruler className="size-3 text-stone-400" />
          <span>
            {unitSystem === "metric"
              ? locale === "ru"
                ? "м/кг"
                : "m/kg"
              : locale === "ru"
                ? "фт/фнт"
                : "ft/lb"}
          </span>
        </button>
      </Tooltip>
    </div>
  );
}
