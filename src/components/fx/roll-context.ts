// Turns a raw roll (server `kind` + free-form English `detail`) into
// "who throws, what for, at whom, against what" for the dice overlay.
//
// The server writes details such as "Gimli: Battleaxe vs Goblin Archer",
// "Gimli: DEX save vs Fireball", "stealth" or "death save". Nothing here is
// authoritative; it only decides how the roll is introduced on screen.

import type { DicePaletteId } from "@/lib/fx/dice/atlas";

export type RollIcon = "attack" | "damage" | "skill" | "save" | "ability" | "initiative" | "death" | "custom";

export type RollActor = {
  name: string;
  kind: "me" | "ally" | "enemy" | "dm";
  portraitUrl?: string;
  subtitle?: string;
};

export type RollTarget = {
  name: string;
  kind: "enemy" | "ally" | "effect";
  /** Enemy health band when the campaign shows it ("bloodied", ...). */
  health?: string;
  hpPercent?: number;
  /** Armour class, only when this seat may see it (the DM's view). */
  ac?: number;
};

export type RollContext = {
  actor: RollActor;
  icon: RollIcon;
  /** Short action label: weapon, skill, ability, spell. */
  action: string;
  target: RollTarget | null;
  /** What the roll must beat: a DC, the target's AC (null while hidden), or nothing. */
  stakes: { kind: "dc"; value: number } | { kind: "ac"; value: number | null } | { kind: "none" };
  requestedBy: "dm" | "player";
  reason: string | null;
  /** Where the dice come from: your hand, another seat, or the DM's side. */
  throwFrom: "bottom" | "left" | "top";
  palette: DicePaletteId;
};

export type RollContextInput = {
  kind: string;
  detail: string;
  dc: number | null;
  characterId: string | null;
  requestedBy?: "dm" | "player";
  targetEnemyId?: string | null;
  reason?: string | null;
};

export type ContextSheet = {
  id: string;
  name: string;
  userId?: string;
  class?: string;
  level?: number;
  portrait?: { url: string } | null;
};

export type ContextEnemy = { id: string; name: string; health?: string; hpPercent?: number; ac?: number; hidden?: boolean };

export type ContextLocale = {
  skill: (id: string) => string | undefined;
  ability: (id: string) => string | undefined;
  dm: string;
  unknownHero: string;
};

const ALLY_PALETTES: DicePaletteId[] = ["frost", "verdant", "crimson", "bone", "gilded"];

/** A stable colour per character so the table learns whose dice are whose. */
export function paletteForCharacter(id: string): DicePaletteId {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ALLY_PALETTES[Math.abs(h) % ALLY_PALETTES.length];
}

function camel(id: string): string {
  return id.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"];

export function describeRoll(
  input: RollContextInput,
  env: { sheets: ContextSheet[]; enemies: ContextEnemy[]; meUserId: string; mySkin: DicePaletteId; locale: ContextLocale },
): RollContext {
  const { locale } = env;
  const detail = (input.detail || "").trim();
  const colon = detail.indexOf(": ");
  const prefix = colon > 0 ? detail.slice(0, colon).trim() : "";
  let rest = colon > 0 ? detail.slice(colon + 2).trim() : detail;

  // --- who ---
  const sheet = input.characterId ? env.sheets.find((s) => s.id === input.characterId) : undefined;
  const enemyByPrefix = prefix ? env.enemies.find((e) => e.name.toLowerCase() === prefix.toLowerCase()) : undefined;
  let actor: RollActor;
  let palette: DicePaletteId;
  let throwFrom: RollContext["throwFrom"];
  if (sheet) {
    const mine = !!env.meUserId && sheet.userId === env.meUserId;
    actor = {
      name: sheet.name,
      kind: mine ? "me" : "ally",
      portraitUrl: sheet.portrait?.url,
      subtitle: [sheet.class, sheet.level ? String(sheet.level) : ""].filter(Boolean).join(" "),
    };
    palette = mine ? env.mySkin : paletteForCharacter(sheet.id);
    throwFrom = mine ? "bottom" : "left";
  } else if (enemyByPrefix || (prefix && !input.characterId)) {
    actor = { name: enemyByPrefix?.name ?? prefix, kind: "enemy" };
    palette = "cursed";
    throwFrom = "top";
  } else {
    actor = { name: input.requestedBy === "player" ? locale.unknownHero : locale.dm, kind: "dm" };
    palette = "cursed";
    throwFrom = "top";
  }

  // --- what, and at whom ---
  let icon: RollIcon = "custom";
  let action = rest;
  let target: RollTarget | null = null;
  const kind = input.kind;
  const lower = rest.toLowerCase();

  if (lower === "death save") {
    icon = "death";
    action = "";
  } else if (kind === "initiative" || lower === "initiative") {
    icon = "initiative";
    action = "";
  } else if (kind === "attack") {
    icon = "attack";
    const vs = rest.split(/\s+vs\.?\s+/i);
    action = vs[0];
    if (vs[1]) target = { name: vs[1], kind: sheet ? "enemy" : "ally" };
  } else if (kind === "damage") {
    icon = "damage";
    action = rest.replace(/\s+damage$/i, "");
  } else if (kind === "saving_throw") {
    icon = "save";
    const m = /^([A-Za-z]{3})\s+save(?:\s+vs\.?\s+(.+)|\s+to\s+(.+))?$/i.exec(rest);
    if (m) {
      action = locale.ability(m[1].toLowerCase()) ?? m[1].toUpperCase();
      const against = m[2] ?? m[3];
      if (against) target = { name: against, kind: "effect" };
    }
  } else if (kind === "skill_check") {
    icon = "skill";
    action = locale.skill(camel(lower)) ?? rest.replaceAll("_", " ");
    rest = action;
  } else if (kind === "ability_check") {
    icon = "ability";
    action = ABILITY_IDS.includes(lower) ? locale.ability(lower) ?? rest.toUpperCase() : rest;
  }

  if (input.targetEnemyId) {
    const enemy = env.enemies.find((e) => e.id === input.targetEnemyId);
    if (enemy) target = { name: enemy.name, kind: "enemy", health: enemy.health, hpPercent: enemy.hpPercent, ac: enemy.ac };
  } else if (target?.kind === "enemy") {
    const enemy = env.enemies.find((e) => e.name.toLowerCase() === target!.name.toLowerCase());
    if (enemy) target = { ...target, health: enemy.health, hpPercent: enemy.hpPercent, ac: enemy.ac };
  }

  const stakes: RollContext["stakes"] =
    input.dc !== null && input.dc !== undefined
      ? { kind: "dc", value: input.dc }
      : icon === "attack"
        ? { kind: "ac", value: target?.ac ?? null }
        : { kind: "none" };

  return {
    actor,
    icon,
    action,
    target,
    stakes,
    requestedBy: input.requestedBy ?? "dm",
    reason: input.reason?.trim() ? input.reason.trim() : null,
    throwFrom,
    palette,
  };
}
