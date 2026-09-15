"use client";

import { cn } from "@/lib/cn";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { COMPANION_SETTINGS, type CompanionSetting } from "@/lib/schemas/game-settings-options";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

export function NarratorFields({
  draft,
  patch,
  gates,
  className,
}: StepProps & { className?: string }) {
  const { locale } = useI18n();
  const copy = campaignWizardCopy(locale);
  const { aiNarrates, solo } = gates;
  const companionCopy: Record<CompanionSetting, string> = {
    auto: copy.companions.auto,
    full: copy.companions.full,
    guests: copy.companions.guests,
    off: copy.companions.off,
  };

  return (
    <div className={cn("space-y-4", className)}>
      {aiNarrates ? (
        <div>
          <FieldLabel className="mb-1.5">{copy.narrator.allies}</FieldLabel>
          <select
            value={draft.companions}
            onChange={(event) =>
              patch({ companions: event.target.value as GameSettings["companions"] })
            }
            className={inputClass}
          >
            {COMPANION_SETTINGS.map((mode) => (
              <option key={mode} value={mode}>
                {companionCopy[mode]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            {solo ? copy.narrator.soloHelp : copy.narrator.multiHelp}
          </p>
          {draft.companions !== "off" ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {draft.companions !== "guests" ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">{copy.narrator.partyAtOnce}</span>
                  <select
                    value={draft.maxCompanions}
                    onChange={(event) => patch({ maxCompanions: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">{copy.narrator.guestsAtOnce}</span>
                <select
                  value={draft.maxGuests}
                  onChange={(event) => patch({ maxGuests: Number(event.target.value) })}
                  className={inputClass}
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.ttsEnabled ? (
        <div className="block">
          <FieldLabel>{copy.narrator.narratorVoice}</FieldLabel>
          <div className="flex items-center gap-2">
            <select
              value={draft.ttsVoice}
              onChange={(event) => patch({ ttsVoice: event.target.value })}
              className={inputClass}
            >
              {TTS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.label}</option>
              ))}
            </select>
            <VoicePreviewButton voice={draft.ttsVoice} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
