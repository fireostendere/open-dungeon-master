"use client";

import { useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Award, Dices, Sparkles, Trophy, X } from "lucide-react";
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
  onTriggerCelebration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignTitle: string;
  message?: CampaignMessage | null;
  sheets?: CharacterSheet[];
  onTriggerCelebration?: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Closing Message from the Dungeon Master",
      subtitle: "The adventure has reached its grand conclusion",
      fallbackProse:
        "The dust settles upon the battlefield, and the echoes of triumph resonate throughout the realm. The heroes have braved perils untold, forged bonds unbroken, and etched their names into legend. Their deeds shall be sung by bards for generations to come.",
      partyTitle: "Heroes of the Realm",
      level: "Level",
      replayFireworks: "Launch fireworks & dice salute",
      close: "Close and view table",
    },
    ru: {
      title: "Закрывающее послание Мастера",
      subtitle: "Приключение подошло к своему грандиозному финалу",
      fallbackProse:
        "Пыль битвы оседает, и эхо триумфа разносится по всему королевству. Герои преодолели немыслимые опасности, скрепили нерушимые узы и вписали свои имена в легенды. Их подвиги будут воспевать барды многих грядущих эпох.",
      partyTitle: "Герои королевства",
      level: "Уровень",
      replayFireworks: "Запустить салют из кубов и фейерверков",
      close: "Закрыть и смотреть стол",
    },
    pl: {
      title: "Zamykające przesłanie Mistrza Gry",
      subtitle: "Przygoda dotarła do swojego wielkiego finału",
      fallbackProse:
        "Opadają bitewne pyły, a echo tryumfu rozbrzmiewa w całym królestwie. Bohaterowie stawili czoła niewypowiedzianym niebezpieczeństwom i wyryli swoje imiona w legendach. Ich czyny będą opiewane przez pokolenia.",
      partyTitle: "Bohaterowie królestwa",
      level: "Poziom",
      replayFireworks: "Wystrzel salwę kości i fajerwerków",
      close: "Zamknij i zobacz stół",
    },
  });

  const content = message?.content?.trim() || copy.fallbackProse;

  // Trigger celebration as soon as modal opens
  const hasTriggeredRef = useRef(false);
  useEffect(() => {
    if (open && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      onTriggerCelebration?.();
    }
    if (!open) {
      hasTriggeredRef.current = false;
    }
  }, [open, onTriggerCelebration]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in-0 duration-200" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border-2 border-amber-500/50 bg-gradient-to-b from-stone-900 via-stone-950 to-black p-6 sm:p-8 text-stone-100 shadow-[0_0_60px_rgba(245,158,11,0.25)] animate-in zoom-in-95 duration-200">
            {/* Corner Ornamental Accents */}
            <div className="pointer-events-none absolute -top-1.5 -left-1.5 size-4 border-t-2 border-l-2 border-amber-300" />
            <div className="pointer-events-none absolute -top-1.5 -right-1.5 size-4 border-t-2 border-r-2 border-amber-300" />
            <div className="pointer-events-none absolute -bottom-1.5 -left-1.5 size-4 border-b-2 border-l-2 border-amber-300" />
            <div className="pointer-events-none absolute -bottom-1.5 -right-1.5 size-4 border-b-2 border-r-2 border-amber-300" />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition"
              aria-label={copy.close}
            >
              <X className="size-5" />
            </button>

            {/* Header */}
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/20 to-amber-600/10 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                <Trophy className="size-7 animate-pulse" />
              </div>
              <p className="eyebrow text-xs font-semibold tracking-widest text-amber-400">
                {campaignTitle}
              </p>
              <Dialog.Title className="mt-1 font-display text-2xl font-bold tracking-wide text-amber-100 sm:text-3xl">
                {copy.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-amber-200/70 sm:text-sm">
                {copy.subtitle}
              </Dialog.Description>
            </div>

            {/* Decorative Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
              <Dices className="size-4 text-amber-400/80" />
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
            </div>

            {/* DM's Message Content (Scroll/Parchment Style) */}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-amber-500/20 bg-amber-950/20 p-5 sm:p-6 shadow-inner">
              <p className="whitespace-pre-wrap font-serif text-base sm:text-lg leading-relaxed text-amber-100/95 first-letter:text-3xl first-letter:font-bold first-letter:text-amber-300 first-letter:float-left first-letter:mr-2">
                {content}
              </p>
            </div>

            {/* Surviving Heroes Summary */}
            {sheets.length > 0 ? (
              <div className="mt-6">
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
            <div className="mt-8 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={cn(ui.btnSecondary, "text-xs py-2")}
              >
                {copy.close}
              </button>
              <button
                type="button"
                onClick={() => onTriggerCelebration?.()}
                className={cn(ui.btnPrimary, "text-xs py-2 gap-1.5 shadow-[0_0_20px_rgba(245,158,11,0.3)]")}
              >
                <Sparkles className="size-4 text-amber-950" />
                {copy.replayFireworks}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
