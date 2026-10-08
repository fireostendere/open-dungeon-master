"use client";

import { useState, type ReactNode } from "react";
import { Swords, X } from "lucide-react";
import { ActionPreviewDialog } from "@/app/campaigns/[campaignId]/ActionPreviewDialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { combatChoiceDescriptors, combatChoiceLabel, combatIntentBudget, combatSpellSlots, PARLEY_APPROACHES, validateCombatTurnIntent, type CombatChoice, type CombatSpellDescriptor, type CombatTurnIntent, type ParleyApproach } from "@/lib/dm/combat-turn-intent";
import { freshBudget } from "@/lib/dm/action-budget";
import { localizedContentName } from "@/lib/help";
import { iconCandidates, type IconRef } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { combatRiders, hasCunningAction } from "@/lib/srd/feature-effects";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  ru: {
    title: "Конструктор боевого хода", turn: "Ход", round: "Раунд", budget: "Осталось в этом ходу",
    action: "Действие", bonus: "Бонусное", attacks: "Атаки", extra: "Доп. действие",
    groups: "Что делать", tabs: { attack: "Атака", action: "Действия", magic: "Магия", pet: "Питомцы" },
    sections: { maneuver: "Приёмы", ability: "Умения", item: "Предметы" }, cunningBadge: "хитрое",
    dodge: "Уклонение", dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помочь союзнику", grapple: "Захватить", shove: "Сбить с ног",
    cunning: "Хитрое действие", unarmed: "Безоружный удар", bonusBadge: "бонус", cantrip: "заговор", level: "ур.", noSlots: "нет ячеек",
    other: "Другой путь", parley: "Договориться", flee: "Сбежать", improvise: "Своё действие",
    parleyTip: "Решить дело словами: убедить, запугать или обмануть. Тратит действие, исход решает проверка.",
    fleeTip: "Попытаться уйти с поля боя. Тратит действие; удастся ли, решат мастер и погоня.",
    improviseTip: "Что угодно, чего нет в списке. Мастер решит, возможно ли это и что бросать. Тратит действие.",
    approach: "Как говорите", approaches: { persuade: "Убедить", intimidate: "Запугать", deceive: "Обмануть" },
    whom: "С кем", everyone: "Со всеми", parleyHint: "Слова и условия впишите в описание хода.",
    improviseLabel: "Что делает персонаж?", improvisePlaceholder: "Например: рублю верёвку люстры над гоблинами",
    target: "Цель", spellTarget: "Цель заклинания", itemTarget: "Кому применить", self: "На себя", slot: "Ячейка", slotLeft: "ост.",
    sneak: "Скрытая атака, если условия выполнены", add: "Добавить в план", cancel: "Отмена",
    queued: "План хода", emptyPlan: "Выберите действие выше, и оно попадёт в план.", remove: "Убрать действие",
    description: "Описание хода (необязательно)", descriptionPlaceholder: "Что делает или говорит персонаж?",
    parleyPlaceholder: "Что вы говорите врагам? Условия, угрозы, обещания…",
    send: "Отправить ход", end: "Пропустить ход", skipIntent: "Я пропускаю боевой ход.", sending: "Отправка…",
    locked: "Мастер обрабатывает ход.", unavailable: "Нет доступных действий с текущими ресурсами и целями.",
    rejected: "Это действие сейчас недоступно.", spellsLoading: "Загружаю доступные заклинания…", spellsError: "Не удалось загрузить заклинания.",
  },
  en: {
    title: "Combat turn builder", turn: "Turn", round: "Round", budget: "Left this turn",
    action: "Action", bonus: "Bonus", attacks: "Attacks", extra: "Extra action",
    groups: "What to do", tabs: { attack: "Attack", action: "Actions", magic: "Magic", pet: "Pets" },
    sections: { maneuver: "Maneuvers", ability: "Abilities", item: "Items" }, cunningBadge: "cunning",
    dodge: "Dodge", dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help an ally", grapple: "Grapple", shove: "Shove prone",
    cunning: "Cunning Action", unarmed: "Unarmed strike", bonusBadge: "bonus", cantrip: "cantrip", level: "lvl", noSlots: "no slots",
    other: "Another way", parley: "Parley", flee: "Flee", improvise: "Own action",
    parleyTip: "Settle it with words: persuade, intimidate or deceive. Takes your action; a check decides.",
    fleeTip: "Try to get away from the fight. Takes your action; the DM and the pursuit decide whether you make it.",
    improviseTip: "Anything the list lacks. The DM decides whether it can work and what to roll. Takes your action.",
    approach: "How you talk", approaches: { persuade: "Persuade", intimidate: "Intimidate", deceive: "Deceive" },
    whom: "To whom", everyone: "Everyone", parleyHint: "Put your words and terms in the turn description.",
    improviseLabel: "What does your character do?", improvisePlaceholder: "For example: I cut the chandelier rope above the goblins",
    target: "Target", spellTarget: "Spell target", itemTarget: "Use on", self: "Self", slot: "Slot", slotLeft: "left",
    sneak: "Sneak Attack if eligible", add: "Add to plan", cancel: "Cancel",
    queued: "Turn plan", emptyPlan: "Pick an action above and it joins the plan.", remove: "Remove action",
    description: "Turn description (optional)", descriptionPlaceholder: "What does your character do or say?",
    parleyPlaceholder: "What do you tell the enemies? Terms, threats, promises…",
    send: "Submit turn", end: "Skip turn", skipIntent: "I skip my combat turn.", sending: "Sending…",
    locked: "The DM is resolving this turn.", unavailable: "No actions are available with the current resources and targets.",
    rejected: "This action is not available right now.", spellsLoading: "Loading available spells…", spellsError: "Could not load spells.",
  },
};

type Group = "attack" | "magic" | "action" | "pet";
// The Actions tab keeps its tiles in these runs, headed when there are several.
type Section = "maneuver" | "ability" | "item";
type Target = { id: string; name: string; foe: boolean };
// One button in the grid. It either queues its choice at once, or opens the
// picker below to finish it: target chips (the last tap queues), a spell's
// slot, or the pet panel.
type Tile = {
  key: string;
  group: Group;
  section?: Section;
  label: string;
  icon: IconRef;
  bonus?: boolean;
  badge?: string;
  ready: boolean;
  choice?: CombatChoice;
  targets?: Target[];
  make?: (targetId: string) => CombatChoice;
  spell?: CombatSpellDescriptor;
};

const GROUP_ICONS: Record<Group, IconRef> = {
  attack: { kind: "action", key: "attack" },
  action: { kind: "action", key: "dash" },
  magic: { kind: "action", key: "cast" },
  pet: { kind: "glyph", key: "mount-mastiff" },
};
const APPROACH_ICONS: Record<ParleyApproach, string> = { persuade: "skill-persuasion", intimidate: "skill-intimidation", deceive: "skill-deception" };
const painted = (icon: IconRef, fallback: IconRef) => iconCandidates(icon).length ? icon : fallback;
const MANEUVERS = ["dash", "disengage", "hide", "help", "grapple", "shove"] as const;
const FULL_CASTER = /^(bard|cleric|druid|sorcerer|warlock|wizard)$/i;

const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
const chipTone = { foe: "border-red-800/70 bg-red-950/40 text-red-100 hover:border-red-500/70 hover:bg-red-900/40", friend: "border-sky-800/70 bg-sky-950/40 text-sky-100 hover:border-sky-500/70 hover:bg-sky-900/40" };
const toggle = (on: boolean) => cn(chip, on ? "border-amber-400/80 bg-amber-400/15 text-amber-50" : "border-stone-700 bg-stone-900/70 text-stone-300 hover:border-amber-500/50 hover:text-amber-100");

export function CombatTurnHud({
  encounter, sheet, sheets, locked, sending, onSubmit, choices: externalChoices, onChoicesChange, description, onDescriptionChange,
  friendlyFire = false, spellOptions = [], spellsLoading = false, spellsError = false, petPanel,
}: {
  encounter: PublicEncounter;
  sheet: CharacterSheet;
  sheets: CharacterSheet[];
  friendlyFire?: boolean;
  locked: boolean;
  sending: boolean;
  onSubmit: (turn: CombatTurnIntent) => void;
  choices?: CombatChoice[];
  onChoicesChange?: (choices: CombatChoice[]) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  spellOptions?: CombatSpellDescriptor[];
  spellsLoading?: boolean;
  spellsError?: boolean;
  petPanel?: ReactNode;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [internalChoices, setInternalChoices] = useState<CombatChoice[]>([]);
  const choices = externalChoices ?? internalChoices;
  const setChoices = (next: CombatChoice[]) => onChoicesChange ? onChoicesChange(next) : setInternalChoices(next);
  const [tab, setTab] = useState<Group | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [slotLevel, setSlotLevel] = useState<number | null>(null);
  const [sneakAttack, setSneakAttack] = useState(false);
  const [approach, setApproach] = useState<ParleyApproach>("persuade");
  const [improvised, setImprovised] = useState("");
  const [rejected, setRejected] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const descriptors = combatChoiceDescriptors(sheet);
  const enemies = encounter.enemies.filter((enemy) => enemy.status === "alive");
  const combatantIds = new Set(encounter.order.filter((entry) => entry.kind === "pc").map((entry) => entry.id));
  const allies = [
    ...sheets.filter((entry) => !entry.deathSaves?.dead && (!encounter.orderReady || combatantIds.has(entry.id))),
    ...encounter.order.filter(entry => entry.kind === "pc" && !sheets.some(sheet => sheet.id === entry.id)),
  ];
  const otherAllies = allies.filter((ally) => ally.id !== sheet.id);
  const foes: Target[] = enemies.map((enemy) => ({ id: enemy.id, name: enemy.name, foe: true }));
  const friends = (list: typeof allies): Target[] => list.map((ally) => ({ id: ally.id, name: ally.id === sheet.id ? copy.self : ally.name, foe: false }));
  const attackTargets = friendlyFire ? [...foes, ...friends(otherAllies)] : foes;
  const attackChoice = (id: string, weapon: string): CombatChoice => ({ type: "attack", weapon,
    ...(enemies.some(enemy => enemy.id === id) ? { targetEnemyId: id } : { targetCharacterId: id }) });
  const targetNames = new Map([...allies, ...enemies].map((entry) => [entry.id, entry.name] as const));
  const contentName = (kind: "item" | "spell", name: string) => localizedContentName(kind, name, locale);
  const label = (choice: CombatChoice) => combatChoiceLabel(choice, locale, targetNames, contentName);
  const budget = combatIntentBudget(encounter, freshBudget({
    ownerId: sheet.id, round: encounter.round,
    attacksAllowed: 1 + combatRiders(sheet).extraAttacks,
    extraActions: conditionExtraActions(sheet.conditions),
  }));
  const intent = (entries = choices): CombatTurnIntent => ({ encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, choices: entries,
    ...(entries.length && description.trim() ? { description: description.trim() } : {}) });
  const validate = (entries: CombatChoice[]) => validateCombatTurnIntent(
    intent(entries), sheet, new Set(enemies.map((enemy) => enemy.id)), new Set(allies.map((ally) => ally.id)), budget,
    { language: locale, names: new Map(), spells: spellOptions, friendlyFire },
  );
  const canQueue = (choice: CombatChoice) => validate([...choices, choice]).ok;
  const preview = validate(choices);
  const left = preview.ok ? preview.budget : budget;
  const disabled = locked || sending;

  const tiles: Tile[] = [];
  const sneakOpen = combatRiders(sheet).sneakAttackDice > 0 && !budget.oncePerTurn.includes("sneak_attack") && !choices.some((choice) => choice.type === "attack" && choice.sneakAttack);
  for (const weapon of descriptors.filter((entry) => entry.type === "weapon")) {
    if (!attackTargets.length) break;
    const unarmed = weapon.name === "Unarmed strike";
    tiles.push({
      key: `attack:${weapon.name}`, group: "attack", label: unarmed ? copy.unarmed : contentName("item", weapon.name),
      icon: unarmed ? { kind: "glyph", key: "ability-str" } : { kind: "item", key: weapon.name, family: "item-weapon" },
      targets: attackTargets, make: (id) => ({ ...attackChoice(id, weapon.name), ...(sneakAttack && sneakOpen ? { sneakAttack: true } : {}) }),
      ready: attackTargets.some((target) => canQueue(attackChoice(target.id, weapon.name))),
    });
  }
  tiles.push({ key: "dodge", group: "action", section: "maneuver", label: copy.dodge, icon: { kind: "action", key: "dodge" }, choice: { type: "dodge" }, ready: canQueue({ type: "dodge" }) });
  for (const action of MANEUVERS) {
    const icon: IconRef = { kind: "action", key: action };
    if (action === "help" || action === "grapple" || action === "shove") {
      const targets = action === "help" ? friends(otherAllies) : foes;
      const make = (id: string): CombatChoice => action === "help" ? { type: "action", action, targetCharacterId: id } : { type: "action", action, targetEnemyId: id };
      if (targets.length) tiles.push({ key: `action:${action}`, group: "action", section: "maneuver", label: copy[action], icon, targets, make, ready: targets.some((target) => canQueue(make(target.id))) });
      continue;
    }
    const choice: CombatChoice = { type: "action", action };
    tiles.push({ key: `action:${action}`, group: "action", section: "maneuver", label: copy[action], icon, choice, ready: canQueue(choice) });
  }
  if (hasCunningAction(sheet)) {
    for (const action of ["dash", "disengage", "hide"] as const) {
      const choice: CombatChoice = { type: "action", action, cunningAction: true };
      tiles.push({ key: `cunning:${action}`, group: "action", section: "maneuver", label: copy[action], badge: copy.cunningBadge, icon: { kind: "action", key: action }, bonus: true, choice, ready: canQueue(choice) });
    }
  }
  for (const spell of spellOptions) {
    if (!spell.target || spell.level === null || (spell.cost !== "action" && spell.cost !== "bonus")) continue;
    const level = spell.level;
    const slots = level > 0 ? combatSpellSlots(sheet, level) : [];
    const targets = spell.target === "enemy" ? attackTargets : spell.target === "ally" ? friends(allies) : [{ id: sheet.id, name: copy.self, foe: false }];
    tiles.push({
      key: `spell:${spell.name}`, group: "magic", label: contentName("spell", spell.name), spell, bonus: spell.cost === "bonus",
      icon: painted({ kind: "spell", key: spell.name }, { kind: "action", key: "cast" }),
      badge: level === 0 ? copy.cantrip : slots.length ? `${level} ${copy.level}` : copy.noSlots,
      ready: (level === 0 || slots.length > 0) && targets.some((target) => canQueue({ type: "spell", spell: spell.name, targetId: target.id, ...(slots[0] ? { slotLevel: slots[0].level } : {}) })),
    });
  }
  for (const resource of descriptors.filter((entry) => entry.type === "resource")) {
    const make = (id: string): CombatChoice => ({ type: "resource", resource: resource.id, targetCharacterId: id });
    const targets = friends(resource.target === "self" ? [] : allies.filter((ally) => resource.target !== "other" || ally.id !== sheet.id));
    const names: Record<string, string> = locale === "ru"
      ? { second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук" }
      : {};
    tiles.push({
      key: `resource:${resource.id}`, group: "action", section: "ability", label: names[resource.id] ?? resource.name, bonus: resource.cost === "bonus", badge: `×${resource.left}`,
      icon: painted({ kind: "feature", key: resource.name }, { kind: "glyph", key: "rest-proficiency" }),
      ...(resource.target === "self" ? { choice: make(sheet.id) } : { targets, make }),
      ready: resource.target === "self" ? canQueue(make(sheet.id)) : targets.some((target) => canQueue(make(target.id))),
    });
  }
  for (const item of descriptors.filter((entry) => entry.type === "item")) {
    const make = (id: string): CombatChoice => ({ type: "item", item: item.name, targetCharacterId: id });
    tiles.push({
      key: `item:${item.name}`, group: "action", section: "item", label: contentName("item", item.name), badge: `×${item.qty}`,
      icon: painted({ kind: "item", key: item.name }, { kind: "action", key: "use-object" }),
      targets: friends(allies), make, ready: allies.some((ally) => canQueue(make(ally.id))),
    });
  }
  const pets = petPanel ? (sheet.pets ?? []).filter((pet) => pet.hp > 0) : [];

  const groups = (["attack", "magic", "action", "pet"] as const).filter((group) => group === "pet" ? pets.length > 0 : tiles.some((tile) => tile.group === group));
  // Casters open on their spells, everyone else on their weapons.
  const preferred: Group = FULL_CASTER.test(sheet.class) && groups.includes("magic") ? "magic" : "attack";
  const shown = tab && groups.includes(tab) ? tab : groups.includes(preferred) ? preferred : groups[0];
  const selected = tiles.find((tile) => tile.key === selectedKey);
  const sections = (["", "maneuver", "ability", "item"] as const)
    .map((section) => [section, tiles.filter((tile) => tile.group === shown && (tile.section ?? "") === section)] as const)
    .filter(([, run]) => run.length);
  const enemiesToTalkTo = foes.length > 0;
  const special = {
    parley: enemiesToTalkTo && canQueue({ type: "parley", approach }),
    flee: canQueue({ type: "flee" }),
    improvise: canQueue({ type: "improvise", text: "…" }),
  };
  const spellSlots = selected?.spell && selected.spell.level ? combatSpellSlots(sheet, selected.spell.level) : [];
  const slot = slotLevel !== null && spellSlots.some((entry) => entry.level === slotLevel) ? slotLevel : spellSlots[0]?.level;
  const spellChoice = (targetId: string): CombatChoice => ({ type: "spell", spell: selected!.spell!.name, targetId, ...(slot ? { slotLevel: slot } : {}) });

  const reset = () => { setSelectedKey(""); setSlotLevel(null); setSneakAttack(false); setImprovised(""); setRejected(false); };
  const queue = (choice: CombatChoice) => {
    if (disabled || !canQueue(choice)) { setRejected(true); return; }
    setChoices([...choices, choice]);
    reset();
  };
  const pick = (key: string, choice?: CombatChoice) => {
    if (choice) { queue(choice); return; }
    if (selectedKey === key) { reset(); return; }
    reset();
    setSelectedKey(key);
  };
  const submit = () => { if (!selectedKey && !disabled && preview.ok) setConfirming(true); };
  const parleyQueued = choices.some((choice) => choice.type === "parley");

  const targetChips = (targets: Target[], make: (id: string) => CombatChoice, heading: string) => <div>
    <p className="mb-1 text-[11px] text-stone-400">{heading}</p>
    <div className="flex flex-wrap gap-1.5">{targets.map((target) => <button key={target.id} type="button" disabled={disabled || !canQueue(make(target.id))}
      onClick={() => queue(make(target.id))} aria-label={`${heading}: ${target.name}`} className={cn(chip, target.foe ? chipTone.foe : chipTone.friend)}>{target.name}</button>)}</div>
  </div>;

  const picker = (title: string, icon: IconRef, body: ReactNode) => <div className="mt-2 space-y-2.5 rounded-lg border border-amber-500/40 bg-stone-900/80 p-2.5 shadow-elev-1">
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-amber-100"><GameIcon icon={icon} size="size-6" /><span className="truncate">{title}</span></span>
      <button type="button" onClick={reset} aria-label={copy.cancel} className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"><X className="size-4" /></button>
    </div>
    {body}
    {rejected ? <p role="alert" className="text-xs text-red-300">{copy.rejected}</p> : null}
  </div>;

  const tilePicker = selected ? picker(selected.label, selected.icon, <>
    {selected.group === "attack" && sneakOpen ? <label className="flex items-start gap-2 text-xs text-amber-200">
      <input type="checkbox" checked={sneakAttack} onChange={(event) => setSneakAttack(event.target.checked)} disabled={disabled} className="mt-0.5" /><span>{copy.sneak}</span>
    </label> : null}
    {spellSlots.length ? <div>
      <p className="mb-1 text-[11px] text-stone-400">{copy.slot}</p>
      <div className="flex flex-wrap gap-1.5">{spellSlots.map((entry) => <button key={entry.level} type="button" aria-pressed={slot === entry.level} disabled={disabled}
        onClick={() => setSlotLevel(entry.level)} className={toggle(slot === entry.level)}>{entry.level} {copy.level} · {copy.slotLeft} {entry.left}</button>)}</div>
    </div> : null}
    {selected.spell ? targetChips(
      selected.spell.target === "enemy" ? attackTargets : selected.spell.target === "ally" ? friends(allies) : [{ id: sheet.id, name: copy.self, foe: false }],
      spellChoice, copy.spellTarget,
    ) : selected.targets && selected.make ? targetChips(selected.targets, selected.make, selected.section === "item" ? copy.itemTarget : copy.target) : null}
  </>) : null;

  const specialPicker = selectedKey === "parley" ? picker(copy.parley, { kind: "glyph", key: APPROACH_ICONS[approach] }, <>
    <div>
      <p className="mb-1 text-[11px] text-stone-400">{copy.approach}</p>
      <div className="flex flex-wrap gap-1.5">{PARLEY_APPROACHES.map((entry) => <button key={entry} type="button" aria-pressed={approach === entry} disabled={disabled}
        onClick={() => setApproach(entry)} className={cn(toggle(approach === entry), "pl-1")}><GameIcon icon={{ kind: "glyph", key: APPROACH_ICONS[entry] }} size="size-6" />{copy.approaches[entry]}</button>)}</div>
    </div>
    {targetChips([{ id: "", name: copy.everyone, foe: true }, ...foes], (id) => ({ type: "parley", approach, ...(id ? { targetEnemyId: id } : {}) }), copy.whom)}
    <p className="text-[11px] text-stone-500">{copy.parleyHint}</p>
  </>) : selectedKey === "improvise" ? picker(copy.improvise, { kind: "action", key: "use-object" }, <>
    <label className="block text-[11px] text-stone-400">{copy.improviseLabel}
      <textarea value={improvised} onChange={(event) => setImprovised(event.target.value)} maxLength={300} rows={2} disabled={disabled} placeholder={copy.improvisePlaceholder}
        className="mt-1 w-full resize-y rounded-lg border border-stone-700 bg-stone-950/80 p-2 text-sm text-stone-100 placeholder:text-stone-500 disabled:opacity-50" />
    </label>
    <button type="button" disabled={disabled || !improvised.trim()} onClick={() => queue({ type: "improvise", text: improvised.trim() })}
      className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-40">{copy.add}</button>
  </>) : null;

  const pill = (text: string, free: boolean) => <li key={text} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
    free ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-stone-800 bg-stone-900/60 text-stone-500")}>
    <span aria-hidden="true" className={cn("size-1.5 rounded-full", free ? "bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]" : "bg-stone-600")} />{text}
  </li>;
  const attackFree = left.attacksMade > 0 ? left.attacksMade < left.attacksAllowed : !left.actionUsed;

  return <section className="@container rounded-xl border border-amber-700/60 bg-stone-950/95 p-3 text-sm shadow-elev-1" aria-label={copy.title}>
    <div className="flex items-center justify-between gap-2 text-amber-100">
      <strong className="flex min-w-0 items-center gap-2"><Swords className="size-4 shrink-0 text-amber-400" aria-hidden="true" /><span className="truncate">{copy.turn}: {sheet.name}</span></strong>
      <span className="shrink-0 text-xs text-stone-400">{copy.round} {encounter.round}</span>
    </div>
    <ul aria-label={copy.budget} className="mt-2 flex flex-wrap gap-1.5">
      {pill(copy.action, !left.actionUsed)}
      {pill(copy.bonus, !left.bonusUsed)}
      {left.attacksAllowed > 1 ? pill(`${copy.attacks} ${left.attacksMade}/${left.attacksAllowed}`, attackFree) : null}
      {left.extraActions ? pill(copy.extra, true) : null}
    </ul>
    {locked ? <p role="status" className="mt-2 text-xs text-amber-200">{copy.locked}</p> : null}
    {spellsLoading ? <p role="status" className="mt-2 text-xs text-stone-400">{copy.spellsLoading}</p> : null}
    {spellsError ? <p role="alert" className="mt-2 text-xs text-red-300">{copy.spellsError}</p> : null}

    <div role="group" aria-label={copy.groups} className="mt-3 grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-stone-800/80 bg-stone-900/50 p-1">
      {groups.map((group) => <button key={group} type="button" aria-pressed={shown === group} onClick={() => { setTab(group); reset(); }}
        className={cn("flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-[11px] font-medium transition-all duration-150 ease-snap active:scale-95 @md:flex-row @md:gap-1.5 @md:text-xs",
          shown === group ? "bg-gradient-to-b from-amber-100 to-amber-400 text-amber-950 shadow-glow-gold" : "text-stone-400 hover:bg-stone-800 hover:text-stone-200")}>
        <GameIcon icon={GROUP_ICONS[group]} size="size-6" /><span className="max-w-full truncate">{copy.tabs[group]}</span>
      </button>)}
    </div>

    {shown === "pet" ? <div className="mt-2.5">{petPanel}</div> : sections.map(([section, run]) => <div key={section}>
      {sections.length > 1 ? <p className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{section ? copy.sections[section] : null}</p> : null}
      <div className={cn("grid grid-cols-2 gap-1.5 @md:grid-cols-3 @2xl:grid-cols-4", sections.length > 1 ? "" : "mt-2.5")}>
      {run.map((tile) => <button key={tile.key} type="button" onClick={() => pick(tile.key, tile.choice)}
        disabled={disabled || !tile.ready} aria-pressed={tile.choice ? undefined : selectedKey === tile.key}
        aria-label={[tile.label, tile.bonus ? copy.bonus : "", tile.badge ?? ""].filter(Boolean).join(" · ")}
        className={cn("flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs leading-tight transition-all duration-150 ease-snap",
          selectedKey === tile.key ? "border-amber-400/80 bg-amber-500/15 text-amber-50 shadow-glow-gold"
            : "border-stone-700/70 bg-stone-900/70 text-stone-200 hover:-translate-y-px hover:border-amber-500/50 hover:bg-stone-800/80",
          "disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-700/70 disabled:hover:bg-stone-900/70")}>
        <GameIcon icon={tile.icon} size="size-8" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2">{tile.label}</span>
          {tile.bonus || tile.badge ? <span className="mt-0.5 flex flex-wrap gap-1 text-[10px] leading-none">
            {tile.bonus ? <span className="rounded border border-sky-700/60 px-1 py-px text-sky-200">{copy.bonusBadge}</span> : null}
            {tile.badge ? <span className="rounded border border-stone-700 px-1 py-px text-stone-400">{tile.badge}</span> : null}
          </span> : null}
        </span>
      </button>)}
      </div>
    </div>)}
    {tilePicker}

    <div className="mt-3 border-t border-stone-800/80 pt-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">{copy.other}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ["parley", copy.parley, copy.parleyTip, { kind: "glyph", key: "skill-persuasion" }, special.parley],
          ["flee", copy.flee, copy.fleeTip, { kind: "glyph", key: "pace-fast" }, special.flee],
          ["improvise", copy.improvise, copy.improviseTip, { kind: "action", key: "use-object" }, special.improvise],
        ] as const).map(([key, text, tip, icon, ready]) => <Tooltip key={key} content={tip}>
          <button type="button" disabled={disabled || !ready} aria-pressed={key === "flee" ? undefined : selectedKey === key}
            onClick={() => pick(key, key === "flee" ? { type: "flee" } : undefined)}
            className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-center text-xs font-medium leading-tight transition-all duration-150 ease-snap @sm:flex-row @sm:gap-2",
              selectedKey === key ? "border-amber-400/80 bg-amber-500/15 text-amber-50 shadow-glow-gold"
                : "border-amber-800/50 bg-gradient-to-b from-stone-900 to-stone-950 text-amber-100 hover:-translate-y-px hover:border-amber-500/60",
              "disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-amber-800/50")}>
            <GameIcon icon={icon} size="size-7" />{text}
          </button>
        </Tooltip>)}
      </div>
      {specialPicker}
    </div>

    {!tiles.some((tile) => tile.ready) && !special.flee && !choices.length ? <p className="mt-2 text-xs text-stone-400">{copy.unavailable}</p> : null}
    <div role="region" aria-label={copy.queued} className="mt-3 border-t border-stone-800/80 pt-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">{copy.queued}</p>
      {choices.length ? <ol className="space-y-1">{choices.map((choice, index) => <li key={`${index}:${label(choice)}`}
        className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/70 px-2 py-1.5 text-xs text-stone-200">
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-200">{index + 1}</span>
        <span className="min-w-0 flex-1 break-words">{label(choice)}</span>
        <button type="button" aria-label={`${copy.remove} ${index + 1}`} disabled={disabled} onClick={() => setChoices(choices.filter((_, current) => current !== index))}
          className="rounded p-1 text-stone-400 hover:bg-stone-700 hover:text-stone-100"><X className="size-4" /></button>
      </li>)}</ol> : <p className="text-xs text-stone-500">{copy.emptyPlan}</p>}
      {choices.length ? <label className="mt-2.5 block text-xs text-stone-300">{copy.description}
        <textarea aria-label={copy.description} value={description} onChange={event => onDescriptionChange(event.target.value)} maxLength={2000} rows={3} disabled={disabled}
          placeholder={parleyQueued ? copy.parleyPlaceholder : copy.descriptionPlaceholder}
          className="mt-1 w-full resize-y rounded-lg border border-stone-700 bg-stone-900 p-2 text-sm text-stone-100 placeholder:text-stone-500 disabled:opacity-50" />
      </label> : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {choices.length ? <button type="button" disabled={disabled || Boolean(selectedKey) || !preview.ok} onClick={submit}
          className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-4 py-2 font-medium text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all hover:-translate-y-px hover:shadow-glow-gold disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none">{sending ? copy.sending : copy.send}</button> : null}
        {!choices.length && !selectedKey ? <button type="button" disabled={disabled} onClick={submit}
          className="rounded-lg border border-stone-600 px-3 py-2 text-xs text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40">{copy.end}</button> : null}
      </div>
    </div>
    {confirming ? <ActionPreviewDialog
      content={choices.length ? description.trim() : copy.skipIntent}
      name={sheet.name}
      locale={locale}
      queuedActions={choices.length}
      queuedActionLabels={choices.map(label)}
      onEdit={() => setConfirming(false)}
      onSend={() => { setConfirming(false); onSubmit(intent()); }}
      disabled={locked || sending}
    /> : null}
  </section>;
}
