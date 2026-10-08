"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { iconCandidates, type IconRef } from "@/lib/icons";
import { localizedContentName } from "@/lib/help";
import { castingCost } from "@/lib/dm/action-budget";
import { combatSpellSlots } from "@/lib/dm/combat-turn-intent";
import {
  MAX_DECLARATIONS, resourceLabel, resourceTarget, usableItems, usableResources, validateDeclarations,
  type Declaration, type SpellCard,
} from "@/lib/dm/declarations";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Locale } from "@/lib/i18n";

const COPY = {
  en: {
    title: "Spells & abilities", close: "Close", tabs: { spells: "Spells", abilities: "Abilities", items: "Items" },
    cantrips: "Cantrips", level: (n: number) => `Level ${n}`, cantrip: "cantrip", ritual: "ritual", ritualOnly: "ritual only",
    concentration: "conc.", noSlots: "no slots", bonus: "bonus", reaction: "reaction", min: "min", hour: "h",
    slot: "Slot", left: "left", asRitual: "As a ritual (+10 min)", whoFor: "Who for", me: "Me", noTarget: "No target",
    selfOnly: "It affects the caster.", otherHint: "Describe the target (a foe, a place, an object) in your message.",
    add: "Add to the request", loading: "Loading your spells…", error: "Could not load spells.",
    empty: "Nothing to pick: no spells, abilities with uses left or consumables.", full: `At most ${MAX_DECLARATIONS} picks per request.`,
    rejected: "That pick is not available right now.",
  },
  ru: {
    title: "Магия и умения", close: "Закрыть", tabs: { spells: "Заклинания", abilities: "Способности", items: "Предметы" },
    cantrips: "Заговоры", level: (n: number) => `${n} круг`, cantrip: "заговор", ritual: "ритуал", ritualOnly: "только ритуал",
    concentration: "конц.", noSlots: "нет ячеек", bonus: "бонус", reaction: "реакция", min: "мин", hour: "ч",
    slot: "Ячейка", left: "осталось", asRitual: "Ритуалом (+10 мин)", whoFor: "Для кого", me: "Я", noTarget: "Без цели",
    selfOnly: "Действует на заклинателя.", otherHint: "Цель (врага, место, предмет) опишите в тексте заявки.",
    add: "Добавить в заявку", loading: "Загружаю книгу заклинаний…", error: "Не удалось загрузить заклинания.",
    empty: "Нечего выбрать: нет заклинаний, способностей с зарядами или расходников.", full: `Не больше ${MAX_DECLARATIONS} выборов в одной заявке.`,
    rejected: "Этот выбор сейчас недоступен.",
  },
} as const;

type Tab = keyof (typeof COPY)["en"]["tabs"];
type Selection = { kind: "spell"; card: SpellCard } | { kind: "resource"; id: string } | { kind: "item"; name: string };
type Tile = { key: string; label: string; icon: IconRef; badges: string[]; ready: boolean; select: Selection; instant?: Declaration; level?: number };

const TAB_ICONS: Record<Tab, IconRef> = {
  spells: { kind: "action", key: "cast" },
  abilities: { kind: "glyph", key: "rest-proficiency" },
  items: { kind: "action", key: "use-object" },
};
const painted = (icon: IconRef, fallback: IconRef) => iconCandidates(icon).length ? icon : fallback;
const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
const friendChip = "border-sky-800/70 bg-sky-950/40 text-sky-100 hover:border-sky-500/70 hover:bg-sky-900/40";
const toggle = (on: boolean) => cn(chip, on ? "border-amber-400/80 bg-amber-400/15 text-amber-50" : "border-stone-700 bg-stone-900/70 text-stone-300 hover:border-amber-500/50 hover:text-amber-100");

// The out-of-combat spell book in the Composer: pick a spell (slot or
// ritual), a class ability or a consumable and who it is for; the picks ride
// the next action as declarations the server checks and the narrator
// resolves (src/lib/dm/declarations.ts). Combat turns use the Battle tab.
export function SpellBookPanel({ campaignId, sheet, locale, declarations, onChange, onClose, disabled }: {
  campaignId: string;
  sheet: CharacterSheet;
  locale: Locale;
  declarations: Declaration[];
  onChange: (declarations: Declaration[]) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const copy = COPY[locale];
  const key = `${campaignId}:${sheet.id}:${sheet.updatedAt}`;
  const [data, setData] = useState<{ key: string; library: SpellCard[]; party: Array<{ id: string; name: string }>; error?: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/campaigns/${campaignId}/actions`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Spell book unavailable"); return response.json(); })
      .then((json) => { if (!controller.signal.aborted) setData({ key, library: json.library ?? [], party: json.party ?? [] }); })
      .catch(() => { if (!controller.signal.aborted) setData({ key, library: [], party: [], error: true }); });
    return () => controller.abort();
  }, [campaignId, key]);
  const loaded = data?.key === key ? data : null;
  const party = useMemo(() => new Map((loaded?.party ?? []).map((entry) => [entry.id, entry.name])), [loaded]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [slotChoice, setSlotChoice] = useState<number | "ritual" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [rejected, setRejected] = useState(false);

  const localize = (kind: "item" | "spell", name: string) => localizedContentName(kind, name, locale);
  const context = { sheet, library: loaded?.library ?? [], party, language: locale, localize };
  const canAdd = (declaration: Declaration) =>
    declarations.length < MAX_DECLARATIONS && validateDeclarations([...declarations, declaration], context).ok;
  const reset = () => { setSelected(null); setSlotChoice(null); setPicked([]); setRejected(false); };
  const add = (declaration: Declaration) => {
    if (disabled || !canAdd(declaration)) { setRejected(true); return; }
    onChange([...declarations, declaration]);
    reset();
  };

  const timeBadge = (time: string): string | null => {
    const cost = castingCost(time);
    if (cost === "action") return null;
    if (cost) return cost === "bonus" ? copy.bonus : copy.reaction;
    const long = /^(\d+)\s*(minute|hour)/i.exec(time.trim());
    return long ? `${long[1]} ${/^h/i.test(long[2]) ? copy.hour : copy.min}` : null;
  };
  const spellSlots = (card: SpellCard) => (card.level && !card.ritualOnly ? combatSpellSlots(sheet, card.level) : []);
  const spellTiles: Tile[] = (loaded?.library ?? []).map((card) => {
    const slots = spellSlots(card);
    return {
      key: `spell:${card.name}`, label: localize("spell", card.name), select: { kind: "spell", card }, level: card.level,
      icon: painted({ kind: "spell", key: card.name }, TAB_ICONS.spells),
      ready: declarations.length < MAX_DECLARATIONS && (card.level === 0 || slots.length > 0 || card.ritual),
      badges: [
        card.level === 0 ? copy.cantrip : card.ritualOnly ? copy.ritualOnly : slots.length ? null : card.ritual ? copy.ritualOnly : copy.noSlots,
        card.ritual && !card.ritualOnly && card.level > 0 && slots.length ? copy.ritual : null,
        card.concentration ? copy.concentration : null,
        timeBadge(card.castingTime),
      ].filter((badge): badge is string => Boolean(badge)),
    };
  });
  const abilityTiles: Tile[] = usableResources(sheet).map(({ id, left }) => {
    const instant: Declaration = { type: "resource", resource: id, targetIds: [] };
    return {
      key: `resource:${id}`, label: resourceLabel(id, locale), select: { kind: "resource", id }, badges: [`×${left}`],
      icon: painted({ kind: "feature", key: resourceLabel(id, "en") }, TAB_ICONS.abilities),
      ready: resourceTarget(id) === "self" ? canAdd(instant) : declarations.length < MAX_DECLARATIONS,
      ...(resourceTarget(id) === "self" ? { instant } : {}),
    };
  });
  const itemTiles: Tile[] = usableItems(sheet).map(({ name, qty }) => ({
    key: `item:${name}`, label: localize("item", name), select: { kind: "item", name }, badges: [`×${qty}`],
    icon: painted({ kind: "item", key: name }, TAB_ICONS.items),
    ready: canAdd({ type: "item", item: name, targetIds: [] }),
  }));
  const byTab: Record<Tab, Tile[]> = { spells: spellTiles, abilities: abilityTiles, items: itemTiles };
  const tabs = (["spells", "abilities", "items"] as const).filter((entry) => byTab[entry].length);
  const shown = tab && tabs.includes(tab) ? tab : tabs[0];
  const selectedKey = selected ? (selected.kind === "spell" ? `spell:${selected.card.name}` : selected.kind === "resource" ? `resource:${selected.id}` : `item:${selected.name}`) : "";

  const tileButton = (tile: Tile) => <button key={tile.key} type="button" disabled={disabled || !tile.ready}
    aria-pressed={tile.instant ? undefined : selectedKey === tile.key} aria-label={[tile.label, ...tile.badges].join(" · ")}
    onClick={() => { if (tile.instant) { add(tile.instant); return; } if (selectedKey === tile.key) { reset(); return; } reset(); setSelected(tile.select); }}
    className={cn("flex min-h-12 items-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-left text-xs leading-tight transition-all duration-150 ease-snap @md:gap-2 @md:px-2",
      selectedKey === tile.key ? "border-amber-400/80 bg-amber-500/15 text-amber-50 shadow-glow-gold"
        : "border-stone-700/70 bg-stone-900/70 text-stone-200 hover:-translate-y-px hover:border-amber-500/50 hover:bg-stone-800/80",
      "disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-700/70 disabled:hover:bg-stone-900/70")}>
    <GameIcon icon={tile.icon} size="size-7 @md:size-8" />
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 hyphens-auto">{tile.label}</span>
      {tile.badges.length ? <span className="mt-0.5 flex flex-wrap gap-1 text-[10px] leading-none">
        {tile.badges.map((badge) => <span key={badge} className="rounded border border-stone-700 px-1 py-px text-stone-400">{badge}</span>)}
      </span> : null}
    </span>
  </button>;
  const grid = (tiles: Tile[]) => <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-3 @2xl:grid-cols-4">{tiles.map(tileButton)}</div>;
  const heading = (text: string) => <p className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{text}</p>;

  // Party chips: single-pick ones add at once, multi-pick ones toggle.
  const people = (ids: string[]) => ids.map((id) => ({ id, name: id === sheet.id ? `${copy.me} (${party.get(id) ?? sheet.name})` : party.get(id) ?? "?" }));
  const everyone = [sheet.id, ...[...party.keys()].filter((id) => id !== sheet.id)];
  const targetRow = (body: ReactNode) => <div><p className="mb-1 text-[11px] text-stone-400">{copy.whoFor}</p><div className="flex flex-wrap gap-1.5">{body}</div></div>;
  const pickOne = (ids: string[], make: (id: string) => Declaration, extra?: ReactNode) => targetRow(<>
    {people(ids).map((person) => <button key={person.id} type="button" disabled={disabled || !canAdd(make(person.id))}
      onClick={() => add(make(person.id))} className={cn(chip, friendChip)}>{person.name}</button>)}
    {extra}
  </>);

  let picker: ReactNode = null;
  if (selected?.kind === "spell") {
    const card = selected.card;
    const slots = spellSlots(card);
    const slot = card.level === 0 ? null
      : slotChoice === "ritual" && card.ritual ? "ritual"
      : typeof slotChoice === "number" && slots.some((entry) => entry.level === slotChoice) ? slotChoice
      : slots[0]?.level ?? (card.ritual ? "ritual" : null);
    const make = (targetIds: string[]): Declaration => ({
      type: "spell", spell: card.name, targetIds,
      ...(slot === "ritual" ? { ritual: true } : typeof slot === "number" ? { slotLevel: slot } : {}),
    });
    const declaration = make(card.target === "party" ? picked : []);
    picker = <>
      {card.level > 0 ? <div>
        <p className="mb-1 text-[11px] text-stone-400">{copy.slot}</p>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((entry) => <button key={entry.level} type="button" aria-pressed={slot === entry.level} disabled={disabled}
            onClick={() => setSlotChoice(entry.level)} className={toggle(slot === entry.level)}>{copy.level(entry.level)} · {copy.left} {entry.left}</button>)}
          {card.ritual ? <button type="button" aria-pressed={slot === "ritual"} disabled={disabled}
            onClick={() => setSlotChoice("ritual")} className={toggle(slot === "ritual")}>{copy.asRitual}</button> : null}
        </div>
      </div> : null}
      {card.target === "party" ? targetRow(people(everyone).map((person) => {
        const on = picked.includes(person.id);
        return <button key={person.id} type="button" aria-pressed={on} disabled={disabled}
          onClick={() => setPicked(on ? picked.filter((id) => id !== person.id) : [...picked, person.id])} className={on ? toggle(true) : cn(chip, friendChip)}>{person.name}</button>;
      })) : <p className="text-[11px] text-stone-400">{card.target === "self" ? copy.selfOnly : copy.otherHint}</p>}
      <button type="button" disabled={disabled || !canAdd(declaration)} onClick={() => add(declaration)}
        className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 transition-all hover:-translate-y-px hover:shadow-glow-gold disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none">{copy.add}</button>
    </>;
  } else if (selected?.kind === "resource") {
    const id = selected.id;
    const aim = resourceTarget(id);
    const make = (target: string): Declaration => ({ type: "resource", resource: id, targetIds: [target] });
    picker = pickOne(aim === "other" ? everyone.filter((entry) => entry !== sheet.id) : everyone, make,
      aim === "optional" ? <button type="button" disabled={disabled || !canAdd({ type: "resource", resource: id, targetIds: [] })}
        onClick={() => add({ type: "resource", resource: id, targetIds: [] })} className={toggle(false)}>{copy.noTarget}</button> : null);
  } else if (selected?.kind === "item") {
    const item = selected.name;
    picker = pickOne(everyone, (target) => ({ type: "item", item, targetIds: target === sheet.id ? [] : [target] }));
  }
  const selectedTile = selectedKey ? byTab[shown ?? "spells"]?.find((tile) => tile.key === selectedKey) : undefined;

  return <section className="@container mb-2 rounded-xl border border-amber-700/50 bg-stone-950/95 p-3 text-sm shadow-elev-1" aria-label={copy.title}>
    <div className="flex items-center justify-between gap-2 text-amber-100">
      <strong className="flex min-w-0 items-center gap-2"><GameIcon icon={TAB_ICONS.spells} size="size-6" /><span className="truncate">{copy.title}</span></strong>
      <button type="button" onClick={onClose} aria-label={copy.close} className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"><X className="size-4" /></button>
    </div>
    {!loaded ? <p role="status" className="mt-2 text-xs text-stone-400">{copy.loading}</p> : null}
    {loaded?.error ? <p role="alert" className="mt-2 text-xs text-red-300">{copy.error}</p> : null}
    {loaded && !tabs.length ? <p className="mt-2 text-xs text-stone-400">{copy.empty}</p> : null}
    {/* A chosen tile opens its choice in place of the grid, so the panel stays short on a phone. */}
    {picker && selectedTile ? <div className="mt-2 space-y-2.5 rounded-lg border border-amber-500/40 bg-stone-900/80 p-2.5 shadow-elev-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-amber-100"><GameIcon icon={selectedTile.icon} size="size-6" /><span className="truncate">{selectedTile.label}</span></span>
        <button type="button" onClick={reset} aria-label={copy.close} className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"><X className="size-4" /></button>
      </div>
      {picker}
    </div> : <>
      {tabs.length > 1 ? <div role="group" aria-label={copy.title} className="mt-3 grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-stone-800/80 bg-stone-900/50 p-1">
        {tabs.map((entry) => <button key={entry} type="button" aria-pressed={shown === entry} onClick={() => { setTab(entry); reset(); }}
          className={cn("flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-[11px] font-medium transition-all duration-150 ease-snap active:scale-95 @md:flex-row @md:gap-1.5 @md:text-xs",
            shown === entry ? "bg-gradient-to-b from-amber-100 to-amber-400 text-amber-950 shadow-glow-gold" : "text-stone-400 hover:bg-stone-800 hover:text-stone-200")}>
          <GameIcon icon={TAB_ICONS[entry]} size="size-5" /><span className="max-w-full truncate">{copy.tabs[entry]}</span>
        </button>)}
      </div> : null}
      {/* The tiles scroll on their own so the input stays in view. */}
      <div className="max-h-[34dvh] overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[50dvh]">
        {shown === "spells"
          ? [...new Set(spellTiles.map((tile) => tile.level))].map((level) => <div key={level}>
            {heading(level ? copy.level(level) : copy.cantrips)}
            {grid(spellTiles.filter((tile) => tile.level === level))}
          </div>)
          : shown ? <div className="mt-2.5">{grid(byTab[shown])}</div> : null}
      </div>
    </>}
    {rejected ? <p role="alert" className="mt-2 text-xs text-red-300">{copy.rejected}</p> : null}
    {declarations.length >= MAX_DECLARATIONS ? <p className="mt-2 text-xs text-amber-200/80">{copy.full}</p> : null}
  </section>;
}
