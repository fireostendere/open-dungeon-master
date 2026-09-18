"use client";

import { Sparkles, Trophy, Scroll } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function ClosingMessageBanner({
  campaignTitle,
  hasOpened,
  onOpenClosingMessage,
}: {
  campaignTitle: string;
  hasOpened: boolean;
  onOpenClosingMessage: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      concluded: "Campaign Concluded",
      subtitle: "The Dungeon Master has delivered the final closing message for the party.",
      openCta: "Open DM's Closing Message & Salute",
      reopenCta: "View Closing Message & Fireworks",
    },
    ru: {
      concluded: "Кампания завершена",
      subtitle: "Мастер оставил итоговое закрывающее послание для отряда.",
      openCta: "Открыть закрывающее сообщение и салют",
      reopenCta: "Посмотреть закрывающее послание и салют",
    },
    pl: {
      concluded: "Kampania zakończona",
      subtitle: "Mistrz Gry przekazał końcowe przesłanie dla drużyny.",
      openCta: "Otwórz zamykające przesłanie i salwę",
      reopenCta: "Zobacz zamykające przesłanie i fajerwerki",
    },
  });

  return (
    <div
      className={cn(
        "relative mx-4 my-3 overflow-hidden rounded-xl border p-4 transition-all duration-300",
        !hasOpened
          ? "border-amber-500/70 bg-gradient-to-r from-amber-950/40 via-stone-900/90 to-amber-950/40 shadow-[0_0_25px_rgba(245,158,11,0.2)] animate-pulse"
          : "border-amber-500/30 bg-stone-900/60",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-stone-950 shadow-md">
            <Trophy className="size-5" />
          </div>
          <div className="min-w-0">
            <h4 className="flex items-center gap-1.5 font-display text-sm font-bold tracking-wide text-amber-200">
              <Scroll className="size-3.5 text-amber-400" />
              {copy.concluded} — {campaignTitle}
            </h4>
            <p className="mt-0.5 text-xs text-stone-300">{copy.subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenClosingMessage}
          className={cn(
            ui.btnPrimary,
            "text-xs py-2 px-3.5 shrink-0 gap-1.5",
            !hasOpened && "ring-2 ring-amber-300/60 shadow-[0_0_20px_rgba(245,158,11,0.4)]",
          )}
        >
          <Sparkles className="size-4 text-amber-950" />
          {hasOpened ? copy.reopenCta : copy.openCta}
        </button>
      </div>
    </div>
  );
}
