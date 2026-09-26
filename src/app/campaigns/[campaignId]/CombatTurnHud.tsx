"use client";

import { useState } from "react";
import { Shield, Swords, X } from "lucide-react";
import { combatChoiceDescriptors, combatIntentBudget, validateCombatTurnIntent, type CombatChoice, type CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
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
  const [targetCharacterId, setTargetCharacterId] = useState(sheet.id);
  const [itemTarget, setItemTarget] = useState(sheet.id);
  const [rejected, setRejected] = useState(false);
  const descriptors = combatChoiceDescriptors(sheet);
  const weapons = descriptors.filter((entry) => entry.type === "weapon");
  const resources = descriptors.filter((entry) => entry.type === "resource");
  const items = descriptors.filter((entry) => entry.type === "item");
  const selectedResource = resources.find((entry) => entry.id === resource);
  const enemies = encounter.enemies.filter((enemy) => enemy.status === "alive");
  const allies = sheets.filter((entry) => !entry.deathSaves?.dead);
  const baseBudget = combatIntentBudget(encounter, freshBudget({ ownerId: sheet.id, round: encounter.round, attacksAllowed: 1 + combatRiders(sheet).extraAttacks, extraActions: conditionExtraActions(sheet.conditions) }));
  const intent = (entries = choices): CombatTurnIntent => ({ encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, choices: entries, prose: prose.trim() || undefined });
  const validate = (entries: CombatChoice[]) => validateCombatTurnIntent(intent(entries), sheet, new Set(enemies.map((enemy) => enemy.id)), new Set(allies.map((ally) => ally.id)), baseBudget);
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
        <select aria-label={copy.resource} value={resource} onChange={(e) => setResource(e.target.value)} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{resources.map((entry) => <option key={entry.id} value={entry.id}>{resourceName(entry.id)} ({entry.left})</option>)}</select>
        {selectedResource?.target !== "self" ? <select aria-label={copy.ally} value={targetCharacterId} onChange={(e) => setTargetCharacterId(e.target.value)} disabled={disabled} className={selectClass}>{allies.map((ally) => <option key={ally.id} value={ally.id} disabled={selectedResource?.target === "other" && ally.id === sheet.id}>{ally.name}</option>)}</select> : null}
        <p className="mt-1 text-xs text-stone-400">{selectedResource ? `${copy.cost}: ${selectedResource.cost === "bonus" ? copy.bonus : copy.action}` : copy.choose}</p>
        <button type="button" disabled={disabled || !resource} onClick={() => add({ type: "resource", resource, targetCharacterId: selectedResource?.target === "self" ? sheet.id : targetCharacterId })} className={queueClass}>{copy.queue}</button>
      </div>
      <div className="min-w-0 rounded-lg border border-emerald-900/80 p-2 sm:col-span-2">
        <b className="text-emerald-200">{copy.item}</b><span className="ml-2 text-xs text-amber-300">{copy.action}</span>
        <div className="grid gap-1 sm:grid-cols-2">
          <select aria-label={copy.item} value={item} onChange={(e) => setItem(e.target.value)} disabled={disabled} className={selectClass}><option value="">{copy.choose}</option>{items.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.qty})</option>)}</select>
          <select aria-label={`${copy.item}: ${copy.target}`} value={itemTarget} onChange={(e) => setItemTarget(e.target.value)} disabled={disabled} className={selectClass}>{allies.map((ally) => <option key={ally.id} value={ally.id}>{ally.id === sheet.id ? copy.self : ally.name}</option>)}</select>
        </div>
        <button type="button" disabled={disabled || !item || meter.actionUsed} onClick={() => add({ type: "item", item, targetCharacterId: itemTarget })} className={queueClass}>{copy.queue}</button>
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
      <ol className="mt-1 space-y-1">{choices.map((choice, index) => <li key={index} className="flex items-center justify-between gap-2 rounded bg-stone-800 p-1.5"><span>{index + 1}. {choice.type === "attack" ? `${copy.attack}: ${weaponName(choice.weapon)} → ${enemies.find(enemy => enemy.id === choice.targetEnemyId)?.name ?? copy.target}` : choice.type === "pet" ? `${choice.petName}: ${choice.attack}` : choice.type === "action" ? actionNames[choice.action] : choice.type === "item" ? choice.item : choice.type === "resource" ? resourceName(choice.resource) : copy.dodge}</span><button type="button" aria-label={`${copy.remove} ${index + 1}`} disabled={disabled} onClick={() => { setChoices((current) => current.filter((_, i) => i !== index)); setRejected(false); }} className="rounded p-1.5 hover:bg-stone-700"><X className="size-4" /></button></li>)}</ol>
      {!choices.length ? <span className="ml-2 text-stone-500">{copy.empty}</span> : null}
    </div>
    {rejected || !preview.ok ? <p role="alert" className="mt-1 text-xs text-red-300">{copy.rejected}</p> : null}
    <p className="mt-2 text-xs text-stone-500">{copy.unsupported}</p>
    <textarea aria-label={copy.prose} maxLength={1200} value={prose} onChange={(e) => setProse(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} disabled={disabled} rows={2} placeholder={copy.hint} className="mt-2 w-full rounded border border-stone-700 bg-stone-900 p-2 text-sm" />
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !preview.ok || (!choices.length && !prose.trim())} onClick={submit} className="rounded bg-amber-400 px-3 py-2 font-medium text-amber-950 disabled:opacity-40">{sending ? copy.sending : copy.send}</button>
      {!choices.length && !prose.trim() ? <button type="button" disabled={disabled} onClick={() => onSubmit(intent([]))} className={queueClass}>{copy.end}</button> : null}
    </div>
  </section>;
}
