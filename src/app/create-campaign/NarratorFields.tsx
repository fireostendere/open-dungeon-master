"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    allies: "Companions",
    companionLabels: {
      auto: "Auto (solo: full; multiplayer: guests only)",
      full: "Party members and guests",
      guests: "Temporary guests only",
      off: "Off",
    },
    soloHelp: "Persistent companions travel with the party until dismissed; guests join for a scene or battle.",
    partyHelp: "Guests are friendly NPCs for a scene or battle; permanent companions stay until dismissed.",
    partyMembersAtOnce: "Permanent companions at once",
    guestsAtOnce: "Guests at once",
  },
  ru: {
    allies: "Спутники",
    companionLabels: {
      auto: "Авто (соло: постоянные; группа: только временные гости)",
      full: "Постоянные спутники и временные гости",
      guests: "Только временные гости",
      off: "Выкл.",
    },
    soloHelp: "Постоянные спутники путешествуют с группой, пока их не отпустят; гости приходят на сцену или бой.",
    partyHelp: "Гости — дружественные NPC для сцены или боя; постоянные спутники остаются, пока их не отпустят.",
    partyMembersAtOnce: "Постоянных спутников одновременно",
    guestsAtOnce: "Временных гостей одновременно",
  },
  pl: {
    allies: "Towarzysze",
    companionLabels: {
      auto: "Auto (solo: stali; wielu graczy: tylko goście)",
      full: "Stali towarzysze i goście",
      guests: "Tylko tymczasowi goście",
      off: "Wył.",
    },
    soloHelp: "Stali towarzysze podróżują z drużyną do odprawienia; goście dołączają na scenę lub walkę.",
    partyHelp: "Goście to przyjaźni NPC na scenę lub walkę; stali towarzysze zostają do odprawienia.",
    partyMembersAtOnce: "Stałych towarzyszy jednocześnie",
    guestsAtOnce: "Gości jednocześnie",
  },
} as const;

export function NarratorFields({ draft, patch, gates, className }: StepProps & { className?: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <FieldLabel className="mb-1.5">{copy.allies}</FieldLabel>
        <select
          value={draft.companions}
          onChange={(event) => patch({ companions: event.target.value as GameSettings["companions"] })}
          className={inputClass}
        >
          {(Object.keys(copy.companionLabels) as Array<GameSettings["companions"]>).map((mode) => (
            <option key={mode} value={mode}>{copy.companionLabels[mode]}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">{gates.solo ? copy.soloHelp : copy.partyHelp}</p>
        {draft.companions !== "off" ? (
          <div className="mt-2 grid grid-cols-2 gap-3">
            {draft.companions !== "guests" ? (
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">{copy.partyMembersAtOnce}</span>
                <select value={draft.maxCompanions} onChange={(event) => patch({ maxCompanions: Number(event.target.value) })} className={inputClass}>
                  {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">{copy.guestsAtOnce}</span>
              <select value={draft.maxGuests} onChange={(event) => patch({ maxGuests: Number(event.target.value) })} className={inputClass}>
                {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
