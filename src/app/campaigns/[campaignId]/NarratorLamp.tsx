"use client";

import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { narratorLampText, type NarratorLamp as NarratorLampView, type NarratorLampTone } from "@/app/campaigns/[campaignId]/narratorLampState";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

const DOT: Record<NarratorLampTone, string> = {
  offline: "bg-stone-500",
  online: "bg-emerald-400 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-emerald-400)_15%,transparent)]",
  busy: "bg-amber-400 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-amber-400)_18%,transparent)]",
};

// The pill's text follows the dot; its frame stays the quiet header button
// except while the narrator works, when it borrows the lit gold border.
const PILL: Record<NarratorLampTone, string> = {
  offline: "",
  online: "text-stone-300",
  busy: "border-amber-500/40 text-amber-200 hover:border-amber-500/60 hover:text-amber-100",
};

// "Since" is an absolute time, so a minute tick only matters for rolling
// past midnight (the date appears once it is no longer today).
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Dot({ lamp, className }: { lamp: NarratorLampView; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex items-center justify-center", className)}>
      <span
        className={cn(
          "size-2 rounded-full",
          DOT[lamp.tone],
          lamp.pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
    </span>
  );
}

// Header pill beside the voice button. Below md it collapses to the dot; the
// label then lives in aria-label and the tooltip, and the mobile tools sheet
// shows the full text (touch never opens a tooltip).
export function NarratorLamp({ lamp }: { lamp: NarratorLampView }) {
  const { locale } = useI18n();
  const now = useMinuteClock();
  const { label, detail, summary } = narratorLampText(lamp, locale, now);
  return (
    <Tooltip
      side="bottom"
      content={
        <>
          <span className="block font-medium text-stone-200">{label}</span>
          <span className="block">{detail}</span>
        </>
      }
    >
      <span
        tabIndex={0}
        role="img"
        aria-label={summary}
        data-lamp={lamp.state}
        className={headerButtonClass(false, cn("flex cursor-default items-center gap-1.5 md:px-2.5", PILL[lamp.tone]))}
      >
        <Dot lamp={lamp} className="size-4" />
        <span className="hidden whitespace-nowrap text-sm md:inline">{label}</span>
      </span>
    </Tooltip>
  );
}

// The same status as a row of the mobile tools sheet, explanation included.
export function NarratorLampRow({ lamp }: { lamp: NarratorLampView }) {
  const { locale } = useI18n();
  const now = useMinuteClock();
  const { label, detail } = narratorLampText(lamp, locale, now);
  return (
    <div
      data-lamp={lamp.state}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-stone-900 px-3 py-2 text-sm text-stone-200"
    >
      <Dot lamp={lamp} className="size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block text-xs text-stone-400">{detail}</span>
      </span>
    </div>
  );
}
