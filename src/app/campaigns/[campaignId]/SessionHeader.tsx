"use client";

import Link from "next/link";
import {
  CircleHelp,
  Dices,
  DoorOpen,
  MoreHorizontal,
  Music,
  Music2,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import { AccountMenu, AppHomeButton, AppHomeLogo, type AccountMenuUser } from "@/components/AccountMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { Sheet } from "@/components/ui/Sheet";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { NarratorLamp, NarratorLampRow } from "@/app/campaigns/[campaignId]/NarratorLamp";
import type { NarratorLamp as NarratorLampView } from "@/app/campaigns/[campaignId]/narratorLampState";
import { VoiceDock } from "@/app/campaigns/[campaignId]/VoiceDock";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { AmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

function HeaderAudioControl({
  onLabel,
  offLabel,
  enableLabel,
  volumeLabel,
  unlocked,
  muted,
  volume,
  onToggle,
  onVolume,
  OnIcon,
  OffIcon,
}: {
  onLabel: string;
  offLabel: string;
  enableLabel: string;
  volumeLabel: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (value: number) => void;
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
}) {
  const quiet = muted || !unlocked;
  const toggleLabel = !unlocked ? enableLabel : muted ? offLabel : onLabel;
  const buttonClass = headerButtonClass(!quiet);
  const icon = quiet ? <OffIcon className="size-4" /> : <OnIcon className="size-4" />;

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip content={toggleLabel} side="bottom">
        <button type="button" onClick={onToggle} aria-label={toggleLabel} className={buttonClass}>
          {icon}
        </button>
      </Tooltip>
      {unlocked && !muted ? (
        <Tooltip content={volumeLabel} side="bottom">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
            className="w-16 accent-amber-600"
            aria-label={volumeLabel}
          />
        </Tooltip>
      ) : null}
    </div>
  );
}

// Mobile deliberately stays one compact row: logo, truncated campaign title,
// the narrator lamp's dot, voice, and one overflow menu. The rest of the table
// controls live in the sheet so the story starts immediately below the header.
export function SessionHeader({
  title,
  scene,
  user,
  narrator,
  voice,
  dice3d,
  onToggleDice3d,
  ambienceEnabled,
  ambience,
  onHelp,
}: {
  title: string;
  scene: string;
  user: AccountMenuUser;
  narrator: NarratorLampView;
  voice: ComponentProps<typeof VoiceDock>;
  dice3d: boolean;
  onToggleDice3d: () => void;
  ambienceEnabled: boolean;
  ambience: AmbienceAudio;
  onHelp: () => void;
}) {
  const { locale } = useI18n();
  const [toolsOpen, setToolsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const copy = localeText(locale, {
    en: {
      diceOn: "Turn on 3D dice animation",
      diceOff: "Turn off 3D dice animation",
      scene: "The adventure unfolds",
      help: "Help",
      helpTip: "How everything works, and the guided tours",
      campaigns: "All campaigns",
      tools: "Table tools",
      account: "Your account",
      language: "Language",
      ambienceOn: "Mute ambience and music",
      ambienceOff: "Enable ambience and music",
      ambienceEnable: "Enable ambience",
      volume: "Ambience and music volume",
    },
    ru: {
      diceOn: "Включить 3D-анимацию кубиков",
      diceOff: "Выключить 3D-анимацию кубиков",
      scene: "Приключение начинается",
      help: "Помощь",
      helpTip: "Как всё устроено и как пройти обучение",
      campaigns: "Все кампании",
      tools: "Инструменты стола",
      account: "Ваш аккаунт",
      language: "Язык",
      ambienceOn: "Выключить музыку и звуки окружения",
      ambienceOff: "Включить музыку и звуки окружения",
      ambienceEnable: "Включить звуки окружения",
      volume: "Громкость музыки и окружения",
    },
  });

  const diceLabel = dice3d ? copy.diceOff : copy.diceOn;
  const audioActive = ambience.unlocked && !ambience.muted;
  const audioLabel = audioActive ? copy.ambienceOn : copy.ambienceOff;
  const AudioIcon = audioActive ? Music : Music2;

  const toggleAudio = () => {
    ambience.unlock();
    ambience.setMuted(ambience.unlocked ? !ambience.muted : false);
  };

  const changeTools = (open: boolean) => {
    setToolsOpen(open);
    if (!open) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  return (
    <header className="glass z-10 flex items-center gap-3 border-b border-stone-700/40 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AppHomeLogo />
        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-display text-base leading-snug tracking-wide text-amber-50 lg:text-lg"
            title={title}
          >
            {title}
          </h1>
          <p className="truncate text-xs text-stone-500" title={scene || copy.scene}>
            {scene || copy.scene}
          </p>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NarratorLamp lamp={narrator} />
        <VoiceDock {...voice} />

        <button
          ref={triggerRef}
          type="button"
          onClick={() => changeTools(true)}
          aria-label={copy.tools}
          aria-haspopup="dialog"
          aria-expanded={toolsOpen}
          className="inline-flex size-11 items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-stone-800 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 lg:hidden"
        >
          <MoreHorizontal className="size-5" />
        </button>

        <div className="hidden items-center gap-2.5 lg:flex">
          <Tooltip content={diceLabel} side="bottom">
            <button
              type="button"
              onClick={onToggleDice3d}
              aria-label={diceLabel}
              data-tour="header-dice"
              className={headerButtonClass(dice3d)}
            >
              <Dices className="size-4" />
            </button>
          </Tooltip>

          {ambienceEnabled && ambience.installed ? (
            <HeaderAudioControl
              onLabel={copy.ambienceOn}
              offLabel={copy.ambienceOff}
              enableLabel={copy.ambienceEnable}
              volumeLabel={copy.volume}
              unlocked={ambience.unlocked}
              muted={ambience.muted}
              volume={ambience.volume}
              onToggle={toggleAudio}
              onVolume={(value) => ambience.setVolume(value)}
              OnIcon={Music}
              OffIcon={Music2}
            />
          ) : null}

          <Tooltip content={copy.helpTip} side="bottom">
            <button
              type="button"
              onClick={onHelp}
              aria-label={copy.help}
              data-tour="header-help"
              className={headerButtonClass(false)}
            >
              <CircleHelp className="size-4" />
            </button>
          </Tooltip>

          <Tooltip content={copy.campaigns} side="bottom">
            <Link
              href="/"
              aria-label={copy.campaigns}
              className="flex items-center gap-1.5 rounded-lg border border-stone-700/70 px-2.5 py-1.5 text-sm text-stone-500 transition-colors hover:text-amber-200"
            >
              <DoorOpen className="size-4" />
              <span>{copy.campaigns}</span>
            </Link>
          </Tooltip>

          <LanguageSwitcher />
          <AppHomeButton />
          <AccountMenu user={user} onHelp={onHelp} />
        </div>
      </div>

      <Sheet
        open={toolsOpen}
        onOpenChange={changeTools}
        title={copy.tools}
        className="lg:hidden"
      >
        <p className="mb-1 break-words font-display text-lg text-amber-100">{title}</p>
        <p className="mb-4 break-words text-sm text-stone-400">{scene || copy.scene}</p>

        <div className="flex flex-col gap-2">
          <NarratorLampRow lamp={narrator} />

          <button
            type="button"
            onClick={onToggleDice3d}
            aria-pressed={dice3d}
            data-tour="header-dice"
            className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-stone-900 px-3 py-2 text-left text-sm text-stone-200"
          >
            <Dices className="size-5" />
            <span>{diceLabel}</span>
          </button>

          {ambienceEnabled && ambience.installed ? (
            <div className="rounded-xl bg-stone-900">
              <button
                type="button"
                onClick={toggleAudio}
                aria-pressed={audioActive}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm text-stone-200"
              >
                <AudioIcon className="size-5" />
                <span>{audioLabel}</span>
              </button>
              <label className="flex flex-col gap-2 border-t border-stone-800 px-3 py-3 text-sm text-stone-300">
                {copy.volume}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ambience.volume}
                  onChange={(event) => ambience.setVolume(Number(event.target.value))}
                  className="w-full accent-amber-500"
                />
              </label>
            </div>
          ) : null}

          <button
            type="button"
            data-tour="header-help"
            onClick={() => {
              changeTools(false);
              onHelp();
            }}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-stone-900 px-3 py-2 text-left text-sm text-stone-200"
          >
            <CircleHelp className="size-5" />
            <span>{copy.help}</span>
          </button>

          <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-stone-900 px-3 py-2 text-sm text-stone-300">
            <span>{copy.language}</span>
            <LanguageSwitcher />
          </div>

          <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-stone-900 px-3 py-2 text-sm text-stone-300">
            <span>{copy.account}</span>
            <AccountMenu user={user} onHelp={onHelp} />
          </div>

          <Link
            href="/"
            className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-stone-900 px-3 py-2 text-sm text-stone-200"
          >
            <DoorOpen className="size-5" />
            <span>{copy.campaigns}</span>
          </Link>
        </div>
      </Sheet>
    </header>
  );
}
