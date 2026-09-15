"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    allies: "AI allies",
    companionLabels: {
      auto: "Auto (solo: full; multiplayer: guests only)",
      full: "Party members and guests",
      guests: "Temporary guests only",
      off: "Off",
    },
    soloHelp:
      "Party members travel with you until dismissed; guests are allies who show up for a scene or a battle and then leave.",
    partyHelp:
      "Guests are friendly NPCs the DM brings in for a scene or a battle; they fight with real stats and leave when the fight ends. Party members stay until dismissed.",
    partyMembersAtOnce: "Party members at once",
    guestsAtOnce: "Guests at once",
    narratorVoice: "Narrator voice",
  },
  ru: {
    allies: "ИИ-союзники",
    companionLabels: {
      auto: "Авто (соло: постоянные; группа: только временные гости)",
      full: "Постоянные участники и временные гости",
      guests: "Только временные гости",
      off: "Выкл.",
    },
    soloHelp:
      "Постоянные спутники путешествуют с вами, пока вы их не отпустите; временные гости приходят на сцену или бой и затем уходят.",
    partyHelp:
      "Временные гости — дружелюбные NPC, которых Мастер вводит для сцены или боя; у них настоящие характеристики, а после эпизода они уходят. Постоянные спутники остаются, пока их не отпустят.",
    partyMembersAtOnce: "Постоянных спутников одновременно",
    guestsAtOnce: "Временных гостей одновременно",
    narratorVoice: "Голос рассказчика",
  },
  pl: {
    allies: "Sojusznicy AI",
    companionLabels: {
      auto: "Auto (solo: pełni towarzysze; wielu graczy: tylko goście)",
      full: "Członkowie drużyny i goście",
      guests: "Tylko tymczasowi goście",
      off: "Wył.",
    },
    soloHelp:
      "Stali towarzysze podróżują z tobą, dopóki ich nie odprawisz; goście pojawiają się na scenę lub walkę, a potem odchodzą.",
    partyHelp:
      "Goście to przyjaźni NPC wprowadzani przez Mistrza Gry na scenę lub walkę; mają prawdziwe statystyki i odchodzą po zakończeniu epizodu. Stali członkowie drużyny zostają, dopóki ich nie odprawisz.",
    partyMembersAtOnce: "Stałych towarzyszy jednocześnie",
    guestsAtOnce: "Gości jednocześnie",
    narratorVoice: "Głos narratora",
  },
} as const;

// The second half of "the feel": who else the AI brings to the table, and
// what its narrator sounds like. Allies only exist when the AI narrates;
// the voice picker only matters once narration is on.
export function NarratorFields({
  draft,
  patch,
  gates,
  className,
}: StepProps & { className?: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { aiNarrates, solo } = gates;
  return (
    <div className={cn("space-y-4", className)}>
      {aiNarrates ? (
        <div>
          <FieldLabel className="mb-1.5">{copy.allies}</FieldLabel>
          <select
            value={draft.companions}
            onChange={(event) =>
              patch({ companions: event.target.value as GameSettings["companions"] })
            }
            className={inputClass}
          >
            {(Object.keys(copy.companionLabels) as Array<GameSettings["companions"]>).map((mode) => (
              <option key={mode} value={mode}>
                {copy.companionLabels[mode]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{solo ? copy.soloHelp : copy.partyHelp}</p>
          {draft.companions !== "off" ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {draft.companions !== "guests" ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">{copy.partyMembersAtOnce}</span>
                  <select
                    value={draft.maxCompanions}
                    onChange={(event) => patch({ maxCompanions: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">{copy.guestsAtOnce}</span>
                <select
                  value={draft.maxGuests}
                  onChange={(event) => patch({ maxGuests: Number(event.target.value) })}
                  className={inputClass}
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.ttsEnabled ? (
        <div className="block">
          <FieldLabel>{copy.narratorVoice}</FieldLabel>
          <div className="flex items-center gap-2">
            <select
              value={draft.ttsVoice}
              onChange={(event) => patch({ ttsVoice: event.target.value })}
              className={inputClass}
            >
              {TTS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
            <VoicePreviewButton voice={draft.ttsVoice} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
