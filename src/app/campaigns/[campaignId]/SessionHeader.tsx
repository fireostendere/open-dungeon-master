"use client";

import Link from "next/link";
import { CircleHelp, Dices, DoorOpen, MoreHorizontal, Music, Music2, type LucideIcon } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import { AccountMenu, AppHomeButton, AppHomeLogo, type AccountMenuUser } from "@/components/AccountMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { Sheet } from "@/components/ui/Sheet";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { VoiceDock } from "@/app/campaigns/[campaignId]/VoiceDock";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { AmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { useSessionMobile } from "./SessionViewport";

function HeaderAudioControl({ label, volumeLabel, active, volume, onToggle, onVolume, Icon }: {
  label: string; volumeLabel: string; active: boolean; volume: number;
  onToggle: () => void; onVolume: (value: number) => void; Icon: LucideIcon;
}) {
  return <div className="flex items-center gap-1.5">
    <Tooltip content={label} side="bottom">
      <button type="button" onClick={onToggle} aria-label={label} aria-pressed={active} className={headerButtonClass(active)}>
        <Icon className="size-4" />
      </button>
    </Tooltip>
    {active ? <input type="range" min={0} max={1} step={0.05} value={volume}
      onChange={event => onVolume(Number(event.target.value))} className="w-16 accent-amber-600" aria-label={volumeLabel} /> : null}
  </div>;
}

// VoiceDock has exactly one permanent position in this tree. Opening the tools,
// reading the story or switching panels must not disconnect/rejoin the call.
export function SessionHeader({ title, scene, user, voice, dice3d, onToggleDice3d, ambienceEnabled, ambience, onHelp }: {
  title: string; scene: string; user: AccountMenuUser; voice: ComponentProps<typeof VoiceDock>;
  dice3d: boolean; onToggleDice3d: () => void;
  ambienceEnabled: boolean; ambience: AmbienceAudio; onHelp: () => void;
}) {
  const { locale } = useI18n();
  const mobile = useSessionMobile();
  const [toolsOpen, setToolsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copy = localeText(locale, {
    en: { diceOn: "Turn on 3D dice animation", diceOff: "Turn off 3D dice animation", scene: "The adventure unfolds", help: "Help", helpTip: "How everything works, and the guided tours", campaigns: "All campaigns", tools: "Table tools", account: "Your account", language: "Language", mute: "Mute ambience and music", unmute: "Enable ambience and music", volume: "Ambience and music volume" },
    ru: { diceOn: "Включить 3D-анимацию кубиков", diceOff: "Выключить 3D-анимацию кубиков", scene: "Приключение начинается", help: "Помощь", helpTip: "Как всё устроено и как пройти обучение", campaigns: "Все кампании", tools: "Инструменты стола", account: "Ваш аккаунт", language: "Язык", mute: "Выключить музыку и звуки окружения", unmute: "Включить музыку и звуки окружения", volume: "Громкость музыки и окружения" },
  });
  const diceLabel = dice3d ? copy.diceOff : copy.diceOn;
  const audioActive = ambience.unlocked && !ambience.muted;
  const audioLabel = audioActive ? copy.mute : copy.unmute;
  const toggleAudio = () => { ambience.unlock(); ambience.setMuted(ambience.unlocked ? !ambience.muted : false); };
  const AudioIcon = audioActive ? Music : Music2;
  const changeTools = (open: boolean) => {
    setToolsOpen(open);
    if (!open) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  return <header className="session-header glass z-10 flex items-center gap-3 border-b border-stone-700/40 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
    <div className="session-heading flex min-w-0 flex-1 items-center gap-3">
      <AppHomeLogo />
      <div className="min-w-0 flex-1">
        <h1 className="session-title break-words font-display text-base leading-snug tracking-wide text-amber-50 lg:text-lg" title={title}>{title}</h1>
        <p className="truncate text-xs text-stone-500" title={scene}>{scene || copy.scene}</p>
      </div>
    </div>
    <div className="session-header-actions ml-auto flex shrink-0 items-center gap-2">
      <VoiceDock {...voice} />
      <button ref={triggerRef} type="button" className="session-header-more session-icon-button" aria-label={copy.tools}
        aria-haspopup="dialog" aria-expanded={toolsOpen && mobile} onClick={() => changeTools(true)}>
        <MoreHorizontal className="size-5" />
      </button>
      {!mobile ? <div className="session-header-desktop flex items-center gap-2.5">
        <Tooltip content={diceLabel} side="bottom"><button type="button" onClick={onToggleDice3d} aria-label={diceLabel} aria-pressed={dice3d}
          data-tour="header-dice" className={headerButtonClass(dice3d)}><Dices className="size-4" /></button></Tooltip>
        {ambienceEnabled && ambience.installed ? <HeaderAudioControl label={audioLabel} volumeLabel={copy.volume}
          active={audioActive} volume={ambience.volume} onToggle={toggleAudio} onVolume={ambience.setVolume} Icon={AudioIcon} /> : null}
        <Tooltip content={copy.helpTip} side="bottom"><button type="button" onClick={onHelp} aria-label={copy.help}
          data-tour="header-help" className={headerButtonClass(false)}><CircleHelp className="size-4" /></button></Tooltip>
        <Tooltip content={copy.campaigns} side="bottom"><Link href="/" aria-label={copy.campaigns}
          className="flex items-center gap-1.5 rounded-lg border border-stone-700/70 px-2.5 py-1.5 text-sm text-stone-500 hover:text-amber-200">
          <DoorOpen className="size-4" /><span>{copy.campaigns}</span>
        </Link></Tooltip>
        <LanguageSwitcher /><AppHomeButton /><AccountMenu user={user} onHelp={onHelp} />
      </div> : null}
    </div>
    <Sheet open={toolsOpen && mobile} onOpenChange={changeTools} title={copy.tools} className="session-menu">
      <p className="mb-1 break-words font-display text-lg text-amber-100">{title}</p>
      <p className="mb-4 break-words text-sm text-stone-400">{scene || copy.scene}</p>
      <div className="session-menu-list">
        <button type="button" onClick={onToggleDice3d} aria-pressed={dice3d} data-tour="header-dice">
          <Dices className="size-5" /><span>{diceLabel}</span>
        </button>
        {ambienceEnabled && ambience.installed ? <div className="session-audio-settings">
          <button type="button" onClick={toggleAudio} aria-pressed={audioActive}><AudioIcon className="size-5" /><span>{audioLabel}</span></button>
          <label className="flex flex-col gap-2 p-3 text-sm text-stone-300">{copy.volume}
            <input type="range" min={0} max={1} step={0.05} value={ambience.volume}
              onChange={event => ambience.setVolume(Number(event.target.value))} className="w-full accent-amber-500" />
          </label>
        </div> : null}
        <button type="button" data-tour="header-help" onClick={() => { setToolsOpen(false); onHelp(); }}><CircleHelp className="size-5" /><span>{copy.help}</span></button>
        <div className="session-menu-setting"><span>{copy.language}</span><LanguageSwitcher /></div>
        <div className="session-menu-setting"><span>{copy.account}</span><AccountMenu user={user} onHelp={() => { setToolsOpen(false); onHelp(); }} /></div>
        <Link href="/"><DoorOpen className="size-5" /><span>{copy.campaigns}</span></Link>
      </div>
    </Sheet>
  </header>;
}
