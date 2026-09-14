"use client";

import { Globe, Ruler } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, toggleLocale, unitSystem, toggleUnitSystem, t } = useI18n();

  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/80 p-0.5 backdrop-blur-xs", className)}>
      {/* Language toggle button */}
      <Tooltip
        content={locale === "ru" ? "Switch to English (Переключить на английский)" : "Переключить на русский (Switch to Russian)"}
        side="bottom"
      >
        <button
          type="button"
          onClick={toggleLocale}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all",
            "hover:bg-amber-400/10 hover:text-amber-200 focus-visible:outline-hidden",
            locale === "ru" ? "bg-amber-400/15 text-amber-200 border border-amber-400/30" : "text-stone-400"
          )}
          aria-label="Language switch"
        >
          <Globe className="size-3.5 text-amber-400/80" />
          <span className="font-semibold tracking-wide uppercase">{locale}</span>
        </button>
      </Tooltip>

      <span className="h-3.5 w-px bg-stone-800" aria-hidden="true" />

      {/* Metric system toggle button */}
      <Tooltip
        content={
          unitSystem === "metric"
            ? (locale === "ru" ? "Метрическая система: метры (м) и килограммы (кг). Нажмите для футов/фунтов." : "Metric system: meters and kg. Click for imperial.")
            : (locale === "ru" ? "Английская система: футы (ft) и фунты (lb). Нажмите для метров/кг." : "Imperial system: feet and lbs. Click for metric.")
        }
        side="bottom"
      >
        <button
          type="button"
          onClick={toggleUnitSystem}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono transition-all",
            "hover:bg-amber-400/10 hover:text-amber-200 focus-visible:outline-hidden",
            unitSystem === "metric" ? "bg-stone-800/80 text-stone-200 border border-stone-700/60" : "text-stone-400"
          )}
          aria-label="Unit system switch"
        >
          <Ruler className="size-3 text-stone-400" />
          <span>{unitSystem === "metric" ? (locale === "ru" ? "м/кг" : "m/kg") : (locale === "ru" ? "фт/фнт" : "ft/lb")}</span>
        </button>
      </Tooltip>
    </div>
  );
}
