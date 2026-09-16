import {
  BookOpen,
  Dices,
  FlaskConical,
  Globe2,
  LayoutGrid,
  type LucideIcon,
  Map as MapIcon,
  Scale,
  Share2,
  Skull,
  Swords,
  UserRound,
  Users,
} from "lucide-react";
import type { WorkshopSummary } from "@/app/workshop/types";
import { localeText } from "@/lib/i18n/locale-text";
import type { Locale } from "@/lib/i18n/translations";

// The twelve systems a workshop is made of, and how each one counts itself.
//
// Nine of the counts come straight off the workshop's contents map, which
// /api/workshops/:id already serves per importable kind. The bestiary, the
// homebrew shelf and the party are the exceptions: monsters, items, spells,
// character options and pregens are the builder's, not the workshop's, so
// they are not importable kinds and their counts are fetched from their own
// list routes by the page. Rules is a yes-or-no rather than a number, and
// Share has nothing to count.

export const WORKSHOP_SYSTEMS = [
  { id: "storyboard", label: "Storyboard", blurb: "Plan the arc", icon: LayoutGrid },
  { id: "party", label: "Party", blurb: "Who it is built for", icon: UserRound },
  { id: "maps", label: "Battle maps", blurb: "Rooms to fight in", icon: MapIcon },
  { id: "region", label: "Region", blurb: "The overworld map", icon: Globe2 },
  { id: "encounters", label: "Encounters", blurb: "Fights, budgeted", icon: Swords },
  { id: "cast", label: "Cast", blurb: "NPCs & agendas", icon: Users },
  { id: "bestiary", label: "Bestiary", blurb: "Homebrew monsters", icon: Skull },
  { id: "homebrew", label: "Homebrew", blurb: "Items, spells & options", icon: FlaskConical },
  { id: "lore", label: "Lore", blurb: "World facts & places", icon: BookOpen },
  { id: "tables", label: "Tables", blurb: "Roll tables", icon: Dices },
  { id: "rules", label: "Rules", blurb: "House & variant", icon: Scale },
  { id: "share", label: "Share", blurb: "Export a bundle", icon: Share2 },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
}>;

export type SystemId = (typeof WORKSHOP_SYSTEMS)[number]["id"];

// Stored ids stay stable; only their presentation crosses the UI boundary.
export function workshopSystemText(locale: Locale, id: SystemId): { label: string; blurb: string } {
  return localeText(locale, {
    en: Object.fromEntries(WORKSHOP_SYSTEMS.map(({ id, label, blurb }) => [id, { label, blurb }])) as Record<SystemId, { label: string; blurb: string }>,
    ru: { storyboard: { label: "Сюжет", blurb: "Планируйте арку" }, party: { label: "Группа", blurb: "Для кого подготовка" }, maps: { label: "Боевые карты", blurb: "Места для сражений" }, region: { label: "Регион", blurb: "Карта мира" }, encounters: { label: "Встречи", blurb: "Бои с расчётом" }, cast: { label: "Персонажи", blurb: "NPC и их цели" }, bestiary: { label: "Бестиарий", blurb: "Свои монстры" }, homebrew: { label: "Хоумбрю", blurb: "Предметы, заклинания и опции" }, lore: { label: "Лор", blurb: "Факты и места мира" }, tables: { label: "Таблицы", blurb: "Таблицы бросков" }, rules: { label: "Правила", blurb: "Домашние и варианты" }, share: { label: "Поделиться", blurb: "Экспортировать набор" } },
    pl: { storyboard: { label: "Scenorys", blurb: "Zaplanuj wątek" }, party: { label: "Drużyna", blurb: "Dla kogo przygotowujesz" }, maps: { label: "Mapy bitew", blurb: "Miejsca do walki" }, region: { label: "Region", blurb: "Mapa świata" }, encounters: { label: "Spotkania", blurb: "Walki z budżetem" }, cast: { label: "Postacie", blurb: "NPC i cele" }, bestiary: { label: "Bestiariusz", blurb: "Własne potwory" }, homebrew: { label: "Homebrew", blurb: "Przedmioty, czary i opcje" }, lore: { label: "Wiedza", blurb: "Fakty i miejsca świata" }, tables: { label: "Tabele", blurb: "Tabele rzutów" }, rules: { label: "Zasady", blurb: "Domowe i warianty" }, share: { label: "Udostępnij", blurb: "Eksportuj pakiet" } },
  })[id];
}

export function isSystemId(value: string | null): value is SystemId {
  return WORKSHOP_SYSTEMS.some((system) => system.id === value);
}

// What a card shows big and what the system title says after its name.
// `figure` is null when there is nothing to count (Share) and, for the
// bestiary, while its count is still on the wire.
export type SystemCount = { figure: string | null; phrase: string; total: number };

export function systemCount(
  id: SystemId,
  workshop: WorkshopSummary,
  bestiary: number | null,
  homebrew: number | null = null,
  pregens: number | null = null,
  locale: Locale = "en",
): SystemCount {
  const contents = workshop.contents;
  const text = localeText(locale, {
    en: { counting: "Counting", party: (level: number, ready: number | null) => ready === null ? `At level ${level}` : `At level ${level}; pregens: ${ready}`, homebrew: (count: number) => `Homebrew: ${count}`, storyboard: (count: number) => count ? "Board in progress" : "No board yet", maps: (count: number) => `Maps: ${count}`, region: (count: number) => count ? "Overworld drawn" : "No overworld yet", encounters: (count: number) => `Encounters: ${count}`, cast: (count: number) => `People: ${count}`, bestiary: (count: number) => `Monsters: ${count}`, lore: (count: number) => `Facts & places: ${count}`, tables: (count: number) => `Tables: ${count}`, rules: (set: boolean) => set ? "House rules set" : "No house rules yet", share: "Export a bundle", set: "set", none: "none" },
    ru: { counting: "Подсчёт", party: (level: number, ready: number | null) => ready === null ? `Уровень ${level}` : `Уровень ${level}; готовые персонажи: ${ready}`, homebrew: (count: number) => `Хоумбрю: ${count}`, storyboard: (count: number) => count ? "Сюжет в работе" : "Сюжета ещё нет", maps: (count: number) => `Карты: ${count}`, region: (count: number) => count ? "Карта мира готова" : "Карты мира ещё нет", encounters: (count: number) => `Встречи: ${count}`, cast: (count: number) => `Персонажи: ${count}`, bestiary: (count: number) => `Монстры: ${count}`, lore: (count: number) => `Факты и места: ${count}`, tables: (count: number) => `Таблицы: ${count}`, rules: (set: boolean) => set ? "Домашние правила заданы" : "Домашних правил ещё нет", share: "Экспортировать набор", set: "заданы", none: "нет" },
    pl: { counting: "Liczenie", party: (level: number, ready: number | null) => ready === null ? `Poziom ${level}` : `Poziom ${level}; gotowe postacie: ${ready}`, homebrew: (count: number) => `Homebrew: ${count}`, storyboard: (count: number) => count ? "Scenorys w toku" : "Brak scenorysu", maps: (count: number) => `Mapy: ${count}`, region: (count: number) => count ? "Mapa świata gotowa" : "Brak mapy świata", encounters: (count: number) => `Spotkania: ${count}`, cast: (count: number) => `Postacie: ${count}`, bestiary: (count: number) => `Potwory: ${count}`, lore: (count: number) => `Fakty i miejsca: ${count}`, tables: (count: number) => `Tabele: ${count}`, rules: (set: boolean) => set ? "Zasady domowe ustawione" : "Brak zasad domowych", share: "Eksportuj pakiet", set: "ustawione", none: "brak" },
  });
  switch (id) {
    case "party": {
      const party = workshop.gameSettings.targetParty;
      return {
        figure: String(party.size),
          phrase: text.party(party.level, pregens),
        total: pregens ?? 0,
      };
    }
    case "homebrew":
      return {
        figure: homebrew === null ? null : String(homebrew),
        phrase: homebrew === null ? text.counting : text.homebrew(homebrew),
        total: homebrew ?? 0,
      };
    case "storyboard": {
      const count = contents.storyboard;
      return {
        figure: String(count),
        phrase: text.storyboard(count),
        total: count,
      };
    }
    case "maps":
      return { figure: String(contents.maps), phrase: text.maps(contents.maps), total: contents.maps };
    case "region": {
      const count = contents.overworld;
      return {
        figure: String(count),
        phrase: text.region(count),
        total: count,
      };
    }
    case "encounters":
      return {
        figure: String(contents.encounters),
        phrase: text.encounters(contents.encounters),
        total: contents.encounters,
      };
    case "cast":
      return {
        figure: String(contents.npcs),
        phrase: text.cast(contents.npcs),
        total: contents.npcs,
      };
    case "bestiary":
      return {
        figure: bestiary === null ? null : String(bestiary),
        phrase: bestiary === null ? text.counting : text.bestiary(bestiary),
        total: bestiary ?? 0,
      };
    case "lore": {
      const count = contents.lore + contents.locations;
      return { figure: String(count), phrase: text.lore(count), total: count };
    }
    case "tables":
      return {
        figure: String(contents.tables),
        phrase: text.tables(contents.tables),
        total: contents.tables,
      };
    case "rules":
      return {
        figure: contents.houseRules ? text.set : text.none,
        phrase: text.rules(Boolean(contents.houseRules)),
        total: 0,
      };
    case "share":
      return { figure: null, phrase: text.share, total: 0 };
  }
}

// "41 pieces of prep": every countable thing in the workshop, for the hub's
// section heading.
export function totalPieces(
  workshop: WorkshopSummary,
  bestiary: number | null,
  homebrew: number | null = null,
  pregens: number | null = null,
): number {
  return WORKSHOP_SYSTEMS.reduce(
    (sum, system) => sum + systemCount(system.id, workshop, bestiary, homebrew, pregens).total,
    0,
  );
}
