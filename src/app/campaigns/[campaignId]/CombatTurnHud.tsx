"use client";

import { useState, type ReactNode } from "react";
import { Shield, Swords, X } from "lucide-react";
import { ActionPreviewDialog } from "@/app/campaigns/[campaignId]/ActionPreviewDialog";
import { combatChoiceDescriptors, combatChoiceLabel, combatIntentBudget, combatSpellSlots, validateCombatTurnIntent, type CombatChoice, type CombatSpellDescriptor, type CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import { attacksLeft, freshBudget } from "@/lib/dm/action-budget";
import { useI18n } from "@/lib/i18n";
import { combatRiders } from "@/lib/srd/feature-effects";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  ru: { title: "Ваш боевой ход", draft: "Черновик: мастер разрешит выбранное после отправки", action: "Действие", bonus: "Бонусное действие", reaction: "Реакция", attacks: "Атаки", spent: "использовано", ready: "доступно", locked: "Мастер обрабатывает ход. OOC остаётся доступен.", attack: "Атака", weapon: "Оружие", enemy: "Цель атаки", target: "Выберите цель", queue: "Добавить", dodge: "Защита: уклонение", ability: "Способности", resource: "Способность", ally: "Цель способности", item: "Расходуемые предметы", choose: "Выберите", queued: "Порядок действий", empty: "Пока ничего не выбрано", remove: "Убрать действие", prose: "Действия и реплики персонажа", hint: "Опишите детали или реплику героя…", send: "Отправить действие", end: "Закончить ход", sending: "Отправка…", unsupported: "Заклинания, особые способности и другие предметы опишите текстом. Их разрешает мастер.", self: "На себя", rejected: "Выбор недоступен: проверьте оставшиеся действия, ресурс и цель.", cost: "Стоимость", unarmed: "Безоружный удар", second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук", maneuvers: "Тактика и манёвры", spells: "Заклинания", features: "Особенности листа", petActions: "Питомцы" },
  en: { title: "Your combat turn", draft: "Draft: the DM resolves your choices after submission", action: "Action", bonus: "Bonus action", reaction: "Reaction", attacks: "Attacks", spent: "spent", ready: "ready", locked: "The DM is resolving your turn. OOC remains available.", attack: "Attack", weapon: "Weapon", enemy: "Attack target", target: "Choose a target", queue: "Queue", dodge: "Defence: Dodge", ability: "Abilities", resource: "Ability", ally: "Ability target", item: "Consumables", choose: "Choose", queued: "Action order", empty: "Nothing selected yet", remove: "Remove action", prose: "Character actions and dialogue", hint: "Describe details or your character's words…", send: "Send Action", end: "End Turn", sending: "Sending…", unsupported: "Describe spells, special abilities and other items in the text. The DM adjudicates them.", self: "Self", rejected: "Unavailable choice: check your remaining actions, resource and target.", cost: "Cost", unarmed: "Unarmed strike", second_wind: "Second Wind", rage: "Rage", bardic_inspiration: "Bardic Inspiration", lay_on_hands: "Lay on Hands", maneuvers: "Tactics and maneuvers", spells: "Spells", features: "Sheet features", petActions: "Pets" },
};

export function CombatTurnHud({
  encounter,
  sheet,
  sheets,
  locked,
  sending,
  onSubmit,
  choices: externalChoices,
  onChoicesChange,
  prose: externalProse,
  onProseChange,
  spellOptions = [],
  spellsLoading = false,
  spellsError = false,
  petPanel,
}: {
  encounter: PublicEncounter;
  sheet: CharacterSheet;
  sheets: CharacterSheet[];
  locked: boolean;
  sending: boolean;
  onSubmit: (turn: CombatTurnIntent) => void;
  choices?: CombatChoice[];
  onChoicesChange?: (choices: CombatChoice[]) => void;
  prose?: string;
  onProseChange?: (prose: string) => void;
  spellOptions?: CombatSpellDescriptor[];
  spellsLoading?: boolean;
  spellsError?: boolean;
  petPanel?: ReactNode;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [internalChoices, setInternalChoices] = useState<CombatChoice[]>([]);
  const choices = externalChoices !== undefined ? externalChoices : internalChoices;
  const setChoices = (next: CombatChoice[] | ((prev: CombatChoice[]) => CombatChoice[])) => {
    const updated = typeof next === "function" ? next(choices) : next;
    if (onChoicesChange) onChoicesChange(updated);
    else setInternalChoices(updated);
  };
  const [internalProse, setInternalProse] = useState("");
  const prose = externalProse !== undefined ? externalProse : internalProse;
  const setProse = (val: string) => {
    if (onProseChange) onProseChange(val);
    else setInternalProse(val);
  };
  const [weapon, setWeapon] = useState(() => combatChoiceDescriptors(sheet).find(entry => entry.type === "weapon" && entry.name !== "Unarmed strike")?.name ?? "Unarmed strike");
  const [attackTargetId, setAttackTargetId] = useState("");
  const [sneakAttack, setSneakAttack] = useState(false);
  const [maneuverAction, setManeuverAction] = useState<"dash" | "disengage" | "hide" | "help" | "grapple" | "shove" | null>(null);
  const [resource, setResource] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [item, setItem] = useState("");
  const [spell, setSpell] = useState("");
  const [slotLevel, setSlotLevel] = useState("");
  const [spellTarget, setSpellTarget] = useState("");
  const [targetCharacterId, setTargetCharacterId] = useState("");
  const [itemTarget, setItemTarget] = useState(sheet.id);
  const [rejected, setRejected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const descriptors = combatChoiceDescriptors(sheet);
  const weapons = descriptors.filter((entry) => entry.type === "weapon");
  const resources = descriptors.filter((entry) => entry.type === "resource");
  const features = descriptors.filter((entry) => entry.type === "feature");
  const items = descriptors.filter((entry) => entry.type === "item");
  const actionResources = resources.filter(entry => entry.cost === "action");
  const bonusResources = resources.filter(entry => entry.cost === "bonus");
  const usableSpells = spellOptions.filter(entry => entry.level === 0 || entry.level === null || combatSpellSlots(sheet, entry.level).length > 0);
  const selectedFeature = features.find(entry => entry.name === featureName);
  const spellChoiceFor = (spellName: string, preferredSlot?: number, targetId = ""): CombatChoice => {
    const descriptor = spellOptions.find(entry => entry.name === spellName);
    const available = descriptor?.level ? combatSpellSlots(sheet, descriptor.level) : [];
    const slotLevel = available.find(entry => entry.level === preferredSlot)?.level ?? available[0]?.level;
    return { type: "spell", spell: spellName, ...(slotLevel ? { slotLevel } : {}), ...(targetId ? { targetId } : {}) };
  };
  const enemies = encounter.enemies.filter((enemy) => enemy.status === "alive");
  const combatantIds = new Set(encounter.order.filter(entry => entry.kind === "pc").map(entry => entry.id));
  const allies = sheets.filter((entry) => !entry.deathSaves?.dead && (!encounter.orderReady || combatantIds.has(entry.id)));
  const otherAllies = allies.filter(ally => ally.id !== sheet.id);
  const targetNames = new Map([...allies, ...enemies].map(entry => [entry.id, entry.name] as const));
  const baseBudget = combatIntentBudget(encounter, freshBudget({ ownerId: sheet.id, round: encounter.round, attacksAllowed: 1 + combatRiders(sheet).extraAttacks, extraActions: conditionExtraActions(sheet.conditions) }));
  const intent = (entries = choices): CombatTurnIntent => ({ encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, choices: entries, prose: prose.trim() || undefined });
  const validate = (entries: CombatChoice[]) => validateCombatTurnIntent(intent(entries), sheet, new Set(enemies.map((enemy) => enemy.id)), new Set(allies.map((ally) => ally.id)), baseBudget, { language: locale, names: new Map(), spells: spellOptions });
  const canQueue = (choice: CombatChoice) => validate([...choices, choice]).ok;
  const availableSpells = usableSpells.filter(entry => choices.some(choice => choice.type === "spell" && choice.spell === entry.name) || canQueue(spellChoiceFor(entry.name)));
  const actionSpells = availableSpells.filter(entry => entry.cost !== "bonus" && entry.cost !== "reaction");
  const bonusSpells = availableSpells.filter(entry => entry.cost === "bonus");
  const availableResources = (entries: typeof resources) => entries.filter(entry => {
    const targets = entry.target === "self" ? [sheet.id] : allies.filter(ally => entry.target !== "other" || ally.id !== sheet.id).map(ally => ally.id);
    return targets.some(targetCharacterId => canQueue({ type: "resource", resource: entry.id, targetCharacterId }));
  });
  const availableActionResources = availableResources(actionResources);
  const availableBonusResources = availableResources(bonusResources);
  const availableItems = items.filter(entry => canQueue({ type: "item", item: entry.name, targetCharacterId: sheet.id }));
  const canQueueDodge = canQueue({ type: "dodge" });
  const canDeclareSneakAttack = combatRiders(sheet).sneakAttackDice > 0 && !baseBudget.oncePerTurn.includes("sneak_attack") && !choices.some(choice => choice.type === "attack" && choice.sneakAttack);
  const preview = validate(choices);
  const add = (choice: CombatChoice) => {
    const next = [...choices, choice];
    const result = validate(next);
    setRejected(!result.ok);
    if (result.ok) {
      setChoices(next);
      setManeuverAction(null);
      return true;
    }
    return false;
  };
  const updateLatest = (matches: (choice: CombatChoice) => boolean, choice: CombatChoice) => {
    let index = -1;
    choices.forEach((entry, current) => { if (matches(entry)) index = current; });
    if (index < 0) return undefined;
    const next = [...choices];
    next[index] = choice;
    const result = validate(next);
    setRejected(!result.ok);
    if (result.ok) setChoices(next);
    return result.ok;
  };
  const submit = () => { if (!locked && !sending && preview.ok && (choices.length || prose.trim())) setConfirming(true); };
  const disabled = locked || sending;
  const meter = preview.ok ? preview.budget : baseBudget;
  const resourceName = (id: string) => copy[id as "second_wind"] ?? id;
  const weaponName = (name: string) => name === "Unarmed strike" ? copy.unarmed : name;
  const selectClass = "mt-1 w-full min-w-0 rounded border border-stone-700 bg-stone-900 p-2 text-sm disabled:opacity-50";
  const queueClass = "mt-2 rounded border border-stone-600 px-3 py-1.5 text-xs text-stone-200 hover:border-amber-500 disabled:opacity-40";
  const actionNames = locale === "ru" ? { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помочь союзнику", grapple: "Захватить", shove: "Сбить с ног" } : { dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help ally", grapple: "Grapple", shove: "Shove prone" };
  const canQueueAttack = Boolean(enemies[0] && weapons.some(entry => entry.name === weapon) && canQueue({ type: "attack", targetEnemyId: enemies[0].id, weapon }));
  const maneuverOptions = (Object.keys(actionNames) as Array<keyof typeof actionNames>).filter(action => {
    const targetCharacterId = action === "help" ? otherAllies[0]?.id : undefined;
    const targetEnemyId = action === "grapple" || action === "shove" ? enemies[0]?.id : undefined;
    if ((action === "help" && !targetCharacterId) || ((action === "grapple" || action === "shove") && !targetEnemyId)) return false;
    return validate([...choices, { type: "action", action, ...(targetCharacterId ? { targetCharacterId } : {}), ...(targetEnemyId ? { targetEnemyId } : {}) }]).ok;
  });
  const spellLabel = locale === "ru" ? "Заклинание" : "Spell";
  const spellLevelLabel = locale === "ru" ? "ур." : "lv.";
  const adjudication = locale === "ru" ? "Заявка мастеру: применимость, стоимость и эффект определяются правилами особенности; пассивные эффекты не становятся отдельными действиями." : "DM request: the feature's rules determine applicability, cost and effect; passive effects do not become separate actions.";
  const branchClass = "rounded-lg border border-stone-700 p-2";
  const summaryClass = "cursor-pointer font-medium text-stone-100";
  const chooseResource = (value: string, entries: typeof resources) => {
    setResource(value);
    setTargetCharacterId("");
    const selected = entries.find(entry => entry.id === value);
    if (selected?.target === "self") {
      add({ type: "resource", resource: value, targetCharacterId: sheet.id });
      setResource("");
    }
  };
  const renderResources = (entries: typeof resources, label: string) => {
    const selected = entries.find(entry => entry.id === resource);
    return <>
      <select aria-label={label} value={selected?.id ?? ""} onChange={event => chooseResource(event.target.value, entries)} disabled={disabled} className={selectClass}>
        <option value="">{copy.choose}</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{resourceName(entry.id)} ({entry.left})</option>)}
      </select>
      {selected && selected.target !== "self" ? <select aria-label={copy.ally} value={targetCharacterId} onChange={event => {
        const targetId = event.target.value;
        setTargetCharacterId(targetId);
        if (targetId) {
          add({ type: "resource", resource: selected.id, targetCharacterId: targetId });
          setResource("");
        }
      }} disabled={disabled} className={selectClass}><option value="">{copy.target}</option>{allies.filter(ally => selected.target !== "other" || ally.id !== sheet.id).map(ally => <option key={ally.id} value={ally.id}>{ally.id === sheet.id ? copy.self : ally.name}</option>)}</select> : null}
      {selected?.target !== "self" && selected ? <p role="status" className="mt-1 text-xs text-sky-200">{locale === "ru" ? "Выберите цель — способность сразу добавится в план." : "Choose a target; the ability is immediately added to the plan."}</p> : null}
    </>;
  };
  const renderSpellPicker = (options: CombatSpellDescriptor[], label: string, costLabel: string) => {
    const activeSpell = options.find(entry => entry.name === spell);
    const activeSlots = activeSpell?.level ? combatSpellSlots(sheet, activeSpell.level) : [];
    const activeSlot = activeSlots.find(entry => String(entry.level) === slotLevel)?.level ?? activeSlots[0]?.level;
    return <details className={branchClass}>
      <summary className={summaryClass}>{label}</summary>
      <select aria-label={`${spellLabel} (${costLabel})`} value={activeSpell?.name ?? ""} onChange={event => { const value = event.target.value; setSpell(value); setSlotLevel(""); setSpellTarget(""); if (value) add(spellChoiceFor(value)); }} disabled={disabled} className={selectClass}>
        <option value="">{copy.choose}</option>{options.map(entry => <option key={entry.name} value={entry.name}>{entry.name} · {entry.level === 0 ? (locale === "ru" ? "заговор" : "cantrip") : entry.level === null ? "?" : `${spellLevelLabel} ${entry.level}`}</option>)}
      </select>
      {activeSpell ? <>
        <p className="mt-1 text-xs text-violet-200">{copy.cost}: {activeSpell.cost === "action" ? copy.action : activeSpell.cost === "bonus" ? copy.bonus : (locale === "ru" ? "уточняет мастер" : "DM adjudicates")}{activeSpell.level === 0 ? (locale === "ru" ? " · без ячейки" : " · no slot") : ""}</p>
        {activeSpell.level !== null && activeSpell.level > 0 ? activeSlots.length ? <select aria-label={locale === "ru" ? "Ячейка заклинания" : "Spell slot"} value={activeSlot ?? ""} onChange={event => { const value = Number(event.target.value); setSlotLevel(String(value)); updateLatest(entry => entry.type === "spell" && entry.spell === spell, spellChoiceFor(spell, value, spellTarget)); }} disabled={disabled} className={selectClass}>{activeSlots.map(entry => <option key={entry.level} value={entry.level}>{locale === "ru" ? "Уровень" : "Level"} {entry.level} · {entry.left} {locale === "ru" ? "осталось" : "left"}</option>)}</select> : <p className="mt-1 text-xs text-amber-300">{locale === "ru" ? "Нет свободных подходящих ячеек." : "No suitable spell slots left."}</p> : null}
        <select aria-label={locale === "ru" ? "Цель заклинания" : "Spell target"} value={spellTarget} onChange={event => { const value = event.target.value; setSpellTarget(value); updateLatest(entry => entry.type === "spell" && entry.spell === spell, spellChoiceFor(spell, activeSlot, value)); }} disabled={disabled} className={selectClass}><option value="">{locale === "ru" ? "Цель / область — описать в тексте" : "Target / area — describe in text"}</option>{[...enemies, ...allies].map(target => <option key={target.id} value={target.id}>{target.id === sheet.id ? copy.self : target.name}</option>)}</select>
        <p role="status" className="mt-1 text-xs text-sky-200">{locale === "ru" ? "Заклинание уже в плане; цель и ячейку можно уточнить здесь." : "Spell added to the plan; adjust its target or slot here."}</p>
      </> : null}
    </details>;
  };

  return <section className="mb-2 rounded-xl border border-amber-700/60 bg-stone-950/95 p-3 text-sm shadow-elev-1" aria-label={copy.title}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-amber-100">
      <strong className="flex items-center gap-1.5"><Swords className="size-4" /> {sheet.name} · {locale === "ru" ? "Раунд" : "Round"} {encounter.round}</strong>
      <span className="text-xs text-stone-400">{copy.draft}</span>
    </div>
    <p className="mb-2 text-xs text-stone-300">{locale === "ru" ? "Выбор действия автоматически добавляется в план, когда заполнены нужные поля. Можно также просто описать замысел. Перед отправкой появится подтверждение всего плана." : "Choosing an action adds it to the plan as soon as its required fields are complete. You can also describe your intent. The full plan appears for confirmation before sending."}</p>
    <div className="mb-3 flex flex-wrap gap-1.5 text-xs" aria-live="polite">
      {([[copy.action, meter.actionUsed], [copy.bonus, meter.bonusUsed], [copy.reaction, meter.reactionUsed]] as const).map(([name, spent]) => <span key={name} className={`rounded border px-2 py-1 ${spent ? "border-stone-700 text-stone-500" : "border-amber-800 text-amber-200"}`}>{name}: {spent ? copy.spent : copy.ready}</span>)}
      <span className="rounded bg-stone-800 px-2 py-1">{copy.attacks}: {attacksLeft(meter)} {locale === "ru" ? "осталось" : "remaining"}</span>
    </div>
    {locked ? <p role="status" className="mb-2 rounded bg-amber-950/50 p-2 text-xs text-amber-200">{copy.locked}</p> : null}
    <div className="space-y-2">
      <details open className="rounded-lg border border-amber-800/70 p-2">
        <summary className="cursor-pointer font-semibold text-amber-100">{copy.action}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {canQueueAttack ? <details className={branchClass}>
            <summary className={summaryClass}>{copy.attack}</summary>
            <select aria-label={copy.weapon} value={weapon} onChange={event => setWeapon(event.target.value)} disabled={disabled} className={selectClass}>{weapons.map(entry => <option key={entry.name} value={entry.name}>{weaponName(entry.name)}</option>)}</select>
            {canDeclareSneakAttack ? <label className="mt-2 flex items-start gap-2 text-xs text-amber-200"><input type="checkbox" checked={sneakAttack} onChange={event => setSneakAttack(event.target.checked)} disabled={disabled} /><span>{locale === "ru" ? "Заявить Скрытую атаку к этому удару (если условия выполнены)" : "Request Sneak Attack on this swing (if eligible)"}</span></label> : null}
            <select aria-label={copy.enemy} value={attackTargetId} onChange={event => { const targetId = event.target.value; setAttackTargetId(""); if (targetId) { const added = add({ type: "attack", targetEnemyId: targetId, weapon, ...(sneakAttack ? { sneakAttack: true } : {}) }); if (added) setSneakAttack(false); } }} disabled={disabled} className={selectClass}><option value="">{copy.target}</option>{enemies.map(enemy => <option key={enemy.id} value={enemy.id}>{enemy.name}</option>)}</select>
            <p className="mt-1 text-xs text-stone-400">{locale === "ru" ? "Выбор цели добавляет один удар; дополнительный откроется только при Extra Attack в листе." : "Selecting a target queues one swing; another is available only with Extra Attack on the sheet."}</p>
          </details> : null}
          {canQueueDodge ? <button type="button" disabled={disabled} onClick={() => add({ type: "dodge" })} className={queueClass}><Shield className="mr-1 inline size-3" />{copy.dodge}</button> : null}
          {(availableActionResources.length > 0 || features.length > 0) ? <details className={branchClass}>
            <summary className={summaryClass}>{copy.ability}</summary>
            {availableActionResources.length ? <div className="mt-1"><p className="text-xs text-stone-400">{copy.action}</p>{renderResources(availableActionResources, `${copy.resource} (${copy.action})`)}</div> : null}
            {features.length ? <div className="mt-2 border-t border-stone-700 pt-2">
              <label className="block text-xs text-stone-300">{copy.features} — {locale === "ru" ? "уточнить у мастера" : "DM adjudicates"}
                <select aria-label={copy.features} value={featureName} onChange={event => { const value = event.target.value; setFeatureName(value); setTargetCharacterId(""); const feature = features.find(entry => entry.name === value); if (feature) add({ type: "feature", feature: feature.name }); }} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{features.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select>
              </label>
              {selectedFeature ? <>
                <select aria-label={copy.ally} value={targetCharacterId} onChange={event => { const targetId = event.target.value; setTargetCharacterId(targetId); if (targetId) { const choice: CombatChoice = { type: "feature", feature: selectedFeature.name, targetId }; if (updateLatest(entry => entry.type === "feature" && entry.feature === selectedFeature.name, choice) === undefined) add(choice); } }} disabled={disabled} className={selectClass}><option value="">{locale === "ru" ? "Цель (если нужна)" : "Target (if needed)"}</option>{[...enemies, ...allies].map(target => <option key={target.id} value={target.id}>{target.id === sheet.id ? copy.self : target.name}</option>)}</select>
                <p role="status" className="mt-1 text-xs text-sky-200">{locale === "ru" ? "Особенность добавлена как заявка; пассивные эффекты не применяются отдельно." : "Feature added as a request; passive effects are not applied separately."}</p>
                <p className="mt-1 text-xs text-stone-400">{adjudication}</p>
              </> : null}
            </div> : null}
          </details> : null}
          {sheet.spellcasting && (actionSpells.length > 0 || spellsLoading || spellsError) ? <div className="space-y-2">
            {spellsLoading ? <details open className={branchClass}><summary className={summaryClass}>{copy.spells}</summary><p role="status" className="mt-1">{locale === "ru" ? "Загрузка заклинаний…" : "Loading spells…"}</p></details> : spellsError ? <details open className={branchClass}><summary className={summaryClass}>{copy.spells}</summary><p role="alert" className="mt-1">{locale === "ru" ? "Не удалось загрузить заклинания. Обновите страницу." : "Could not load spells. Refresh the page."}</p></details> : actionSpells.length ? renderSpellPicker(actionSpells, copy.spells, copy.action) : null}
          </div> : null}
          {availableItems.length ? <details className={branchClass}>
            <summary className={summaryClass}>{copy.item}</summary>
            <p className="mt-1 text-xs text-amber-300">{copy.action}</p>
            <select aria-label={copy.item} value={item} onChange={event => { const value = event.target.value; setItem(value); if (value) add({ type: "item", item: value, targetCharacterId: itemTarget }); }} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{availableItems.map(entry => <option key={entry.name} value={entry.name}>{entry.name} ({entry.qty})</option>)}</select>
            <select aria-label={`${copy.item}: ${copy.target}`} value={itemTarget} onChange={event => { const targetId = event.target.value; setItemTarget(targetId); if (item) updateLatest(entry => entry.type === "item" && entry.item === item, { type: "item", item, targetCharacterId: targetId }); }} disabled={disabled} className={selectClass}>{allies.map(ally => <option key={ally.id} value={ally.id}>{ally.id === sheet.id ? copy.self : ally.name}</option>)}</select>
          </details> : null}
          {maneuverOptions.length ? <details className={branchClass}>
            <summary className={summaryClass}>{copy.maneuvers}</summary>
            <div className="mt-1 flex flex-wrap gap-2">{maneuverOptions.map(action => {
              const needsTarget = action === "help" || action === "grapple" || action === "shove";
              return <button key={action} type="button" className={queueClass} disabled={disabled} onClick={() => {
                if (needsTarget) setManeuverAction(action);
                else add({ type: "action", action });
              }}>{actionNames[action]}</button>;
            })}</div>
            {maneuverAction && maneuverOptions.includes(maneuverAction) ? <select
              aria-label={maneuverAction === "help"
                ? (locale === "ru" ? "Союзник для помощи" : "Ally to help")
                : `${locale === "ru" ? "Цель манёвра" : "Maneuver target"}: ${actionNames[maneuverAction]}`}
              value=""
              onChange={event => {
                const targetId = event.target.value;
                if (!targetId) return;
                add({ type: "action", action: maneuverAction, ...(maneuverAction === "help" ? { targetCharacterId: targetId } : { targetEnemyId: targetId }) });
              }}
              disabled={disabled}
              className={selectClass}
            >
              <option value="">{copy.target}</option>
              {(maneuverAction === "help" ? otherAllies : enemies).map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select> : null}
          </details> : null}
          {petPanel ? <details className={branchClass}><summary className={summaryClass}>{copy.petActions}</summary><div className="mt-2">{petPanel}</div></details> : null}
        </div>
      </details>
      {(availableBonusResources.length > 0 || bonusSpells.length > 0) ? <details className="rounded-lg border border-sky-900/80 p-2">
        <summary className="cursor-pointer font-semibold text-sky-200">{copy.bonus}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {availableBonusResources.length ? <details className={branchClass}><summary className={summaryClass}>{copy.ability}</summary><p className="mt-1 text-xs text-stone-400">{copy.bonus}</p>{renderResources(availableBonusResources, `${copy.resource} (${copy.bonus})`)}</details> : null}
          {sheet.spellcasting && bonusSpells.length ? renderSpellPicker(bonusSpells, copy.spells, copy.bonus) : null}
        </div>
      </details> : null}
    </div>
    <div className="mt-2 rounded border border-amber-700/60 bg-stone-900/80 p-2 text-xs" role="region" aria-label={copy.queued} aria-live="polite"><b>{copy.queued} ({choices.length}):</b>
      <ol className="mt-1 space-y-1">{choices.map((choice, index) => <li key={index} className="flex items-center justify-between gap-2 rounded bg-stone-800 p-1.5"><span>{index + 1}. {combatChoiceLabel(choice, locale, targetNames)}</span><button type="button" aria-label={`${copy.remove} ${index + 1}`} disabled={disabled} onClick={() => { setChoices((current) => current.filter((_, i) => i !== index)); setRejected(false); }} className="rounded p-1.5 hover:bg-stone-700"><X className="size-4" /></button></li>)}</ol>
      {!choices.length ? <p className="mt-1 text-stone-300">{locale === "ru" ? "Действия не добавлены. Отправится только ваш текст; мастер определит механику по нему." : "No queued actions. Only your text will be sent; the DM will interpret it."}</p> : <p className="mt-2 text-amber-200">{locale === "ru" ? "Мастер получит этот порядок как явный выбор. Описание ниже дополняет план." : "The DM receives this order as your explicit choice. The description below supplements it."}</p>}
    </div>
    {rejected || !preview.ok ? <p role="alert" className="mt-1 text-xs text-red-300">{copy.rejected}</p> : null}
    <p className="mt-2 text-xs text-stone-500">{locale === "ru" ? "Выбор — заявка, а не выполненное действие. Детали, область заклинания и условия способностей опишите ниже; мастер разрешит их по правилам." : "Choices are requests, not resolved actions. Describe details, spell areas and feature conditions below; the DM adjudicates them under the rules."}</p>
    <textarea aria-label={copy.prose} maxLength={1200} value={prose} onChange={(e) => setProse(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} disabled={disabled} rows={2} placeholder={copy.hint} className="mt-2 w-full rounded border border-stone-700 bg-stone-900 p-2 text-sm" />
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !preview.ok || (!choices.length && !prose.trim())} onClick={submit} className="rounded bg-amber-400 px-3 py-2 font-medium text-amber-950 disabled:opacity-40">{sending ? copy.sending : copy.send}</button>
      {!choices.length && !prose.trim() ? <button type="button" disabled={disabled} onClick={() => onSubmit(intent([]))} className={queueClass}>{copy.end}</button> : null}
    </div>
    {confirming ? <ActionPreviewDialog
      content={prose.trim()}
      name={sheet.name}
      locale={locale}
      queuedActions={choices.length}
      queuedActionLabels={choices.map(choice => combatChoiceLabel(choice, locale, targetNames))}
      onEdit={() => setConfirming(false)}
      onSend={() => { setConfirming(false); onSubmit(intent()); }}
      disabled={locked || sending}
    /> : null}
  </section>;
}
