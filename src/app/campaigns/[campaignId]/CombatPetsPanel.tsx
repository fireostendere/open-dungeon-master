"use client";

import { useState } from "react";
import { PawPrint } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { freshBudget } from "@/lib/dm/action-budget";
import { combatIntentBudget, validateCombatTurnIntent, type CombatChoice, type CombatSpellDescriptor } from "@/lib/dm/combat-turn-intent";
import { petCommandCost } from "@/lib/dm/pet-combat";
import { combatRiders } from "@/lib/srd/feature-effects";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const COPY = {
  ru: { title: "Питомцы в бою", empty: "У участников боя пока нет питомцев в листах.", owner: "Хозяин", ac: "КД", speed: "Скорость", target: "Цель питомца", choose: "Выберите цель", command: "Приказать", cost: "Стоимость команды", action: "Действие хозяина", bonus: "Бонусное действие хозяина", attack: "Вместо одной атаки хозяина", unknown: "Стоимость задаётся правилом питомца", down: "Без сознания", noAttack: "Не атакует", waiting: "Ждёт хода хозяина", ready: "Готов к команде", queued: "Команда в плане хода", spent: "Команда уже выполнена", blocked: "Сейчас нет доступного действия", hint: "Команда добавляется в общий план. Отправьте её вместе с остальными действиями персонажа.", details: "Особенности", attackLabel: "Атаки" },
  en: { title: "Pets in combat", empty: "Combat participants have no pets on their sheets yet.", owner: "Owner", ac: "AC", speed: "Speed", target: "Pet target", choose: "Choose a target", command: "Command", cost: "Command cost", action: "Owner's action", bonus: "Owner's bonus action", attack: "Replaces one owner's attack", unknown: "Cost requires the pet's rule", down: "Unconscious", noAttack: "Cannot attack", waiting: "Waiting for owner", ready: "Ready for a command", queued: "Command queued", spent: "Command already resolved", blocked: "No action available now", hint: "The command joins your turn plan. Submit it with your character's other actions.", details: "Traits", attackLabel: "Attacks" },
};

export function CombatPetsPanel({ encounter, sheets, mySheet, canCommand, choices = [], onChoicesChange, spellOptions = [], embedded = false }: {
  encounter: PublicEncounter;
  sheets: CharacterSheet[];
  mySheet: CharacterSheet | null;
  canCommand: boolean;
  choices?: CombatChoice[];
  onChoicesChange?: (choices: CombatChoice[]) => void;
  spellOptions?: CombatSpellDescriptor[];
  embedded?: boolean;
}) {
  const { locale, formatSpeed } = useI18n();
  const copy = COPY[locale];
  const orderLabel = locale === "ru" ? "Прямой приказ" : "Direct order";
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, string>>({});
  const participants = new Set(encounter.order.filter(entry => entry.kind === "pc").map(entry => entry.id));
  const owners = sheets.filter(sheet => sheet.pets?.length && (!encounter.orderReady || participants.has(sheet.id)));
  const enemies = encounter.enemies.filter(enemy => enemy.status === "alive");
  const budget = mySheet ? combatIntentBudget(encounter, freshBudget({ ownerId: mySheet.id, round: encounter.round,
    attacksAllowed: 1 + combatRiders(mySheet).extraAttacks, extraActions: conditionExtraActions(mySheet.conditions) })) : null;
  const validate = (next: CombatChoice[]) => mySheet && budget && validateCombatTurnIntent({
    encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, choices: next,
  }, mySheet, new Set(enemies.map(enemy => enemy.id)), new Set(sheets.filter(sheet => !sheet.deathSaves?.dead).map(sheet => sheet.id)), budget, { language: locale, names: new Map(), spells: spellOptions }).ok;
  const canQueue = (owner: CharacterSheet, choice: CombatChoice) => canCommand && !!onChoicesChange &&
    owner.id === mySheet?.id && owner.currentHp > 0 && validate([...choices, choice]);

  const panel = <section aria-label={copy.title} className="rounded-lg border border-violet-700/60 bg-stone-950/90 p-3 shadow-elev-1">
    {embedded ? <h3 className="mb-3 flex items-center gap-2 font-semibold text-violet-200"><PawPrint className="size-5" aria-hidden="true" />{copy.title}</h3> : null}
    {!owners.length ? <p className="text-sm text-stone-400">{copy.empty}</p> : null}
    <div className="space-y-3">{owners.flatMap(owner => owner.pets.map(pet => {
      const key = `${owner.id}:${pet.name}`;
      const owned = owner.id === mySheet?.id;
      const targetId = targets[key] ?? "";
      const target = enemies.find(enemy => enemy.id === targetId);
      const queued = owned && choices.some(choice => (choice.type === "pet" || choice.type === "pet_order") && choice.petName === pet.name);
      const order: CombatChoice = { type: "pet_order", petName: pet.name, order: orders[key] ?? "" };
      const spent = owned && budget?.oncePerTurn.includes(`pet:${pet.name.toLowerCase()}`);
      const cost = petCommandCost(pet);
      const costLabel = cost ? copy[cost] : copy.unknown;
      const eligible = pet.attacks.some(attack => enemies.some(enemy => canQueue(owner, { type: "pet", petName: pet.name, attack: attack.name, targetEnemyId: enemy.id })));
      const status = pet.hp <= 0 ? copy.down : queued ? copy.queued : spent ? copy.spent : !pet.attacks.length ? copy.noAttack :
        !owned || !canCommand ? copy.waiting : eligible ? copy.ready : copy.blocked;
      return <article key={key} aria-label={`${pet.name} — ${owner.name}`} className="rounded-lg border border-stone-700 bg-stone-900/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h4 className="font-semibold text-stone-100">{pet.name} <span className="text-xs font-normal text-stone-400">· {pet.form}</span></h4><p className="text-xs text-stone-400">{copy.owner}: {owner.name}</p></div>
          <span className={`rounded px-2 py-1 text-xs ${pet.hp <= 0 ? "bg-red-950 text-red-300" : "bg-violet-950/60 text-violet-200"}`}>{status}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-300"><span>{pet.hp}/{pet.maxHp} HP</span><span>{copy.ac} {pet.ac}</span><span>{copy.speed}: {formatSpeed(pet.speed)}</span></div>
        <progress aria-label={`${pet.name}: HP`} value={Math.max(0, pet.hp)} max={pet.maxHp} className="mt-2 h-2 w-full accent-violet-400" />
        <p className="mt-1 text-xs text-stone-400">{copy.cost}: {costLabel}</p>
        {pet.attacks.length ? <div className="mt-2 space-y-2">
          {owned ? <label className="block text-xs text-stone-300">{copy.target}: {pet.name}
            <select aria-label={`${copy.target}: ${pet.name}`} value={target?.id ?? ""} disabled={!canCommand || pet.hp <= 0 || !onChoicesChange || queued || !!spent} onChange={event => setTargets(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded border border-stone-700 bg-stone-950 p-2 text-sm disabled:opacity-50">
              <option value="">{copy.choose}</option>{enemies.map(enemy => <option key={enemy.id} value={enemy.id}>{enemy.name}</option>)}
            </select>
          </label> : null}
          <div className="flex flex-wrap gap-2">{pet.attacks.map(attack => {
            const choice: CombatChoice = { type: "pet", petName: pet.name, attack: attack.name, targetEnemyId: targetId };
            const label = `${attack.name} · ${attack.toHit >= 0 ? "+" : ""}${attack.toHit} · ${attack.damage}`;
            return owned ? <button key={attack.name} type="button" aria-label={`${copy.command} ${pet.name}: ${attack.name}`} disabled={!target || !canQueue(owner, choice)} onClick={() => { if (target && canQueue(owner, choice)) onChoicesChange?.([...choices, choice]); }} className="rounded border border-violet-700 px-3 py-2 text-xs text-violet-100 hover:bg-violet-950/50 disabled:cursor-not-allowed disabled:opacity-40">{copy.command}: {label}{target ? ` → ${target.name}` : ""}</button>
              : <span key={attack.name} className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-300">{label}</span>;
          })}</div>
        </div> : null}
        {owned ? <div className="mt-3 border-t border-stone-700 pt-2">
          <label className="block text-xs text-violet-200">{orderLabel}: {pet.name}
            <textarea aria-label={`${orderLabel}: ${pet.name}`} value={orders[key] ?? ""} maxLength={500} rows={2} disabled={!canCommand || pet.hp <= 0 || queued || !!spent} onChange={event => setOrders(current => ({ ...current, [key]: event.target.value }))} placeholder={locale === "ru" ? "Например: стань невидимым и разведай проход…" : "For example: turn invisible and scout the passage…"} className="mt-1 w-full rounded border border-stone-700 bg-stone-950 p-2 text-sm disabled:opacity-50" />
          </label>
          <p className="mt-1 text-xs text-stone-400">{locale === "ru" ? "Заявка мастеру: допустимость, стоимость и результат приказа определяются правилами питомца." : "Request for the DM: the pet's rules determine legality, cost and outcome."}</p>
          <button type="button" disabled={!!spent || !canQueue(owner, order)} onClick={() => { if (!spent && canQueue(owner, order)) onChoicesChange?.([...choices, order]); }} className="mt-2 rounded border border-violet-700 px-3 py-2 text-xs text-violet-100 disabled:opacity-40">{locale === "ru" ? "Добавить приказ" : "Queue order"}: {pet.name}</button>
        </div> : null}
        {pet.notes ? <details className="mt-2 text-xs text-stone-400"><summary className="cursor-pointer">{copy.details}</summary><p className="mt-1 whitespace-pre-wrap">{pet.notes}</p></details> : null}
      </article>;
    }))}</div>
    {owners.some(owner => owner.id === mySheet?.id) ? <p className="mt-3 text-xs text-stone-400">{copy.hint}</p> : null}
  </section>;
  return embedded ? panel : <details className="rounded-xl border border-violet-700/60 bg-stone-950/90 p-3 shadow-elev-1">
    <summary className="flex cursor-pointer items-center gap-2 font-semibold text-violet-200"><PawPrint className="size-5" aria-hidden="true" />{copy.title}</summary>
    <div className="mt-3 border-t border-stone-700 pt-3">{panel}</div>
  </details>;
}
