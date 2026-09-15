"use client";

import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

type VoiceSettings = GameSettings["voice"];

export function VoiceChatFields({
  value,
  onChange,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}) {
  const { locale, formatDistance } = useI18n();
  const copy = campaignWizardCopy(locale);
  const setRule = (rules: Partial<VoiceSettings["rules"]>) =>
    onChange({ ...value, rules: { ...value.rules, ...rules } });

  return (
    <div>
      <FieldLabel className="mb-1.5">{copy.voice.title}</FieldLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ToggleCard
          active={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          label={copy.voice.label}
          hint={copy.voice.hint}
        />
        {value.enabled ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">{copy.voice.turnFloor}</span>
              <select
                value={value.turnEnforcement}
                onChange={(event) =>
                  onChange({
                    ...value,
                    turnEnforcement: event.target.value as VoiceSettings["turnEnforcement"],
                  })
                }
                className={inputClass}
              >
                <option value="off">{copy.voice.turnsOff}</option>
                <option value="soft">{copy.voice.turnsSoft}</option>
                <option value="strict">{copy.voice.turnsStrict}</option>
              </select>
            </label>
            <ToggleCard
              active={value.rules.proximity}
              onClick={() => setRule({ proximity: !value.rules.proximity })}
              label={copy.voice.proximity}
              hint={copy.voice.proximityHint}
            />
            {value.rules.proximity ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">{copy.voice.hearingRange}</span>
                  <select
                    value={value.rules.hearingRangeFeet}
                    onChange={(event) => setRule({ hearingRangeFeet: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {[15, 30, 60, 120].map((feet) => (
                      <option key={feet} value={feet}>{formatDistance(feet)}</option>
                    ))}
                  </select>
                </label>
                <ToggleCard
                  active={value.rules.sayRange}
                  onClick={() => setRule({ sayRange: !value.rules.sayRange })}
                  label={copy.voice.whisperShout}
                  hint={copy.voice.whisperShoutHint}
                />
                <ToggleCard
                  active={value.rules.wallsAttenuate}
                  onClick={() => setRule({ wallsAttenuate: !value.rules.wallsAttenuate })}
                  label={copy.voice.walls}
                  hint={copy.voice.wallsHint}
                />
              </>
            ) : null}
            <ToggleCard
              active={value.rules.downedGoDeaf}
              onClick={() => setRule({ downedGoDeaf: !value.rules.downedGoDeaf })}
              label={copy.voice.downed}
              hint={copy.voice.downedHint}
            />
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">{copy.voice.serverHelp}</p>
    </div>
  );
}
