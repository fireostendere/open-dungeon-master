"use client";

// The player's own animation settings for this device: dice, cinematics,
// particles, sounds, quality, how other people's rolls appear, and motion.
// Styled by fx.css (not Tailwind) so the standalone animations lab can show
// the very same panel.

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { useFxPrefs, useFxSettings, type FxMotion, type FxQuality } from "@/lib/fx/prefs";
import "./fx.css";

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className="fx-prefs__row">
      <span className="fx-prefs__text">
        <span className="fx-prefs__label" id={id}>
          {label}
        </span>
        <span className="fx-prefs__hint">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="fx-prefs__switch" onClick={() => onChange(!checked)}>
        <span className="fx-prefs__knob" aria-hidden="true" />
      </button>
    </div>
  );
}

function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div className="fx-prefs__choice">
      <span className="fx-prefs__label" id={id}>
        {label}
      </span>
      <div className="fx-prefs__segments" role="radiogroup" aria-labelledby={id} onKeyDown={onKeyDown}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            className="fx-prefs__segment"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <span className="fx-prefs__hint">{hint}</span> : null}
    </div>
  );
}

export function FxSettingsPanel({ className = "" }: { className?: string }) {
  const { locale } = useI18n();
  const [prefs, setPrefs] = useFxPrefs();
  const settings = useFxSettings();
  const copy = localeText(locale, {
    en: {
      dice: "3D dice",
      diceHint: "Your rolls and the DM's prompts on the whole screen",
      cinematics: "Cinematics",
      cinematicsHint: "Combat start, your turn, slain, victory, falling, loot, rest, level up",
      particles: "Particles and screen effects",
      particlesHint: "Sparks, flashes, screen shake",
      sound: "Effect sounds",
      soundHint: "Dice, drums and fanfares",
      quality: "Quality",
      auto: "Auto",
      full: "Full",
      lite: "Lite",
      autoLite: "Auto picked Lite on this device",
      autoFull: "Auto picked Full on this device",
      others: "Other players' rolls",
      othersFull: "Full",
      othersCompact: "Compact",
      othersOff: "Off",
      othersHint: "Compact is a small note under the header; your own rolls always play in full",
      motion: "Reduce motion",
      motionOn: "On",
      motionOff: "Off",
      motionAutoOn: "The system asks for less motion: calm versions play",
      motionAutoOff: "Follows the system setting",
    },
    ru: {
      dice: "3D-кубики",
      diceHint: "Ваши броски и запросы Мастера на весь экран",
      cinematics: "Заставки",
      cinematicsHint: "Начало боя, ваш ход, враг повержен, победа, падение, добыча, отдых, уровень",
      particles: "Частицы и эффекты экрана",
      particlesHint: "Искры, вспышки, тряска экрана",
      sound: "Звуки эффектов",
      soundHint: "Кубики, барабаны и фанфары",
      quality: "Качество",
      auto: "Авто",
      full: "Полное",
      lite: "Лёгкое",
      autoLite: "Авто выбрало лёгкое для этого устройства",
      autoFull: "Авто выбрало полное для этого устройства",
      others: "Броски других игроков",
      othersFull: "Целиком",
      othersCompact: "Кратко",
      othersOff: "Скрыть",
      othersHint: "«Кратко» — маленькая плашка под шапкой; ваши броски всегда показываются целиком",
      motion: "Меньше движения",
      motionOn: "Вкл",
      motionOff: "Выкл",
      motionAutoOn: "Система просит меньше движения: играют спокойные версии",
      motionAutoOff: "Как в настройках системы",
    },
  });

  return (
    <div className={`fx-prefs ${className}`}>
      <Toggle label={copy.dice} hint={copy.diceHint} checked={prefs.dice} onChange={(dice) => setPrefs({ dice })} />
      <Toggle label={copy.cinematics} hint={copy.cinematicsHint} checked={prefs.cinematics} onChange={(cinematics) => setPrefs({ cinematics })} />
      <Toggle label={copy.particles} hint={copy.particlesHint} checked={prefs.particles} onChange={(particles) => setPrefs({ particles })} />
      <Toggle label={copy.sound} hint={copy.soundHint} checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
      <Choice<FxQuality>
        label={copy.quality}
        value={prefs.quality}
        options={[
          { value: "auto", label: copy.auto },
          { value: "full", label: copy.full },
          { value: "lite", label: copy.lite },
        ]}
        hint={prefs.quality === "auto" ? (settings.lite ? copy.autoLite : copy.autoFull) : undefined}
        onChange={(quality) => setPrefs({ quality })}
      />
      <Choice<"full" | "compact" | "off">
        label={copy.others}
        value={settings.othersRolls}
        options={[
          { value: "full", label: copy.othersFull },
          { value: "compact", label: copy.othersCompact },
          { value: "off", label: copy.othersOff },
        ]}
        hint={copy.othersHint}
        onChange={(othersRolls) => setPrefs({ othersRolls })}
      />
      <Choice<FxMotion>
        label={copy.motion}
        value={prefs.motion}
        options={[
          { value: "auto", label: copy.auto },
          { value: "reduce", label: copy.motionOn },
          { value: "full", label: copy.motionOff },
        ]}
        hint={prefs.motion === "auto" ? (settings.reducedMotion ? copy.motionAutoOn : copy.motionAutoOff) : undefined}
        onChange={(motion) => setPrefs({ motion })}
      />
    </div>
  );
}
