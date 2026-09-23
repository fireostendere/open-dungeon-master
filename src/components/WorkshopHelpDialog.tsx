"use client";

import {
  BookOpen,
  CircleHelp,
  Copy,
  Footprints,
  Hammer,
  Share2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { workshopGuides } from "@/lib/tours/workshop-guide";
import { Dialog } from "@/components/ui/Dialog";
import { Section } from "@/components/HelpDialog";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The workshop's own help. The main HelpDialog is written for a table
// mid-session; a workshop has no table, no transcript and no AI turns, so
// its help is its own read: the tours it can replay, a guide per tool (the
// open tool first and unfolded), and the short version of what a workshop
// is and how prep reaches a campaign. Opened from the shelf, the hub and
// every tool.

export type HelpTour = { label: string; detail: string; onStart: () => void };

export function WorkshopHelpDialog({
  open,
  onOpenChange,
  tours,
  system,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The tours this page can start; each closes the dialog first.
  tours?: HelpTour[];
  // The tool open right now, whose guide leads and starts unfolded.
  system?: string | null;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Workshop help", tours: "Guided tours", tools: "The tools, one by one", what: "What a workshop is", import: "Into a campaign, and back out", copying: "Copying things", rules: "Where the rules live", tourText: "A spotlight walk through the controls, one at a time. Each tour ran once when you first opened its page; take it again whenever you like.", toolsText: "What each tool is for, how a first session with it goes, and the things people miss.", first: " The tool you have open comes first.", whatText: "A prep space: everything a campaign holds, with no players, no transcript and no AI narrator. Build the material on your own time, then bring it into a real campaign when the table sits down. Nothing you do here can start a fight or move a story, because there is no story running. The stand-in party bar at the top sets the party size and level your prep is measured against, so encounter difficulty readouts mean something before real characters exist.", importText: "Creating a campaign offers a Bring in prep step: pick a workshop (or another campaign you can see) and choose what to copy in. A campaign lobby can import the same way after creation. Copies are copies: the workshop keeps its version, the campaign owns its own from then on, and name collisions get numbered instead of overwritten. The Share tool exports the whole workshop as a bundle file another server can import, and can compile a draft world pack from it.", copyingText: "A whole workshop can be cloned from the shelf or the hub, and individual pieces (maps, NPCs, monsters, encounters, tables, lore) each have a duplicate action. Homebrew monsters, items, spells and options belong to your account rather than to any one workshop, so they follow you everywhere but do not travel inside bundles sent to other people.", rulesText: "Everything here is still 5e underneath: attack expressions have to roll, challenge ratings show their working, and imported material behaves in a campaign exactly like material made there. When you want the numbers themselves, the rules reference and its calculators are one click away in the account menu." },
    ru: { title: "Справка по мастерской", tours: "Пошаговые туры", tools: "Инструменты по очереди", what: "Что такое мастерская", import: "В кампанию и обратно", copying: "Копирование", rules: "Где находятся правила", tourText: "Пошаговая подсветка элементов управления. Каждый тур запускается один раз при первом открытии страницы, но его можно повторить в любое время.", toolsText: "Назначение каждого инструмента, порядок первой работы с ним и важные детали.", first: " Открытый инструмент показан первым.", whatText: "Это пространство для подготовки: всё, что может быть в кампании, но без игроков, журнала и ИИ-ведущего. Создавайте материалы в удобное время, затем переносите их в кампанию перед игрой. Здесь нельзя начать бой или продвинуть сюжет, потому что активной истории нет. Панель условной группы сверху задаёт размер и уровень, по которым оценивается подготовка, поэтому сложность встреч имеет смысл ещё до появления настоящих персонажей.", importText: "При создании кампании доступен шаг «Добавить подготовку»: выберите мастерскую или другую доступную кампанию и укажите, что копировать. То же можно импортировать из лобби после создания. Копии независимы: версия остаётся в мастерской, а кампания получает собственную; совпадающие названия нумеруются, а не перезаписываются. Инструмент «Поделиться» экспортирует всю мастерскую в файл набора, который можно импортировать на другом сервере, и может собрать черновик пакета мира.", copyingText: "Всю мастерскую можно клонировать со списка или из главной страницы, а карты, неигровых персонажей, монстров, встречи, таблицы и записи лора — дублировать по отдельности. Хоумбрю-монстры, предметы, заклинания и опции принадлежат вашей учётной записи, поэтому доступны везде, но не передаются в наборах другим людям.", rulesText: "В основе всего по-прежнему 5e: выражения атак должны бросаться, рейтинги опасности показывают расчёт, а импортированные материалы в кампании работают так же, как созданные в ней. Справочник правил и калькуляторы доступны в меню учётной записи." },
  });
  const localizedGuides = workshopGuides(locale);
  const guides = [
    ...localizedGuides.filter((guide) => guide.id === system),
    ...localizedGuides.filter((guide) => guide.id !== system),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      icon={<CircleHelp className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      {tours && tours.length ? (
        <Section icon={Footprints} title={copy.tours}>
          <p>{copy.tourText}</p>
          <div className="flex flex-wrap gap-2">
            {tours.map((tour) => (
              <button
                key={tour.label}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  tour.onStart();
                }}
                className={ui.btnSmall}
                title={tour.detail}
              >
                <Footprints className="size-4" /> {tour.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}
      <Section icon={Wrench} title={copy.tools}>
        <p>
          {copy.toolsText}{system ? copy.first : ""}
        </p>
        <div className="space-y-1.5">
          {guides.map((guide) => (
            <details
              key={guide.id}
              open={guide.id === system}
              className="group rounded-lg border border-stone-800 bg-stone-950/50"
            >
              <summary
                className={cn(
                  "cursor-pointer list-none px-3 py-2 font-display text-sm tracking-wide text-amber-100 marker:content-none",
                  "flex items-baseline gap-2",
                )}
              >
                <span>{guide.title}</span>
                <span className="text-xs font-normal normal-case tracking-normal text-stone-500">
                  {guide.purpose}
                </span>
              </summary>
              <div className="space-y-2 border-t border-stone-800/70 px-3 py-2">
                <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-300">
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {guide.tips.length ? (
                  <ul className="space-y-1 text-xs text-stone-500">
                    {guide.tips.map((tip) => (
                      <li key={tip} className="flex gap-1.5">
                        <span className="text-amber-500/70">&#8226;</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </Section>
      <Section icon={Hammer} title={copy.what}>
        <p>
          {copy.whatText}
        </p>
      </Section>
      <Section icon={Share2} title={copy.import}>
        <p>
          {copy.importText}
        </p>
      </Section>
      <Section icon={Copy} title={copy.copying}>
        <p>
          {copy.copyingText}
        </p>
      </Section>
      <Section icon={BookOpen} title={copy.rules}>
        <p>
          {copy.rulesText}
        </p>
      </Section>
    </Dialog>
  );
}
