"use client";

import { useState, type ReactNode } from "react";
import { Swords, X } from "lucide-react";
import { ActionPreviewDialog } from "@/app/campaigns/[campaignId]/ActionPreviewDialog";
import { combatChoiceDescriptors, combatChoiceLabel, combatIntentBudget, combatSpellSlots, validateCombatTurnIntent, type CombatChoice, type CombatSpellDescriptor, type CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import { freshBudget } from "@/lib/dm/action-budget";
import { petCommandCost } from "@/lib/dm/pet-combat";
import { localizedContentName } from "@/lib/help";
import { useI18n } from "@/lib/i18n";
import { combatRiders, hasCunningAction } from "@/lib/srd/feature-effects";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  ru: {
    title: "Конструктор боевого хода", round: "Раунд", action: "Действие", bonus: "Бонусное действие", choose: "Выберите действие",
    chooseValue: "Выберите", target: "Выберите цель", weapon: "Оружие", slot: "Ячейка заклинания", add: "Добавить в план",
    attack: "Атака", dodge: "Уклонение", dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помочь союзнику",
    grapple: "Захватить", shove: "Сбить с ног", cunning: "Хитрое действие", spell: "Заклинание", resource: "Способность",
    item: "Использовать предмет", pet: "Команда питомцу", sneak: "Заявить Скрытую атаку, если условия выполнены",
    queued: "Выбрано", description: "Описание хода (необязательно)", descriptionPlaceholder: "Что делает или говорит персонаж?", remove: "Убрать действие", send: "Отправить ход", end: "Пропустить ход", skipIntent: "Я пропускаю боевой ход.", sending: "Отправка…",
    locked: "Мастер обрабатывает ход.", unavailable: "Нет доступных действий с текущими ресурсами и целями.",
    rejected: "Это действие сейчас недоступно.", self: "На себя", spellTarget: "Цель заклинания", itemTarget: "Кому применить предмет",
  },
  en: {
    title: "Combat turn builder", round: "Round", action: "Action", bonus: "Bonus action", choose: "Choose an action",
    chooseValue: "Choose", target: "Choose a target", weapon: "Weapon", slot: "Spell slot", add: "Add to plan",
    attack: "Attack", dodge: "Dodge", dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help an ally",
    grapple: "Grapple", shove: "Shove prone", cunning: "Cunning Action", spell: "Spell", resource: "Ability",
    item: "Use an item", pet: "Command a pet", sneak: "Request Sneak Attack if eligible",
    queued: "Selected", description: "Turn description (optional)", descriptionPlaceholder: "What does your character do or say?", remove: "Remove action", send: "Submit turn", end: "Skip turn", skipIntent: "I skip my combat turn.", sending: "Sending…",
    locked: "The DM is resolving this turn.", unavailable: "No actions are available with the current resources and targets.",
    rejected: "This action is not available right now.", self: "Self", spellTarget: "Spell target", itemTarget: "Use item on",
  },
};

type WizardOption = {
  key: string;
  kind: "attack" | "dodge" | "maneuver" | "resource" | "item" | "spell" | "pet";
  label: string;
  cost: "action" | "bonus";
  weapon?: string;
  action?: "dash" | "disengage" | "hide" | "help" | "grapple" | "shove";
  cunningAction?: boolean;
  resource?: string;
  item?: string;
  spell?: CombatSpellDescriptor;
};

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
  const [selectedKey, setSelectedKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [slotLevel, setSlotLevel] = useState("");
  const [sneakAttack, setSneakAttack] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const descriptors = combatChoiceDescriptors(sheet);
  const weapons = descriptors.filter((entry) => entry.type === "weapon");
  const resources = descriptors.filter((entry) => entry.type === "resource");
  const items = descriptors.filter((entry) => entry.type === "item");
  const enemies = encounter.enemies.filter((enemy) => enemy.status === "alive");
  const combatantIds = new Set(encounter.order.filter((entry) => entry.kind === "pc").map((entry) => entry.id));
  const allies = [
    ...sheets.filter((entry) => !entry.deathSaves?.dead && (!encounter.orderReady || combatantIds.has(entry.id))),
    ...encounter.order.filter(entry => entry.kind === "pc" && !sheets.some(sheet => sheet.id === entry.id)),
  ];
  const otherAllies = allies.filter((ally) => ally.id !== sheet.id);
  const attackTargets = friendlyFire ? [...enemies, ...otherAllies] : enemies;
  const attackChoice = (id: string, weapon: string): CombatChoice => ({ type: "attack", weapon,
    ...(enemies.some(enemy => enemy.id === id) ? { targetEnemyId: id } : { targetCharacterId: id }) });
  const targetNames = new Map([...allies, ...enemies].map((entry) => [entry.id, entry.name] as const));
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
  const actionNames = { dash: copy.dash, disengage: copy.disengage, hide: copy.hide, help: copy.help, grapple: copy.grapple, shove: copy.shove };
  // Nested so the i18n checker sees the Cyrillic label only under locale === "ru".
  const names = (name: string) => name === "Unarmed strike" ? (locale === "ru" ? "Безоружный удар" : name) : localizedContentName("item", name, locale);
  const options: WizardOption[] = [];

  if (attackTargets.length) {
    for (const weapon of weapons) {
      if (attackTargets.some(target => canQueue(attackChoice(target.id, weapon.name)))) {
        options.push({ key: `attack:${weapon.name}`, kind: "attack", label: `${copy.attack}: ${names(weapon.name)}`, cost: "action", weapon: weapon.name });
      }
    }
  }
  if (canQueue({ type: "dodge" })) options.push({ key: "dodge", kind: "dodge", label: copy.dodge, cost: "action" });

  const maneuvers: Array<WizardOption["action"]> = ["dash", "disengage", "hide", "help", "grapple", "shove"];
  for (const action of maneuvers) {
    if (!action) continue;
    const targets = action === "help" ? otherAllies : action === "grapple" || action === "shove" ? enemies : [];
    const candidates = targets.length ? targets.map((target) => action === "help"
      ? { type: "action" as const, action, targetCharacterId: target.id }
      : { type: "action" as const, action, targetEnemyId: target.id }) : [{ type: "action" as const, action }];
    if (candidates.some(canQueue)) options.push({ key: `maneuver:${action}`, kind: "maneuver", label: actionNames[action], cost: "action", action });
    if (["dash", "disengage", "hide"].includes(action) && hasCunningAction(sheet) && candidates.some((choice) => {
      const cunningChoice = { ...choice, cunningAction: true } as CombatChoice;
      return canQueue(cunningChoice);
    })) {
      options.push({ key: `cunning:${action}`, kind: "maneuver", label: `${copy.cunning}: ${actionNames[action]}`, cost: "bonus", action, cunningAction: true });
    }
  }

  for (const resource of resources) {
    const targets = resource.target === "self" ? [sheet.id] : allies
      .filter((ally) => resource.target !== "other" || ally.id !== sheet.id).map((ally) => ally.id);
    if (targets.some((id) => canQueue({ type: "resource", resource: resource.id, targetCharacterId: id }))) {
      options.push({ key: `resource:${resource.id}`, kind: "resource", label: locale === "ru"
        ? ({ second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук" }[resource.id] ?? resource.name)
        : resource.name,
      cost: resource.cost, resource: resource.id });
    }
  }

  for (const item of items) {
    if (allies.some((ally) => canQueue({ type: "item", item: item.name, targetCharacterId: ally.id }))) {
      options.push({ key: `item:${item.name}`, kind: "item", label: `${copy.item}: ${localizedContentName("item", item.name, locale)}`, cost: "action", item: item.name });
    }
  }

  for (const spell of spellOptions) {
    if (!spell.target || spell.level === null || (spell.cost !== "action" && spell.cost !== "bonus")) continue;
    const level = spell.level;
    const slots = level > 0 ? combatSpellSlots(sheet, level) : [];
    if (level > 0 && !slots.length) continue;
    const targets = spell.target === "enemy" ? attackTargets : spell.target === "ally" ? allies : [sheet];
    const targetIds = targets.map((target) => target.id);
    if (!targetIds.some((id) => canQueue({
      type: "spell", spell: spell.name, targetId: id,
      ...(level > 0 && slots[0] ? { slotLevel: slots[0].level } : {}),
    }))) continue;
    options.push({ key: `spell:${spell.name}`, kind: "spell", label: `${copy.spell}: ${localizedContentName("spell", spell.name, locale)}`, cost: spell.cost, spell });
  }

  for (const pet of sheet.pets ?? []) {
    if (pet.hp <= 0) continue;
    const attack = pet.attacks.find((entry) => enemies.some((enemy) => canQueue({ type: "pet", petName: pet.name, attack: entry.name, targetEnemyId: enemy.id })));
    const canOrder = !budget.oncePerTurn.includes(`pet:${pet.name.toLowerCase()}`) && !choices.some((choice) => (choice.type === "pet" || choice.type === "pet_order") && choice.petName === pet.name);
    if (attack || canOrder) {
      const cost = petCommandCost(pet);
      options.push({ key: `pet:${pet.name}`, kind: "pet", label: `${copy.pet}: ${pet.name}`, cost: cost === "bonus" ? "bonus" : "action" });
    }
  }

  const selected = options.find((option) => option.key === selectedKey);
  const selectedSpell = selected?.kind === "spell" ? selected.spell : undefined;
  const spellSlots = selectedSpell?.level ? combatSpellSlots(sheet, selectedSpell.level) : [];
  const targetOptions = selected?.kind === "attack" ? attackTargets
    : selected?.kind === "maneuver" && (selected.action === "grapple" || selected.action === "shove") ? enemies
    : selected?.kind === "maneuver" && selected.action === "help" ? otherAllies
    : selected?.kind === "spell" && selectedSpell?.target === "enemy" ? attackTargets
    : selected?.kind === "spell" && selectedSpell?.target === "ally" ? allies
    : selected?.kind === "resource" ? (() => {
      const resource = resources.find((entry) => entry.id === selected.resource);
      return resource && resource.target !== "self" ? allies.filter((ally) => resource.target !== "other" || ally.id !== sheet.id) : [];
    })()
    : selected?.kind === "item" ? allies
    : [];
  const targetRequired = targetOptions.length > 0 && !(selected?.kind === "spell" && selectedSpell?.target === "self");

  let draftChoice: CombatChoice | null = null;
  if (selected?.kind === "attack" && selected.weapon && targetId) {
    draftChoice = { ...attackChoice(targetId, selected.weapon), ...(sneakAttack ? { sneakAttack: true } : {}) };
  } else if (selected?.kind === "dodge") draftChoice = { type: "dodge" };
  else if (selected?.kind === "maneuver" && selected.action) {
    if (selected.action === "help" && targetId) draftChoice = { type: "action", action: selected.action, targetCharacterId: targetId };
    else if ((selected.action === "grapple" || selected.action === "shove") && targetId) draftChoice = { type: "action", action: selected.action, targetEnemyId: targetId };
    else if (["dash", "disengage", "hide"].includes(selected.action)) draftChoice = { type: "action", action: selected.action, ...(selected.cunningAction ? { cunningAction: true } : {}) };
  } else if (selected?.kind === "resource" && selected.resource) {
    const resource = resources.find((entry) => entry.id === selected.resource);
    if (resource?.target === "self") draftChoice = { type: "resource", resource: selected.resource, targetCharacterId: sheet.id };
    else if (targetId) draftChoice = { type: "resource", resource: selected.resource, targetCharacterId: targetId };
  } else if (selected?.kind === "item" && selected.item && targetId) {
    draftChoice = { type: "item", item: selected.item, targetCharacterId: targetId };
  } else if (selected?.kind === "spell" && selectedSpell) {
    const spellTargetId = selectedSpell.target === "self" ? sheet.id : targetId;
    const level = selectedSpell.level;
    if (spellTargetId && level !== null && (level === 0 || slotLevel)) {
      draftChoice = { type: "spell", spell: selectedSpell.name, targetId: spellTargetId,
        ...(level > 0 ? { slotLevel: Number(slotLevel) } : {}) };
    }
  }

  const draftValid = Boolean(draftChoice && validate([...choices, draftChoice]).ok);
  const preview = validate(choices);
  const disabled = locked || sending;
  const beginSelection = (key: string) => {
    setSelectedKey(key);
    setTargetId("");
    setSlotLevel("");
    setSneakAttack(false);
    setRejected(false);
  };
  const addDraft = () => {
    if (!draftChoice || !draftValid) { setRejected(true); return; }
    setChoices([...choices, draftChoice]);
    setSelectedKey("");
    setTargetId("");
    setSlotLevel("");
    setSneakAttack(false);
    setRejected(false);
  };
  const cancelSelection = () => { setSelectedKey(""); setTargetId(""); setSlotLevel(""); setSneakAttack(false); setRejected(false); };
  const submit = () => { if (!selected && !disabled && preview.ok) setConfirming(true); };
  const actionOptions = options.filter((option) => option.cost === "action");
  const bonusOptions = options.filter((option) => option.cost === "bonus");
  const selectClass = "mt-1 w-full rounded border border-stone-700 bg-stone-900 p-2 text-sm disabled:opacity-50";

  return <section className="rounded-xl border border-amber-700/60 bg-stone-950/95 p-3 text-sm shadow-elev-1" aria-label={copy.title}>
    <div className="mb-3 flex items-center justify-between gap-2 text-amber-100">
      <strong className="flex items-center gap-2"><Swords className="size-4" aria-hidden="true" />{copy.title}</strong>
      <span className="text-xs text-stone-400">{copy.round} {encounter.round}</span>
    </div>
    {locked ? <p role="status" className="mb-2 text-xs text-amber-200">{copy.locked}</p> : null}
    {spellsLoading ? <p role="status" className="mb-2 text-xs text-stone-400">{locale === "ru" ? "Загружаю доступные заклинания…" : "Loading available spells…"}</p> : null}
    {spellsError ? <p role="alert" className="mb-2 text-xs text-red-300">{locale === "ru" ? "Не удалось загрузить заклинания." : "Could not load spells."}</p> : null}

    <label className="block text-xs text-stone-300">{copy.choose}
      <select aria-label={copy.choose} value={selected?.key ?? ""} onChange={(event) => beginSelection(event.target.value)} disabled={disabled} className={selectClass}>
        <option value="">{copy.chooseValue}</option>
        {actionOptions.length ? <optgroup label={copy.action}>{actionOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup> : null}
        {bonusOptions.length ? <optgroup label={copy.bonus}>{bonusOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup> : null}
      </select>
    </label>

    {selected ? <div className="mt-3 space-y-2 rounded border border-stone-700 p-2">
      {selected.kind === "attack" ? <>
        <p className="text-xs text-stone-300">{copy.weapon}: {names(selected.weapon ?? "")}</p>
        {combatRiders(sheet).sneakAttackDice > 0 && !budget.oncePerTurn.includes("sneak_attack") && !choices.some((choice) => choice.type === "attack" && choice.sneakAttack)
          ? <label className="flex items-start gap-2 text-xs text-amber-200"><input type="checkbox" checked={sneakAttack} onChange={(event) => setSneakAttack(event.target.checked)} disabled={disabled} /><span>{copy.sneak}</span></label>
          : null}
      </> : null}
      {selected.kind === "spell" && selectedSpell && selectedSpell.level !== null && selectedSpell.level > 0 ? <label className="block text-xs text-stone-300">{copy.slot}
        <select aria-label={copy.slot} value={slotLevel} onChange={(event) => setSlotLevel(event.target.value)} disabled={disabled} className={selectClass}>
          <option value="">{copy.chooseValue}</option>{spellSlots.map((slot) => <option key={slot.level} value={slot.level}>{slot.level} · {slot.left} {locale === "ru" ? "осталось" : "left"}</option>)}
        </select>
      </label> : null}
      {targetRequired ? <label className="block text-xs text-stone-300">{selected.kind === "spell" ? copy.spellTarget : selected.kind === "item" ? copy.itemTarget : copy.target}
        <select aria-label={selected.kind === "spell" ? copy.spellTarget : selected.kind === "item" ? copy.itemTarget : copy.target} value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={disabled} className={selectClass}>
          <option value="">{copy.chooseValue}</option>{targetOptions.map((target) => <option key={target.id} value={target.id}>{target.id === sheet.id ? copy.self : target.name}</option>)}
        </select>
      </label> : null}
      {selected.kind === "spell" && selectedSpell?.target === "self" ? <p className="text-xs text-stone-400">{copy.self}</p> : null}
      {selected.kind === "pet" ? petPanel : null}
      {selected.kind !== "pet" ? <div className="flex gap-2">
        <button type="button" disabled={disabled || !draftValid} onClick={addDraft} className="rounded bg-amber-400 px-3 py-2 text-xs font-semibold text-amber-950 disabled:opacity-40">{copy.add}</button>
        <button type="button" disabled={disabled} onClick={cancelSelection} className="rounded border border-stone-600 px-3 py-2 text-xs text-stone-300">{locale === "ru" ? "Отмена" : "Cancel"}</button>
      </div> : <button type="button" disabled={disabled} onClick={cancelSelection} className="rounded border border-stone-600 px-3 py-2 text-xs text-stone-300">{locale === "ru" ? "Готово" : "Done"}</button>}
      {rejected ? <p role="alert" className="text-xs text-red-300">{copy.rejected}</p> : null}
    </div> : null}

    {!actionOptions.length && !bonusOptions.length && !choices.length ? <p className="mt-2 text-xs text-stone-400">{copy.unavailable}</p> : null}
    {choices.length ? <div role="region" className="mt-3 border-t border-stone-700 pt-2" aria-label={copy.queued}>
      <ol className="space-y-1">{choices.map((choice, index) => <li key={`${index}:${combatChoiceLabel(choice, locale)}`} className="flex items-center justify-between gap-2 rounded bg-stone-900 px-2 py-1.5 text-xs">
        <span>{combatChoiceLabel(choice, locale, targetNames)}</span>
        <button type="button" aria-label={`${copy.remove} ${index + 1}`} disabled={disabled} onClick={() => setChoices(choices.filter((_, current) => current !== index))} className="rounded p-1 hover:bg-stone-700"><X className="size-4" /></button>
      </li>)}</ol>
    </div> : null}
    {choices.length ? <label className="mt-3 block text-xs text-stone-300">{copy.description}
      <textarea aria-label={copy.description} value={description} onChange={event => onDescriptionChange(event.target.value)} maxLength={2000} rows={3} disabled={disabled} placeholder={copy.descriptionPlaceholder} className="mt-1 w-full resize-y rounded border border-stone-700 bg-stone-900 p-2 text-sm text-stone-100 disabled:opacity-50" />
    </label> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      {choices.length ? <button type="button" disabled={disabled || Boolean(selected) || !preview.ok} onClick={submit} className="rounded bg-amber-400 px-3 py-2 font-medium text-amber-950 disabled:opacity-40">{sending ? copy.sending : copy.send}</button> : null}
      {!choices.length && !selected ? <button type="button" disabled={disabled} onClick={submit} className="rounded border border-stone-600 px-3 py-2 text-xs text-stone-300">{copy.end}</button> : null}
    </div>
    {confirming ? <ActionPreviewDialog
      content={choices.length ? description.trim() : copy.skipIntent}
      name={sheet.name}
      locale={locale}
      queuedActions={choices.length}
      queuedActionLabels={choices.map((choice) => combatChoiceLabel(choice, locale, targetNames))}
      onEdit={() => setConfirming(false)}
      onSend={() => { setConfirming(false); onSubmit(intent()); }}
      disabled={locked || sending}
    /> : null}
  </section>;
}
