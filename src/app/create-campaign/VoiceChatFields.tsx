"use client";

import { useI18n } from "@/lib/i18n";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";

type VoiceSettings = GameSettings["voice"];

const COPY = {
  en: {
    voiceChat: "Voice chat",
    voiceHint: "Talk live in the lobby and at the table",
    turnFloor: "Turn floor",
    turnOff: "Turns: ignored",
    turnSoft: "Turns: shown",
    turnStrict: "Turns: enforced",
    proximity: "Proximity",
    proximityHint: "The battle map decides who hears whom",
    hearingRange: "Hearing range",
    feet: (value: number) => `${value} ft`,
    sayRange: "Whisper and shout",
    sayRangeHint: "Speakers pick how far their words carry",
    walls: "Walls muffle",
    wallsHint: "A wall muffles a voice instead of cutting it",
    downed: "Downed go deaf",
    downedHint: "At 0 hit points a character stops hearing the table",
    serverHint:
      "The server has its own switch for live audio too; if the owner keeps it off, these settings wait until it is on.",
  },
  ru: {
    voiceChat: "Голосовой чат",
    voiceHint: "Разговаривайте вживую в лобби и за игровым столом",
    turnFloor: "Очередность речи",
    turnOff: "Ходы не учитываются",
    turnSoft: "Ходы только показываются",
    turnStrict: "Ходы строго соблюдаются",
    proximity: "Слышимость по расстоянию",
    proximityHint: "Боевая карта определяет, кто кого слышит",
    hearingRange: "Дальность слышимости",
    feet: (value: number) => `${value} футов`,
    sayRange: "Шёпот и крик",
    sayRangeHint: "Говорящий выбирает, насколько далеко слышны его слова",
    walls: "Стены приглушают",
    wallsHint: "Стена приглушает голос, а не обрывает его полностью",
    downed: "Без сознания не слышно",
    downedHint: "При 0 HP персонаж перестаёт слышать голосовой чат",
    serverHint:
      "На сервере есть отдельный глобальный переключатель голосового чата. Если владелец сервера его выключил, эти настройки начнут действовать после включения.",
  },
} as const;

// Live voice for a multiplayer table: the master switch, then the turn
// floor and the proximity rules that only mean something once it is on.
// A solo table never mounts this block; there is nobody to talk to.
export function VoiceChatFields({
  value,
  onChange,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const setRule = (rules: Partial<VoiceSettings["rules"]>) =>
    onChange({ ...value, rules: { ...value.rules, ...rules } });
  return (
    <div>
      <FieldLabel className="mb-1.5">{copy.voiceChat}</FieldLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ToggleCard
          active={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          label={copy.voiceChat}
          hint={copy.voiceHint}
        />
        {value.enabled ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">{copy.turnFloor}</span>
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
                <option value="off">{copy.turnOff}</option>
                <option value="soft">{copy.turnSoft}</option>
                <option value="strict">{copy.turnStrict}</option>
              </select>
            </label>
            <ToggleCard
              active={value.rules.proximity}
              onClick={() => setRule({ proximity: !value.rules.proximity })}
              label={copy.proximity}
              hint={copy.proximityHint}
            />
            {value.rules.proximity ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">{copy.hearingRange}</span>
                  <select
                    value={value.rules.hearingRangeFeet}
                    onChange={(event) => setRule({ hearingRangeFeet: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {[15, 30, 60, 120].map((feet) => (
                      <option key={feet} value={feet}>
                        {copy.feet(feet)}
                      </option>
                    ))}
                  </select>
                </label>
                <ToggleCard
                  active={value.rules.sayRange}
                  onClick={() => setRule({ sayRange: !value.rules.sayRange })}
                  label={copy.sayRange}
                  hint={copy.sayRangeHint}
                />
                <ToggleCard
                  active={value.rules.wallsAttenuate}
                  onClick={() => setRule({ wallsAttenuate: !value.rules.wallsAttenuate })}
                  label={copy.walls}
                  hint={copy.wallsHint}
                />
              </>
            ) : null}
            <ToggleCard
              active={value.rules.downedGoDeaf}
              onClick={() => setRule({ downedGoDeaf: !value.rules.downedGoDeaf })}
              label={copy.downed}
              hint={copy.downedHint}
            />
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">{copy.serverHint}</p>
    </div>
  );
}
