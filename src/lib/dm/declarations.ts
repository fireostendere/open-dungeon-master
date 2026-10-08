// Out-of-combat picks from the spell book panel in the Composer: the exact
// spell (with its slot, or as a ritual), class ability or consumable a player
// chose and who it is for. The client builds them, the server checks them
// against the sheet (POST /api/campaigns/[id]/actions) and renders the
// canonical lines the narrator resolves with engine actions (cast_buff,
// heal, use_spell_slot, use_resource, use_item). Client-safe: no database.
import { combatSpellSlots, consumableName, type CombatIntentSheet } from "./combat-turn-intent.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { RESOURCE_DEFS } from "../srd/class-resources.ts";

export type Declaration =
  | { type: "spell"; spell: string; slotLevel?: number; ritual?: boolean; targetIds: string[] }
  | { type: "resource"; resource: string; targetIds: string[] }
  | { type: "item"; item: string; targetIds: string[] };

// One castable spell as the panel shows it, derived on the server from the
// content pack so the client never states a level or a ritual tag itself.
export type SpellCard = {
  name: string;
  level: number;
  castingTime: string;
  ritual: boolean;
  concentration: boolean;
  // Who it lands on: the caster, party members the player picks, or
  // something the player describes in words (enemies, an area, an object).
  target: "self" | "party" | "other";
  // A spellbook spell the wizard has not prepared: castable only as a ritual.
  ritualOnly?: boolean;
};

export const MAX_DECLARATIONS = 6;
const MAX_TARGETS = 6;

const RESOURCE_NAMES: { ru: Record<string, string> } = {
  ru: {
    rage: "Ярость", ki: "Ци", sorcery_points: "Единицы чародейства", second_wind: "Второе дыхание",
    action_surge: "Всплеск действий", channel_divinity: "Божественный канал", bardic_inspiration: "Бардовское вдохновение",
    wild_shape: "Дикий облик", lay_on_hands: "Наложение рук", divine_sense: "Божественное чувство",
    arcane_recovery: "Магическое восстановление", natural_recovery: "Естественное восстановление",
    breath_weapon: "Оружие дыхания", luck_points: "Очки удачи",
  },
};

export function resourceLabel(id: string, language: "ru" | "en"): string {
  const english = RESOURCE_DEFS.find((def) => def.id === id)?.displayName ?? id.replace(/_/g, " ");
  return (language === "ru" && Object.hasOwn(RESOURCE_NAMES.ru, id) ? RESOURCE_NAMES.ru[id] : null) ?? english;
}

// Who a class ability goes to: only its owner, exactly one chosen hero
// ("other" never the owner), or optionally someone.
export function resourceTarget(id: string): "self" | "ally" | "other" | "optional" {
  const action = Object.hasOwn(RESOURCE_ACTIONS, id) ? RESOURCE_ACTIONS[id] : undefined;
  return action?.target ?? "optional";
}

// Abilities a player can spend by choice outside combat: passive ones like
// Relentless Endurance trigger by themselves, and Action Surge only exists
// on a combat turn.
export function usableResources(sheet: Pick<CombatIntentSheet, "resources">): Array<{ id: string; left: number }> {
  return Object.entries(sheet.resources).flatMap(([id, state]) => {
    const def = RESOURCE_DEFS.find((entry) => entry.id === id);
    return def && !def.passive && id !== "action_surge" && state.used < state.max ? [{ id, left: state.max - state.used }] : [];
  });
}

export function usableItems(sheet: Pick<CombatIntentSheet, "equipment">): Array<{ name: string; qty: number }> {
  return sheet.equipment.filter((item) => item.qty > 0 && consumableName.test(item.name)).map(({ name, qty }) => ({ name, qty }));
}

type Context = {
  sheet: CombatIntentSheet;
  library: SpellCard[];
  // Living heroes at the caster's place, the caster included: id -> name.
  party: ReadonlyMap<string, string>;
  language: "ru" | "en";
  localize?: (kind: "item" | "spell", name: string) => string;
};

// The short chip label the panel and the preview show.
export function declarationLabel(declaration: Declaration, context: Pick<Context, "party" | "language" | "localize">): string {
  const ru = context.language === "ru";
  const localize = context.localize ?? ((_kind: "item" | "spell", name: string) => name);
  const targets = declaration.targetIds.length ? ` → ${declaration.targetIds.map((id) => context.party.get(id) ?? "?").join(", ")}` : "";
  if (declaration.type === "spell") {
    const slot = declaration.ritual ? (ru ? " · ритуал" : " · ritual") : declaration.slotLevel ? ` · ${declaration.slotLevel} ${ru ? "круг" : "lvl"}` : "";
    return `${localize("spell", declaration.spell)}${slot}${targets}`;
  }
  if (declaration.type === "resource") return `${resourceLabel(declaration.resource, context.language)}${targets}`;
  return `${localize("item", declaration.item)}${targets}`;
}

// Checks every pick against the sheet (slots, uses and items are counted
// across the whole list) and renders the block the narrator reads.
export function validateDeclarations(declarations: Declaration[], context: Context): { ok: true; content: string } | { ok: false; error: string } {
  const { sheet, library, party } = context;
  const ru = context.language === "ru";
  const localize = context.localize ?? ((_kind: "item" | "spell", name: string) => name);
  // The exact engine name always reaches the narrator; Russian tables also
  // get the name their players read.
  const named = (kind: "item" | "spell", name: string) => {
    const shown = ru ? localize(kind, name) : name;
    return shown === name ? name : `${shown} [${name}]`;
  };
  const who = (ids: string[]) => ids.map((id) => party.get(id)).join(", ");
  if (!declarations.length || declarations.length > MAX_DECLARATIONS) return { ok: false, error: `Pick 1–${MAX_DECLARATIONS} spells, abilities or items.` };
  const usedSlots = new Map<number, number>();
  const usedResources = new Map<string, number>();
  const usedItems = new Map<string, number>();
  const lines: string[] = [];
  for (const declaration of declarations) {
    const targets = declaration.targetIds;
    if (new Set(targets).size !== targets.length || targets.length > MAX_TARGETS || targets.some((id) => !party.has(id))) {
      return { ok: false, error: "Choose party members who are here with you." };
    }
    if (declaration.type === "spell") {
      const card = library.find((entry) => entry.name === declaration.spell);
      if (!card) return { ok: false, error: "Choose a spell from your character sheet." };
      let casting: string;
      if (card.level === 0) {
        if (declaration.slotLevel !== undefined || declaration.ritual) return { ok: false, error: "A cantrip takes no slot." };
        casting = ru ? " (заговор)" : " (cantrip)";
      } else if (declaration.ritual) {
        if (!card.ritual || declaration.slotLevel !== undefined) return { ok: false, error: "Only a ritual spell can be cast as a ritual, and it takes no slot." };
        casting = ru ? ", ритуалом: без ячейки, на 10 минут дольше" : ", as a ritual: no slot, 10 minutes longer";
      } else {
        if (card.ritualOnly) return { ok: false, error: "An unprepared spellbook spell can only be cast as a ritual." };
        const slot = combatSpellSlots(sheet, card.level).find((entry) => entry.level === declaration.slotLevel);
        if (!slot || slot.left <= (usedSlots.get(slot.level) ?? 0)) return { ok: false, error: "Choose an available spell slot." };
        usedSlots.set(slot.level, (usedSlots.get(slot.level) ?? 0) + 1);
        casting = ru ? `, ячейка ${slot.level} круга` : `, level ${slot.level} slot`;
      }
      if (card.target === "self" && (targets.length > 1 || (targets.length === 1 && targets[0] !== sheet.id))) {
        return { ok: false, error: "This spell affects only its caster." };
      }
      if (card.target === "party" && !targets.length) return { ok: false, error: "Choose who the spell is for." };
      if (card.target === "other" && targets.length) return { ok: false, error: "Describe this spell's target in your message." };
      const aim = card.target === "self"
        ? (ru ? "на себя" : "on themselves")
        : card.target === "party"
          ? `${ru ? "цели" : "targets"}: ${who(targets)}`
          : ru ? "цель — в тексте заявки" : "target described in the request";
      lines.push(`${ru ? "Заклинание" : "Spell"}: ${named("spell", card.name)}${casting}; ${aim}`);
    } else if (declaration.type === "resource") {
      const left = usableResources(sheet).find((entry) => entry.id === declaration.resource)?.left ?? 0;
      if (left <= (usedResources.get(declaration.resource) ?? 0)) return { ok: false, error: "Choose an ability with uses left." };
      usedResources.set(declaration.resource, (usedResources.get(declaration.resource) ?? 0) + 1);
      const aim = resourceTarget(declaration.resource);
      if ((aim === "self" && targets.some((id) => id !== sheet.id)) || targets.length > 1 ||
        ((aim === "ally" || aim === "other") && targets.length !== 1) || (aim === "other" && targets[0] === sheet.id)) {
        return { ok: false, error: "Choose who the ability is for." };
      }
      const english = resourceLabel(declaration.resource, "en");
      const shown = resourceLabel(declaration.resource, context.language);
      lines.push(`${ru ? "Способность" : "Ability"}: ${shown === english ? english : `${shown} [${english}]`}${targets.length && targets[0] !== sheet.id ? `; ${ru ? "цель" : "target"}: ${who(targets)}` : ""}`);
    } else {
      const qty = usableItems(sheet).find((entry) => entry.name === declaration.item)?.qty ?? 0;
      if (qty <= (usedItems.get(declaration.item) ?? 0)) return { ok: false, error: "Choose a consumable you still carry." };
      usedItems.set(declaration.item, (usedItems.get(declaration.item) ?? 0) + 1);
      if (targets.length > 1) return { ok: false, error: "An item goes to one hero." };
      lines.push(`${ru ? "Предмет" : "Item"}: ${named("item", declaration.item)}; ${ru ? "цель" : "target"}: ${targets.length && targets[0] !== sheet.id ? who(targets) : ru ? "на себя" : "themselves"}`);
    }
  }
  const header = ru ? "Выбрано в книге заклинаний и умений (точные названия для движка):" : "Picked from the spell and ability book (exact engine names):";
  return { ok: true, content: `${header}\n${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}` };
}
