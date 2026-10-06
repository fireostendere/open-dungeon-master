"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Award, Dices, Sparkles, Trophy, X, Skull } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { characterPlaceholder } from "@/lib/placeholders";
import type { CampaignMessage } from "@/lib/db/messages";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function ClosingMessageModal({
  open,
  onOpenChange,
  campaignTitle,
  message,
  sheets = [],
  defaultMode = "victory",
  onTriggerCelebration,
  isYolo = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignTitle: string;
  message?: CampaignMessage | null;
  sheets?: CharacterSheet[];
  defaultMode?: "victory" | "defeat";
  onTriggerCelebration?: () => void;
  isYolo?: boolean;
}) {
  const { locale } = useI18n();
  const isDefeat = defaultMode === "defeat";
  const copy = localeText(locale, {
    en: {
      title: isDefeat ? "Party defeated" : "Victory!",
      subtitle: isDefeat ? "The Dungeon Master's final message to the defeated party" : "The Dungeon Master's final message to the victors",
      fallbackProse: isDefeat
        ? "The adventure ends in defeat. The Dungeon Master will recount the party's fate in the final message."
        : isYolo
        ? "The dust settles upon the battlefield, reeking of gunpowder, blood, and vanquished foes. The madmen smashed through every obstacle, broke all the rules, and left absolute ruin in their wake. Bards will lose their minds singing this legend."
        : "The dust settles upon the battlefield, and the echoes of triumph resonate throughout the realm. The heroes have braved perils untold, forged bonds unbroken, and etched their names into legend. Their deeds shall be sung by bards for generations to come.",
      partyTitle: isYolo ? "The Badass Party" : "Heroes of the Realm",
      level: "Level",
      replayFireworks: "Victory salute & fireworks",
      playDefeat: "Replay defeat finale",
      close: "Close and view table",
    },
    ru: {
      title: isDefeat ? "Поражение отряда" : "Победа!",
      subtitle: isDefeat ? "Финальное послание Мастера побеждённому отряду" : "Финальное послание Мастера победителям",
      fallbackProse: isDefeat
        ? "Приключение завершилось поражением. Мастер расскажет о судьбе отряда в финальном послании."
        : isYolo
        ? "Пыль битвы осела, и в воздухе стоит запах напалма и поверженных врагов. Герои разъебали всё живое, переломали кости злодеям и оставили за собой легенду. Барды охуеют это воспевать."
        : "Пыль битвы оседает, и эхо триумфа разносится по всему королевству. Герои преодолели немыслимые опасности, скрепили нерушимые узы и вписали свои имена в легенды. Их подвиги будут воспевать барды многих грядущих эпох.",
      partyTitle: isYolo ? "Бешеные ублюдки (отряд)" : "Герои королевства",
      level: "Уровень",
      replayFireworks: "Салют победы",
      playDefeat: "Финал поражения",
      close: "Закрыть и смотреть стол",
    },
  });

  const content = message?.content?.trim() || copy.fallbackProse;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in-0 duration-200" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border-2 border-amber-500/50 bg-gradient-to-b from-stone-900 via-stone-950 to-black p-4 sm:p-8 text-stone-100 shadow-[0_0_60px_rgba(245,158,11,0.25)] animate-in zoom-in-95 duration-200">
            {/* Corner Ornamental Accents */}
            <div className="pointer-events-none absolute -top-1.5 -left-1.5 size-4 border-t-2 border-l-2 border-amber-300" />
            <div className="pointer-events-none absolute -top-1.5 -right-1.5 size-4 border-t-2 border-r-2 border-amber-300" />
            <div className="pointer-events-none absolute -bottom-1.5 -left-1.5 size-4 border-b-2 border-l-2 border-amber-300" />
            <div className="pointer-events-none absolute -bottom-1.5 -right-1.5 size-4 border-b-2 border-r-2 border-amber-300" />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-3 top-3 sm:right-4 sm:top-4 rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition"
              aria-label={copy.close}
            >
              <X className="size-5" />
            </button>

            {/* Header */}
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 sm:size-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/20 to-amber-600/10 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                {isDefeat ? (
                  <Skull className="size-6 sm:size-7 text-red-400 animate-pulse" />
                ) : (
                  <Trophy className="size-6 sm:size-7 animate-pulse" />
                )}
              </div>
              <p className="eyebrow text-xs font-semibold tracking-widest text-amber-400">
                {campaignTitle}
              </p>
              <Dialog.Title className="mt-1 font-display text-xl sm:text-3xl font-bold tracking-wide text-amber-100">
                {copy.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-amber-200/70 sm:text-sm">
                {copy.subtitle}
              </Dialog.Description>
            </div>

            {/* Decorative Divider */}
            <div className="my-4 sm:my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
              <Dices className="size-4 text-amber-400/80" />
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
            </div>

            {/* DM's Message Content (Scroll/Parchment Style) */}
            <div className="max-h-56 sm:max-h-72 overflow-y-auto rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 sm:p-6 shadow-inner">
              <p className="whitespace-pre-wrap font-serif text-sm sm:text-lg leading-relaxed text-amber-100/95 first-letter:text-2xl sm:first-letter:text-3xl first-letter:font-bold first-letter:text-amber-300 first-letter:float-left first-letter:mr-2">
                {content}
              </p>
            </div>

            {/* Surviving Heroes Summary */}
            {sheets.length > 0 ? (
              <div className="mt-4 sm:mt-6">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-amber-400/80">
                  <Award className="size-3.5" />
                  {copy.partyTitle}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sheets.map((sheet) => {
                    const portrait =
                      sheet.portrait?.url ??
                      characterPlaceholder({
                        race: sheet.race,
                        class: sheet.class,
                        gender: sheet.gender,
                      });
                    return (
                      <div
                        key={sheet.id}
                        className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/60 p-2"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={portrait}
                          alt={sheet.name}
                          className="size-8 rounded-full border border-amber-500/30 object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-amber-100">
                            {sheet.name}
                          </p>
                          <p className="truncate text-[10px] text-stone-400">
                            {copy.level} {sheet.level} {sheet.class}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Actions */}
            <div className="mt-6 sm:mt-8 flex flex-col gap-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={cn(ui.btnSecondary, "w-full sm:w-auto text-xs py-2 text-center justify-center")}
              >
                {copy.close}
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onTriggerCelebration?.();
                }}
                className={cn(
                  isDefeat
                    ? "inline-flex items-center justify-center rounded-lg border border-red-800/60 bg-red-950/50 px-3 font-semibold text-red-200 transition hover:bg-red-900/60 hover:text-white ring-2 ring-red-500/50"
                    : ui.btnPrimary,
                  "text-xs py-2 gap-1.5 shadow-[0_0_20px_rgba(245,158,11,0.3)] w-full sm:w-auto text-center justify-center",
                  !isDefeat && "ring-2 ring-amber-400/60",
                )}
              >
                {isDefeat ? <Skull className="size-4 shrink-0 text-red-400" /> : <Sparkles className="size-4 shrink-0 text-amber-950" />}
                <span>{isDefeat ? copy.playDefeat : copy.replayFireworks}</span>
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
