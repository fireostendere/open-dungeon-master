"use client";

import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoChipList } from "@/components/ui/InfoDialog";
import { SheetSpells } from "@/components/sheet/SheetSpells";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import {
  contentSlug,
  describeFeature,
  describeRaceTrait,
  localizedContentName,
  localizedFeatureName,
  localizedRaceTraitName,
} from "@/lib/help";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { abilityMod, formatModifier } from "@/lib/srd";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";

export type CharacterEvent = {
  id: string;
  campaignId: string;
  kind: string;
  summary: string;
  createdAt: string;
};

const KIND_LABELS: Record<string, Record<"en" | "ru", string>> = {
  achievement: { en: "Achievement", ru: "Достижение" },
  item: { en: "Treasure", ru: "Сокровище" },
  relationship: { en: "Bond", ru: "Связь" },
  death: { en: "Death", ru: "Смерть" },
  level_up: { en: "Level up", ru: "Новый уровень" },
  story: { en: "Story", ru: "Сюжет" },
};

// A titled block of the read-only sheet: Ribbon rule, then whatever the
// section shows. Same shape as the builder's StepPanel so the detail page
// reads like the wizard that made it.
function SheetPanel({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(ui.card, "p-4", className)}>
      <Ribbon className="mb-3">{title}</Ribbon>
      {children}
    </section>
  );
}

// The six scores, the vitals line, and the lists a library sheet carries:
// spells, equipment, features, feats, backstory. Read-only; editing happens
// through the builder in a campaign lobby.
export function SheetSections({ sheet, level = 1 }: { sheet: CreateSheetInput; level?: number }) {
  const { locale, formatDistance } = useI18n();
  const copy = localeText(locale, {
    en: { abilities: "Abilities", speed: "Speed", gold: "Gold", spells: "Spells", equipment: "Equipment", features: "Features and traits", feats: "Feats", backstory: "Backstory", none: "None chosen.", story: "(story)", level: "Level" },
    ru: { abilities: "Характеристики", speed: "Скорость", gold: "Золото", spells: "Заклинания", equipment: "Снаряжение", features: "Черты и особенности", feats: "Черты", backstory: "Предыстория", none: "Ничего не выбрано.", story: "(сюжет)", level: "Уровень" },
  });
  const abilities = sheet.abilities;
  return (
    <div className="space-y-4">
      <SheetPanel title={copy.abilities} className="ornate">
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(Object.entries(abilities) as Array<[string, number]>).map(([ability, score]) => (
            <div
              key={ability}
              className="rounded-lg border border-stone-700/60 bg-stone-950/60 p-2 shadow-[0_2px_6px_rgba(4,2,12,0.45)_inset]"
            >
              <p className="eyebrow flex items-center justify-center gap-1 text-[10px] text-stone-500">
                <GameIcon icon={{ kind: "glyph", key: `ability-${ability}` }} size="size-5" />
                {characterDisplay(ability, locale)}
              </p>
              <p className="font-display text-xl text-amber-50">{score}</p>
              <p className="text-xs text-amber-200/80">{formatModifier(abilityMod(score))}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-stone-300 sm:grid-cols-4">
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-5" />
            <GameTerm id="hit_points">HP</GameTerm> {sheet.maxHp}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-ac" }} size="size-5" />
            <GameTerm id="armor_class">AC</GameTerm> {sheet.ac}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-speed" }} size="size-5" />
            {copy.speed} {formatDistance(sheet.speed)}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "coin-gp" }} size="size-5" />
            {copy.gold} {sheet.gold}
          </span>
        </div>
      </SheetPanel>

      {sheet.spellcasting ? (
         <SheetPanel title={copy.spells}>
          <SheetSpells sheet={{ ...sheet, level }} />
        </SheetPanel>
      ) : null}

      {sheet.equipment.length ? (
         <SheetPanel title={copy.equipment}>
          <InfoChipList
            items={sheet.equipment.map((item) => ({
              icon: { kind: "item" as const, key: item.name, family: "item-gear" },
              name: item.qty > 1 ? `${localizedContentName("items", item.name, locale)} ×${item.qty}` : localizedContentName("items", item.name, locale),
              reference: { kind: "items", slug: contentSlug(item.name), name: item.name },
            }))}
          />
        </SheetPanel>
      ) : null}

      {sheet.features?.length ? (
         <SheetPanel title={copy.features}>
          <InfoChipList
            items={sheet.features.map((feature) => ({
              name: feature.source === "race"
                ? localizedRaceTraitName(feature.name, locale)
                : localizedFeatureName(sheet.class, sheet.subclass, feature.name, locale) === feature.name
                  ? characterDisplay(feature.name, locale)
                  : localizedFeatureName(sheet.class, sheet.subclass, feature.name, locale),
              icon: {
                kind: "feature" as const,
                key: feature.name,
                family: feature.source === "race" ? null : `class-${sheet.class.toLowerCase()}`,
              },
               note: feature.source === "story" ? copy.story : undefined,
               meta: feature.level ? `${copy.level} ${feature.level}` : undefined,
              text: feature.source === "race"
                ? describeRaceTrait(sheet.race, feature.name, locale)
                : describeFeature(sheet.class, sheet.subclass, feature.name, locale),
            }))}
          />
        </SheetPanel>
      ) : null}

      {sheet.feats.length ? (
         <SheetPanel title={copy.feats}>
          <InfoChipList
            items={sheet.feats.map((feat) => ({
              name: localizedContentName("feats", feat, locale),
              icon: { kind: "feat" as const, key: feat },
              text: describeFeature(sheet.class, sheet.subclass, feat, locale),
              reference: { kind: "feats", slug: contentSlug(feat), name: feat },
            }))}
          />
        </SheetPanel>
      ) : null}

      {sheet.backstory ? (
         <SheetPanel title={copy.backstory}>
          <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-300">
            {sheet.backstory}
          </p>
        </SheetPanel>
      ) : null}
    </div>
  );
}

// Milestones the campaigns recorded for this character, newest first as the
// API returns them, drawn as a timeline down a gold hairline.
export function StorySoFar({ events }: { events: CharacterEvent[] }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Story so far", empty: "Nothing recorded yet. Milestones from campaigns land here: victories, treasures, bonds, and worse." },
    ru: { title: "История персонажа", empty: "Пока ничего не записано. Здесь появятся победы, сокровища, связи и другие вехи кампаний." },
  });
  return (
    <SheetPanel
      title={
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="size-3" aria-hidden="true" /> {copy.title}
        </span>
      }
    >
      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-700/60 p-5 text-center text-sm text-stone-500">
           {copy.empty}
        </p>
      ) : (
        <ol className="relative ml-2 space-y-3 border-l border-amber-400/20 pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative text-sm">
              <span
                className="absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full border border-amber-300/60 bg-stone-950 shadow-glow-gold"
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="eyebrow rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] leading-none text-amber-300">
                   {KIND_LABELS[event.kind]?.[locale] ?? event.kind}
                </span>
                <span className="text-xs text-stone-500">
                  {new Date(event.createdAt).toLocaleDateString(locale)}
                </span>
              </div>
              <p className="mt-1 text-stone-200">{event.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </SheetPanel>
  );
}
