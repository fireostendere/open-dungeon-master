"use client";

import { Copy, Hammer, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconChip, ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkshopSummary } from "@/app/workshop/types";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function WorkshopSection({
  workshops,
  cloningId,
  onClone,
}: {
  workshops: WorkshopSummary[];
  cloningId: string;
  onClone: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const copy = localeText(locale, {
    en: {
      body: "Build maps, NPCs, monsters, story and rules before a table exists.",
      open: "Open workshop",
      partyOf: "Party of",
      atLevel: "at level",
      duplicateTip: "Copy this workshop and everything in it",
      duplicate: "Duplicate",
      empty: "Nothing on the bench yet. A workshop is yours alone, and nothing in it reaches a table until you bring it in.",
    },
    ru: {
      body: "Готовьте карты, NPC, монстров, сюжет и правила ещё до создания игрового стола.",
      open: "Открыть мастерскую",
      partyOf: "Партия из",
      atLevel: "на уровне",
      duplicateTip: "Скопировать мастерскую вместе со всем её содержимым",
      duplicate: "Дублировать",
      empty: "На верстаке пока пусто. Мастерская принадлежит только вам, и ничего из неё не попадёт в игру, пока вы сами это не перенесёте.",
    },
  });
  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconChip icon={Hammer} size="size-9" iconSize="size-4" />
          <div>
            <h2 className="eyebrow text-sm text-amber-200/90">{t("nav.workshop")}</h2>
            <p className="text-xs text-stone-500">{copy.body}</p>
          </div>
        </div>
        <Link href="/workshop" className={ui.btnSecondary}>
          <Hammer className="size-4" /> {copy.open}
        </Link>
      </div>

      {workshops.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workshops.map((workshop) => (
            <li key={workshop.id} className={cn(ui.cardHover, "group relative px-5 py-4")}>
              <Link href={`/workshop/${workshop.id}`} className="block">
                <p className="min-w-0 truncate pr-8 font-display text-lg tracking-wide text-amber-50">
                  {workshop.title}
                </p>
                <p className="text-sm text-stone-400">
                  {copy.partyOf} {workshop.gameSettings.targetParty.size} {copy.atLevel}{" "}
                  {workshop.gameSettings.targetParty.level}
                </p>
              </Link>
              <Tooltip content={copy.duplicateTip}>
                <button
                  type="button"
                  aria-label={`${copy.duplicate} ${workshop.title}`}
                  disabled={cloningId === workshop.id}
                  onClick={() => onClone(workshop.id)}
                  className={cn("absolute right-2 top-2", ui.iconAction, "hover:text-amber-300")}
                >
                  {cloningId === workshop.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-stone-800 bg-stone-950/40 px-5 py-4 text-sm text-stone-500">
          {copy.empty}
        </p>
      )}
    </section>
  );
}
