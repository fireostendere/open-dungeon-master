"use client";

import { Sparkles, Trophy, Scroll, Skull } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function ClosingMessageBanner({
  campaignTitle,
  hasOpened,
  defaultMode = "victory",
  onOpenClosingMessage,
  isYolo = false,
}: {
  campaignTitle: string;
  hasOpened: boolean;
  defaultMode?: "victory" | "defeat";
  onOpenClosingMessage: () => void;
  isYolo?: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      concludedVictory: "Campaign Concluded: Victory!",
      concludedDefeat: "Campaign Concluded: Defeat",
      subtitleVictory: isYolo
        ? "The Dungeon Master dropped the final victory verdict for the badasses."
        : "The Dungeon Master has delivered the final closing message for the party.",
      subtitleDefeat: isYolo
        ? "Everyone died like dumbasses. The Dungeon Master left a parting epitaph."
        : "The party has fallen. The Dungeon Master left a final epitaph.",
      openCtaVictory: isYolo ? "Open Final Message & Salute!" : "Open Closing Message & Salute",
      openCtaDefeat: isYolo ? "Open Disastrous Finale & Trombone" : "Open Final Message & Defeat",
      reopenCtaVictory: isYolo ? "View Final Message & Fireworks" : "View Closing Message & Fireworks",
      reopenCtaDefeat: isYolo ? "View Disastrous Finale & Trombone" : "View Final Message & Defeat",
    },
    ru: {
      concludedVictory: "Кампания завершена: Победа!",
      concludedDefeat: "Кампания завершена: Поражение отряда",
      subtitleVictory: isYolo
        ? "Мастер выкатил финальное напутствие победителям."
        : "Мастер оставил итоговое закрывающее послание для отряда.",
      subtitleDefeat: isYolo
        ? "Все сдохли. Мастер оставил посмертное напутствие неудачникам."
        : "Отряд пал в бою. Мастер оставил финальную эпитафию.",
      openCtaVictory: "Открыть послание и салют победы",
      openCtaDefeat: isYolo ? "Открыть закрывающий проёб и тромбон" : "Открыть закрывающее послание и финал",
      reopenCtaVictory: "Посмотреть послание и салют победы",
      reopenCtaDefeat: isYolo ? "Посмотреть закрывающий проёб и тромбон" : "Посмотреть закрывающее послание и финал",
    },
  });

  const isDefeat = defaultMode === "defeat";

  return (
    <div
      className={cn(
        "relative mx-2 sm:mx-4 my-2 sm:my-3 overflow-hidden rounded-xl border p-3 sm:p-4 transition-all duration-300",
        isDefeat
          ? !hasOpened
            ? "border-red-800/70 bg-gradient-to-r from-red-950/40 via-stone-900/90 to-red-950/40 shadow-[0_0_25px_rgba(239,68,68,0.2)] animate-pulse"
            : "border-red-900/40 bg-stone-900/60"
          : !hasOpened
            ? "border-amber-500/70 bg-gradient-to-r from-amber-950/40 via-stone-900/90 to-amber-950/40 shadow-[0_0_25px_rgba(245,158,11,0.2)] animate-pulse"
            : "border-amber-500/30 bg-stone-900/60",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl shadow-md",
              isDefeat
                ? "bg-gradient-to-br from-red-600 to-stone-900 text-stone-100"
                : "bg-gradient-to-br from-amber-400 to-amber-600 text-stone-950",
            )}
          >
            {isDefeat ? <Skull className="size-5" /> : <Trophy className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h4
              className={cn(
                "font-display text-sm font-bold tracking-wide break-words leading-snug",
                isDefeat ? "text-red-200" : "text-amber-200",
              )}
            >
              <Scroll className={cn("inline-block mr-1.5 size-3.5 align-text-bottom shrink-0", isDefeat ? "text-red-400" : "text-amber-400")} />
              <span>{isDefeat ? copy.concludedDefeat : copy.concludedVictory}</span>
              {campaignTitle ? (
                <span className="opacity-80 font-normal"> — {campaignTitle}</span>
              ) : null}
            </h4>
            <p className="mt-0.5 text-xs text-stone-300 break-words leading-relaxed">
              {isDefeat ? copy.subtitleDefeat : copy.subtitleVictory}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenClosingMessage}
          className={cn(
            isDefeat
              ? "inline-flex items-center justify-center rounded-lg border border-red-800 bg-red-900/80 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-800"
              : ui.btnPrimary,
            "w-full sm:w-auto text-xs py-2 px-3.5 shrink-0 gap-1.5 text-center justify-center whitespace-normal leading-tight",
            !hasOpened &&
              (isDefeat
                ? "ring-2 ring-red-400/60 shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                : "ring-2 ring-amber-300/60 shadow-[0_0_20px_rgba(245,158,11,0.4)]"),
          )}
        >
          {isDefeat ? (
            <Skull className="size-4 shrink-0 text-red-200" />
          ) : (
            <Sparkles className="size-4 shrink-0 text-amber-950" />
          )}
          <span>
            {hasOpened
              ? isDefeat
                ? copy.reopenCtaDefeat
                : copy.reopenCtaVictory
              : isDefeat
                ? copy.openCtaDefeat
                : copy.openCtaVictory}
          </span>
        </button>
      </div>
    </div>
  );
}
