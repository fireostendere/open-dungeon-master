"use client";

import { useState } from "react";
import { Shield, Swords, X } from "lucide-react";
import { combatChoiceDescriptors, combatIntentBudget, combatSpellSlots, validateCombatTurnIntent, type CombatChoice, type CombatSpellDescriptor, type CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import { attacksLeft, freshBudget } from "@/lib/dm/action-budget";
import { useI18n } from "@/lib/i18n";
import { combatRiders } from "@/lib/srd/feature-effects";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  ru: { title: "Ваш боевой ход", draft: "Черновик: мастер разрешит выбранное после отправки", action: "Действие", bonus: "Доп. действие", reaction: "Реакция", attacks: "Атаки", spent: "использовано", ready: "доступно", locked: "Мастер обрабатывает ход. OOC остаётся доступен.", attack: "Атака", weapon: "Оружие", enemy: "Цель атаки", target: "Выберите цель", queue: "Добавить", dodge: "Защита: уклонение", ability: "Способности", resource: "Способность", ally: "Цель способности", item: "Расходуемые предметы", choose: "Выберите", queued: "Порядок действий", empty: "Пока ничего не выбрано", remove: "Убрать действие", prose: "Действия и реплики персонажа", hint: "Опишите детали или реплику героя…", send: "Отправить действие", end: "Закончить ход", sending: "Отправка…", unsupported: "Заклинания, особые способности и другие предметы опишите текстом. Их разрешает мастер.", self: "На себя", rejected: "Выбор недоступен: проверьте оставшиеся действия, ресурс и цель.", cost: "Стоимость", unarmed: "Безоружный удар", second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук" },
  en: { title: "Your combat turn", draft: "Draft: the DM resolves your choices after submission", action: "Action", bonus: "Bonus action", reaction: "Reaction", attacks: "Attacks", spent: "spent", ready: "ready", locked: "The DM is resolving your turn. OOC remains available.", attack: "Attack", weapon: "Weapon", enemy: "Attack target", target: "Choose a target", queue: "Queue", dodge: "Defence: Dodge", ability: "Abilities", resource: "Ability", ally: "Ability target", item: "Consumables", choose: "Choose", queued: "Action order", empty: "Nothing selected yet", remove: "Remove action", prose: "Character actions and dialogue", hint: "Describe details or your character's words…", send: "Send Action", end: "End Turn", sending: "Sending…", unsupported: "Describe spells, special abilities and other items in the text. The DM adjudicates them.", self: "Self", rejected: "Unavailable choice: check your remaining actions, resource and target.", cost: "Cost", unarmed: "Unarmed strike", second_wind: "Second Wind", rage: "Rage", bardic_inspiration: "Bardic Inspiration", lay_on_hands: "Lay on Hands" },
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
  const [enemyId, setEnemyId] = useState("");
  const [resource, setResource] = useState("");
  const [item, setItem] = useState("");
  const [spell, setSpell] = useState("");
  const [slotLevel, setSlotLevel] = useState("");
  const [spellTarget, setSpellTarget] = useState("");
  const [targetCharacterId, setTargetCharacterId] = useState(sheet.id);
  const [itemTarget, setItemTarget] = useState(sheet.id);
  const [rejected, setRejected] = useState(false);
  const descriptors = combatChoiceDescriptors(sheet);
  const weapons = descriptors.filter((entry) => entry.type === "weapon");
  const resources = descriptors.filter((entry) => entry.type === "resource");
  const features = descriptors.filter((entry) => entry.type === "feature");
  const items = descriptors.filter((entry) => entry.type === "item");
  const selectedResource = resources.find((entry) => entry.id === resource);
  const selectedFeature = features.find(entry => `feature:${entry.name}` === resource);
  const selectedSpell = spellOptions.find(entry => entry.name === spell);
  const slots = selectedSpell?.level ? combatSpellSlots(sheet, selectedSpell.level) : [];
  const chosenSlot = slots.find(entry => String(entry.level) === slotLevel)?.level ?? slots[0]?.level;
  const spellChoice: CombatChoice = { type: "spell", spell, ...(chosenSlot ? { slotLevel: chosenSlot } : {}), ...(spellTarget ? { targetId: spellTarget } : {}) };
  const enemies = encounter.enemies.filter((enemy) => enemy.status === "alive");
  const allies = sheets.filter((entry) => !entry.deathSaves?.dead);
  const baseBudget = combatIntentBudget(encounter, freshBudget({ ownerId: sheet.id, round: encounter.round, attacksAllowed: 1 + combatRiders(sheet).extraAttacks, extraActions: conditionExtraActions(sheet.conditions) }));
  const intent = (entries = choices): CombatTurnIntent => ({ encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, choices: entries, prose: prose.trim() || undefined });
  const validate = (entries: CombatChoice[]) => validateCombatTurnIntent(intent(entries), sheet, new Set(enemies.map((enemy) => enemy.id)), new Set(allies.map((ally) => ally.id)), baseBudget, { language: locale, names: new Map(), spells: spellOptions });
  const preview = validate(choices);
  const add = (choice: CombatChoice) => {
    const next = [...choices, choice];
    const result = validate(next);
    setRejected(!result.ok);
    if (result.ok) setChoices(next);
  };
  const submit = () => { if (!locked && !sending && preview.ok) onSubmit(intent()); };
  const disabled = locked || sending;
  const meter = preview.ok ? preview.budget : baseBudget;
  const resourceName = (id: string) => copy[id as "second_wind"] ?? id;
  const weaponName = (name: string) => name === "Unarmed strike" ? copy.unarmed : name;
  const selectClass = "mt-1 w-full min-w-0 rounded border border-stone-700 bg-stone-900 p-2 text-sm disabled:opacity-50";
  const queueClass = "mt-2 rounded border border-stone-600 px-3 py-1.5 text-xs text-stone-200 hover:border-amber-500 disabled:opacity-40";
  const actionNames = locale === "ru" ? { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помочь союзнику", grapple: "Захватить", shove: "Сбить с ног" } : { dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help ally", grapple: "Grapple", shove: "Shove prone" };
  const spellLabel = locale === "ru" ? "Заклинание" : "Spell";
  const spellLevelLabel = locale === "ru" ? "ур." : "lv.";
  const adjudication = locale === "ru" ? "Заявка мастеру: применимость, стоимость и эффект определяются правилами особенности; пассивные эффекты не становятся отдельными действиями." : "DM request: the feature's rules determine applicability, cost and effect; passive effects do not become separate actions.";

  return <section className="mb-2 rounded-xl border border-amber-700/60 bg-stone-950/95 p-3 text-sm shadow-elev-1" aria-label={copy.title}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-amber-100">
      <strong className="flex items-center gap-1.5"><Swords className="size-4" /> {sheet.name} · {locale === "ru" ? "Раунд" : "Round"} {encounter.round}</strong>
      <span className="text-xs text-stone-400">{copy.draft}</span>
    </div>
    <p className="mb-2 text-xs text-stone-300">{locale === "ru" ? "Соберите весь план и отправьте один раз. Атака, бонусное действие и команда питомцу — части одного хода. После их разрешения очередь перейдёт дальше." : "Build your whole plan and send it once. Attacks, a bonus action and a pet command are parts of one turn. Initiative advances after resolution."}</p>
    <div className="mb-3 flex flex-wrap gap-1.5 text-xs" aria-live="polite">
      {([[copy.action, meter.actionUsed], [copy.bonus, meter.bonusUsed], [copy.reaction, meter.reactionUsed]] as const).map(([name, spent]) => <span key={name} className={`rounded border px-2 py-1 ${spent ? "border-stone-700 text-stone-500" : "border-amber-800 text-amber-200"}`}>{name}: {spent ? copy.spent : copy.ready}</span>)}
      <span className="rounded bg-stone-800 px-2 py-1">{copy.attacks}: {attacksLeft(meter)} {locale === "ru" ? "осталось" : "remaining"}</span>
    </div>
    {locked ? <p role="status" className="mb-2 rounded bg-amber-950/50 p-2 text-xs text-amber-200">{copy.locked}</p> : null}
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-stone-700 p-2">
        <b>{copy.attack}</b><span className="ml-2 text-xs text-amber-300">{copy.action}</span>
        <select aria-label={copy.weapon} value={weapon} onChange={(e) => setWeapon(e.target.value)} disabled={disabled} className={selectClass}>{weapons.map((entry) => <option key={entry.name} value={entry.name}>{weaponName(entry.name)}</option>)}</select>
        <select aria-label={copy.enemy} value={enemyId} onChange={(e) => setEnemyId(e.target.value)} disabled={disabled} className={selectClass}><option value="">{copy.target}</option>{enemies.map((enemy) => <option key={enemy.id} value={enemy.id}>{enemy.name}</option>)}</select>
        <button type="button" disabled={disabled || !enemyId || !validate([...choices, { type: "attack", targetEnemyId: enemyId, weapon }]).ok} onClick={() => add({ type: "attack", targetEnemyId: enemyId, weapon })} className={queueClass}>{copy.queue}</button>
        <button type="button" disabled={disabled || meter.actionUsed} onClick={() => add({ type: "dodge" })} className={`${queueClass} ml-2`}><Shield className="mr-1 inline size-3" />{copy.dodge}</button>
      </div>
      <div className="min-w-0 rounded-lg border border-sky-900/80 p-2">
        <b className="text-sky-200">{copy.ability}</b>
        {resources.length || features.length ? <>
        <select aria-label={copy.resource} value={resource} onChange={(e) => setResource(e.target.value)} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{resources.map((entry) => <option key={entry.id} value={entry.id}>{resourceName(entry.id)} ({entry.left})</option>)}<optgroup label={locale === "ru" ? "Особенности листа — заявка мастеру" : "Sheet features — DM request"}>{features.map(entry => <option key={entry.name} value={`feature:${entry.name}`}>{entry.name}</option>)}</optgroup></select>
        {selectedResource?.target !== "self" ? <select aria-label={copy.ally} value={targetCharacterId} onChange={(e) => setTargetCharacterId(e.target.value)} disabled={disabled} className={selectClass}>{allies.map((ally) => <option key={ally.id} value={ally.id} disabled={selectedResource?.target === "other" && ally.id === sheet.id}>{ally.name}</option>)}</select> : null}
        <p className="mt-1 text-xs text-stone-400">{selectedFeature ? adjudication : selectedResource ? `${copy.cost}: ${selectedResource.cost === "bonus" ? copy.bonus : copy.action}` : copy.choose}</p>
        {selectedFeature?.description ? <p className="mt-1 text-xs text-stone-300">{selectedFeature.description}</p> : null}
        <button type="button" disabled={disabled || !resource} onClick={() => add(selectedFeature ? { type: "feature", feature: selectedFeature.name, targetId: targetCharacterId } : { type: "resource", resource, targetCharacterId: selectedResource?.target === "self" ? sheet.id : targetCharacterId })} className={queueClass}>{copy.queue}</button>
        </> : <p className="mt-2 text-xs text-stone-400">{locale === "ru" ? "В листе нет способностей с ресурсом или особенностей." : "No resources or features on this sheet."}</p>}
      </div>
      {sheet.spellcasting ? <div className="min-w-0 rounded-lg border border-violet-800/80 p-2 sm:col-span-2">
        <b className="text-violet-200">{locale === "ru" ? "Заклинания и заговоры" : "Spells and cantrips"}</b>
        {spellsLoading ? <p role="status">{locale === "ru" ? "Загрузка заклинаний…" : "Loading spells…"}</p> : spellsError ? <p role="alert">{locale === "ru" ? "Не удалось загрузить заклинания. Обновите страницу." : "Could not load spells. Refresh the page."}</p> : <>
          <select aria-label={spellLabel} value={spell} onChange={event => { setSpell(event.target.value); setSlotLevel(""); }} disabled={disabled} className={selectClass}>
            <option value="">{copy.choose}</option>{spellOptions.map(entry => <option key={entry.name} value={entry.name}>{entry.name} · {entry.level === 0 ? (locale === "ru" ? "заговор" : "cantrip") : entry.level === null ? "?" : `${spellLevelLabel} ${entry.level}`}{entry.level && !combatSpellSlots(sheet, entry.level).length ? (locale === "ru" ? " — нет ячеек" : " — no slots") : ""}</option>)}
          </select>
          {selectedSpell ? <>
            <p className="mt-1 text-xs text-violet-200">{copy.cost}: {selectedSpell.cost === "action" ? copy.action : selectedSpell.cost === "bonus" ? copy.bonus : selectedSpell.cost === "reaction" ? copy.reaction : (locale === "ru" ? "уточняет мастер" : "DM adjudicates")}{selectedSpell.level === 0 ? (locale === "ru" ? " · без ячейки" : " · no slot") : ""}</p>
            {selectedSpell.cost === "reaction" ? <p className="mt-1 text-xs text-stone-400">{locale === "ru" ? "Реакция требует своего условия срабатывания. Сообщите мастеру, когда оно выполнено." : "A reaction requires its trigger. Tell the DM when it occurs."}</p> : null}
            {selectedSpell.level !== null && selectedSpell.level > 0 ? slots.length ? <select aria-label={locale === "ru" ? "Ячейка заклинания" : "Spell slot"} value={chosenSlot ?? ""} onChange={event => setSlotLevel(event.target.value)} disabled={disabled} className={selectClass}>{slots.map(entry => <option key={entry.level} value={entry.level}>{locale === "ru" ? "Уровень" : "Level"} {entry.level} · {entry.left} {locale === "ru" ? "осталось" : "left"}</option>)}</select> : <p className="mt-1 text-xs text-amber-300">{locale === "ru" ? "Нет свободных подходящих ячеек. Заговоры доступны без ячеек." : "No suitable spell slots left. Cantrips need no slots."}</p> : null}
            <select aria-label={locale === "ru" ? "Цель заклинания" : "Spell target"} value={spellTarget} onChange={event => setSpellTarget(event.target.value)} disabled={disabled} className={selectClass}><option value="">{locale === "ru" ? "Цель / область — описать в тексте" : "Target / area — describe in text"}</option>{[...enemies, ...allies].map(target => <option key={target.id} value={target.id}>{target.id === sheet.id ? copy.self : target.name}</option>)}</select>
          </> : null}
          <button type="button" disabled={disabled || !spell || !validate([...choices, spellChoice]).ok} onClick={() => add(spellChoice)} className={queueClass}>{locale === "ru" ? "Добавить заклинание" : "Queue spell"}</button>
        </>}
      </div> : null}
      <div className="min-w-0 rounded-lg border border-emerald-900/80 p-2 sm:col-span-2">
        <b className="text-emerald-200">{copy.item}</b><span className="ml-2 text-xs text-amber-300">{copy.action}</span>
        {items.length ? <>
        <div className="grid gap-1 sm:grid-cols-2">
          <select aria-label={copy.item} value={item} onChange={(e) => setItem(e.target.value)} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{items.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.qty})</option>)}</select>
          <select aria-label={`${copy.item}: ${copy.target}`} value={itemTarget} onChange={(e) => setItemTarget(e.target.value)} disabled={disabled} className={selectClass}>{allies.map((ally) => <option key={ally.id} value={ally.id}>{ally.id === sheet.id ? copy.self : ally.name}</option>)}</select>
        </div>
        <button type="button" disabled={disabled || !item || meter.actionUsed} onClick={() => add({ type: "item", item, targetCharacterId: itemTarget })} className={queueClass}>{copy.queue}</button>
        </> : <p className="mt-2 text-xs text-stone-400">{locale === "ru" ? "В инвентаре нет распознанных расходников. Использование другого предмета опишите ниже." : "No recognized consumables in your inventory. Describe another item's use below."}</p>}
      </div>
    </div>
    <details className="mt-2 rounded border border-stone-700 p-2">
      <summary className="cursor-pointer text-amber-100">{locale === "ru" ? "Манёвры" : "Maneuvers"}</summary>
      <div className="flex flex-wrap gap-2">{(Object.keys(actionNames) as Array<keyof typeof actionNames>).map(action => {
        const choice: CombatChoice = { type: "action", action, ...(action === "help" ? { targetCharacterId } : action === "grapple" || action === "shove" ? { targetEnemyId: enemyId } : {}) };
        return <button key={action} type="button" className={queueClass} disabled={disabled || !validate([...choices, choice]).ok} onClick={() => add(choice)}>{actionNames[action]}</button>;
      })}</div>
    </details>
    <div className="mt-2 rounded bg-stone-900/80 p-2 text-xs"><b>{copy.queued}:</b>
      <ol className="mt-1 space-y-1">{choices.map((choice, index) => <li key={index} className="flex items-center justify-between gap-2 rounded bg-stone-800 p-1.5"><span>{index + 1}. {choice.type === "attack" ? `${copy.attack}: ${weaponName(choice.weapon)} → ${enemies.find(enemy => enemy.id === choice.targetEnemyId)?.name ?? copy.target}` : choice.type === "pet_order" ? `${choice.petName}: ${choice.order}` : choice.type === "spell" ? `${spellLabel}: ${choice.spell}${choice.slotLevel ? ` (${choice.slotLevel})` : ""}${choice.targetId ? ` → ${[...enemies, ...allies].find(target => target.id === choice.targetId)?.name ?? copy.target}` : ""}` : choice.type === "feature" ? choice.feature : choice.type === "pet" ? `${choice.petName}: ${choice.attack}` : choice.type === "action" ? actionNames[choice.action] : choice.type === "item" ? choice.item : choice.type === "resource" ? resourceName(choice.resource) : copy.dodge}</span><button type="button" aria-label={`${copy.remove} ${index + 1}`} disabled={disabled} onClick={() => { setChoices((current) => current.filter((_, i) => i !== index)); setRejected(false); }} className="rounded p-1.5 hover:bg-stone-700"><X className="size-4" /></button></li>)}</ol>
      {!choices.length ? <span className="ml-2 text-stone-500">{copy.empty}</span> : null}
    </div>
    {rejected || !preview.ok ? <p role="alert" className="mt-1 text-xs text-red-300">{copy.rejected}</p> : null}
    <p className="mt-2 text-xs text-stone-500">{locale === "ru" ? "Выбор — заявка, а не выполненное действие. Детали, область заклинания и условия способностей опишите ниже; мастер разрешит их по правилам." : "Choices are requests, not resolved actions. Describe details, spell areas and feature conditions below; the DM adjudicates them under the rules."}</p>
    <textarea aria-label={copy.prose} maxLength={1200} value={prose} onChange={(e) => setProse(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} disabled={disabled} rows={2} placeholder={copy.hint} className="mt-2 w-full rounded border border-stone-700 bg-stone-900 p-2 text-sm" />
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !preview.ok || (!choices.length && !prose.trim())} onClick={submit} className="rounded bg-amber-400 px-3 py-2 font-medium text-amber-950 disabled:opacity-40">{sending ? copy.sending : copy.send}</button>
      {!choices.length && !prose.trim() ? <button type="button" disabled={disabled} onClick={() => onSubmit(intent([]))} className={queueClass}>{copy.end}</button> : null}
    </div>
  </section>;
}
