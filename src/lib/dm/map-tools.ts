import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import {
  createBattleMap,
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
  placeTokens,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { generateBattleMap, fnv1a } from "@/lib/battlemap/generate";
import { findPath, speedToTiles, walkPathWithBudget } from "@/lib/battlemap/movement";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { bestFiringPosition } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { chebyshev, tileIndex, type BattleToken } from "@/lib/battlemap/types";
import { nearestOpenTile } from "@/lib/battlemap/paint";
import { getCurrentLocation, getLocation } from "@/lib/db/locations";
import { publishEphemeral } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import { isJrpgCombat } from "@/lib/dm/combat-mode";
import { formatDistanceFeet } from "@/lib/units/narration";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { z } from "zod";

// Battle-map lifecycle and the move_token DM tool. Kept separate from
// encounter-tools.ts to hold both files under the size limit; this module
// must not import encounter-tools (the import points the other way).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// Contentless ping: with per-character fog even token coordinates are
// secret, so clients re-fetch their own filtered projection.
export function publishBattleMapUpdate(campaignId: string) {
  publishEphemeral(campaignId, "battle_map_updated", {});
}

// A carried light matters only in dim/dark maps; inferred from equipment.
export function carriedLightRadius(sheet: CharacterSheet): number {
  const hasLight = sheet.equipment.some((item) => /torch|lantern|candle/i.test(item.name));
  return hasLight ? 4 : 0;
}

export function createBattleMapForEncounter(
  campaign: Campaign,
  encounter: Encounter,
  enemies: EncounterEnemy[],
  sheets: CharacterSheet[],
  battlefield: string | undefined,
  engaged = false,
): BattleMap | null {
  const location = (encounter.locationId ? getLocation(encounter.locationId) : null) ?? getCurrentLocation(campaign.id);
  const generated = generateBattleMap({
    seed: fnv1a(encounter.id),
    genre: campaign.gameSettings.genre,
    locationName: location?.name,
    layoutDescription: location?.layoutDescription,
    hint: battlefield,
    pcCount: sheets.length,
    enemyCount: enemies.length,
  });
  const map = createBattleMap({
    encounterId: encounter.id,
    campaignId: campaign.id,
    width: generated.width,
    height: generated.height,
    terrain: generated.terrain,
    ambient: generated.ambient,
    theme: generated.theme,
    lights: generated.lights,
    seed: fnv1a(encounter.id),
  });
  // A fight that breaks out mid-scuffle starts in melee: each enemy takes the open tile
  // nearest a hero instead of the far edge, which cost rounds of walking and a string
  // of "out of reach" refusals before anyone could swing.
  const taken = new Set(generated.pcSpawns.map((spot) => tileIndex(generated.width, spot.x, spot.y)));
  const enemySpots = engaged && generated.pcSpawns.length
    ? enemies.map((_, index) => {
        const hero = generated.pcSpawns[index % generated.pcSpawns.length];
        const spot = nearestOpenTile(generated.terrain, generated.width, generated.height, hero, taken);
        taken.add(tileIndex(generated.width, spot.x, spot.y));
        return spot;
      })
    : generated.enemySpawns;
  placeTokens(map.id, campaign.id, [
    ...sheets.map((sheet, index) => ({
      kind: "pc" as const,
      refId: sheet.id,
      name: sheet.name,
      spot: generated.pcSpawns[index] ?? generated.pcSpawns[0],
      lightRadius: carriedLightRadius(sheet),
    })),
    ...enemies.map((enemy, index) => ({
      kind: "enemy" as const,
      refId: enemy.id,
      name: enemy.displayName,
      spot: enemySpots[index] ?? enemySpots[0],
    })),
  ]);
  publishBattleMapUpdate(campaign.id);
  return map;
}

// ---- move_token tool ----

export const moveTokenTool: ToolDef = {
  type: "function",
  function: {
    name: "move_token",
    description:
      "Move a combatant on the battle map: an enemy taking its movement, or a character being pushed, pulled, or carried (forced movement only; players walk their own tokens). The server enforces walls, occupancy, and speed; enemy moves clamp to the farthest legal tile toward the target.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenName: {
          type: "string",
          description:
            "Enemy name or enemyId, or character name/characterId for forced movement, exactly as shown on the battle map in GAME STATE.",
        },
        x: { type: "integer", description: "Destination column." },
        y: { type: "integer", description: "Destination row." },
        forced: {
          type: "boolean",
          description: "True only when a character is moved against their will.",
        },
        reason: { type: "string" },
      },
      required: ["tokenName", "x", "y"],
    },
  },
};

const moveArgsSchema = z.object({
  tokenName: z.string(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  forced: z.coerce.boolean().optional(),
  reason: z.string().optional(),
});

function resolveMoveTarget(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { token: BattleToken; kind: "pc" | "enemy"; speedTiles: number } | null {
  const trimmed = ref.trim();
  const sheet = resolveSheetRef(trimmed, sheets, sheetsById);
  if (sheet) {
    const token = getTokenByRef(map.id, sheet.id);
    return token ? { token, kind: "pc", speedTiles: speedToTiles(sheet.speed) } : null;
  }
  const enemies = listEnemies(encounterId);
  const enemy =
    enemies.find((entry) => entry.id === trimmed) ??
    enemies.find((entry) => entry.displayName.toLowerCase() === trimmed.toLowerCase()) ??
    enemies.find((entry) => entry.displayName.toLowerCase().includes(trimmed.toLowerCase()));
  if (!enemy || enemy.status !== "alive") {
    return null;
  }
  const token = getTokenByRef(map.id, enemy.id);
  // Grappled/restrained/stunned... = speed 0; the budget clamp refuses the
  // move with the standard "no movement left" error.
  const speedTiles =
    effectiveSpeed(enemy.conditions, 1) === 0 ? 0 : speedToTiles(enemy.stats.speed);
  return token ? { token, kind: "enemy", speedTiles } : null;
}

export function handleMoveToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return { error: "This encounter has no battle map." };
  }
  let args: z.infer<typeof moveArgsSchema>;
  try {
    args = moveArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: move_token needs tokenName, x, and y." };
  }
  const resolved = resolveMoveTarget(map, encounter.id, args.tokenName, sheets, sheetsById);
  if (!resolved) {
    return { error: `Unknown combatant "${args.tokenName}"; use a name from the battle map.` };
  }
  if (resolved.kind === "pc" && !args.forced) {
    return {
      error: `${resolved.token.name} is a player character; players move their own tokens. Pass forced:true only when something pushes, drags, or carries them.`,
    };
  }
  if (args.x < 0 || args.y < 0 || args.x >= map.width || args.y >= map.height) {
    return { error: `(${args.x},${args.y}) is outside the ${map.width}x${map.height} map.` };
  }

  const tokens = listTokens(map.id);
  const occupied = occupiedTiles(map, tokens, resolved.token);
  if (occupied.has(tileIndex(map.width, args.x, args.y))) {
    return { error: `(${args.x},${args.y}) is occupied by another combatant.` };
  }
  const path = findPath(map.terrain, map.width, map.height, occupied, resolved.token, {
    x: args.x,
    y: args.y,
  });
  if (!path) {
    return { error: `No path to (${args.x},${args.y}); walls block the way.` };
  }

  // Forced movement ignores speed (the force decides the distance); normal
  // enemy movement clamps to the round's remaining budget along the path.
  let landing = { x: args.x, y: args.y };
  let spent = 0;
  let clamped = false;
  if (resolved.kind === "enemy") {
    const budget = Math.max(0, resolved.speedTiles - resolved.token.movedThisRound);
    const walk = walkPathWithBudget(map.terrain, map.width, path, budget);
    if (!walk.at) {
      return {
        error: `${resolved.token.name} has no movement left this round (speed ${resolved.speedTiles * 5} ft).`,
      };
    }
    landing = walk.at;
    spent = walk.spent;
    clamped = !walk.reachedEnd;
  }
  const origin = { x: resolved.token.x, y: resolved.token.y };
  moveToken(
    resolved.token.id,
    landing.x,
    landing.y,
    resolved.kind === "enemy" ? resolved.token.movedThisRound + spent : resolved.token.movedThisRound,
  );
  publishBattleMapUpdate(campaign.id);

  // An enemy breaking away from a character eats their opportunity attack,
  // exactly as the reverse does when a player walks off. Forced movement
  // (a shove, a gust of wind) provokes nothing.
  const opportunity =
    resolved.kind === "enemy" && !args.forced
      ? resolvePcOpportunityAttacks(campaign, resolved.token.refId, origin, landing)
      : [];
  // Fresh ranges from the landing tile, so the model narrates the new
  // distances instead of remembering the pre-move map.
  const opposing = tokens.filter(
    (other) => other.id !== resolved.token.id && other.kind !== resolved.kind,
  );
  const distances = opposing.map((other) => {
    const tilesApart = Math.max(Math.abs(landing.x - other.x), Math.abs(landing.y - other.y));
    return `${other.name}: ${tilesApart <= 1 ? "ADJACENT (5 ft)" : `${tilesApart * 5} ft`}`;
  });
  return {
    ok: true,
    name: resolved.token.name,
    at: `(${landing.x},${landing.y})`,
    ...(distances.length ? { distancesNow: distances.join("; ") } : {}),
    ...(opportunity.length
      ? {
          opportunityAttacks: opportunity,
          opportunityNote:
            "The server already rolled and applied these; narrate them, and do not call pc_attack for them.",
        }
      : {}),
    ...(clamped
      ? {
          note: `Speed limited the move: ${resolved.token.name} stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`,
        }
      : {}),
  };
}

// ---- spatial checks for pc_attack ----

// Sneak Attack's second trigger: another enemy of the target is within 5 ft
// of it, meaning any PC token other than the attacker standing adjacent.
// Null map = no spatial information, so the caller falls back to the
// advantage trigger alone rather than guessing.
export function allyAdjacentToEnemy(
  campaign: Campaign,
  encounterId: string,
  attackerCharacterId: string,
  enemyId: string,
): boolean {
  if (isJrpgCombat(campaign)) return false;
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return false;
  }
  const target = getTokenByRef(map.id, enemyId);
  if (!target) {
    return false;
  }
  return listTokens(map.id).some(
    (token) =>
      token.kind === "pc" &&
      token.refId !== attackerCharacterId &&
      chebyshev(token.x, token.y, target.x, target.y) <= 1,
  );
}

// Read-only range gate for player attacks: PCs are never auto-moved (players
// walk their own tokens), so an out-of-reach attack is refused with the
// distance spelled out. No map = no spatial enforcement. Returns an error
// string, or null when the attack may proceed.
// What the map says about an attack beyond whether it is legal: the cover
// the target enjoys and whether the shot is past its normal range. Returned
// alongside the refusal so pc_attack can fold both into the roll.
export type AttackSpatials = { cover: 0 | 2 | 5; longRange: boolean };

export function pcAttackSpatials(
  campaign: Campaign,
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: { ranged: boolean; rangeTiles: number; thrown: boolean },
): AttackSpatials {
  const none: AttackSpatials = { cover: 0, longRange: false };
  if (isJrpgCombat(campaign)) {
    return none;
  }
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return none;
  }
  const attacker = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  if (!attacker || !target) {
    return none;
  }
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  return {
    cover: coverBetween(map.terrain, map.width, map.height, attacker.x, attacker.y, target.x, target.y),
    // Past the weapon's normal range but inside its long range: the SRD
    // penalty is disadvantage, and checkPcAttackRange allows up to double.
    longRange: (options.ranged || options.thrown) && distance > options.rangeTiles,
  };
}

export function checkPcAttackRange(
  campaign: Campaign,
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: { ranged: boolean; rangeTiles: number; reachTiles: number; thrown: boolean },
): string | null {
  if (isJrpgCombat(campaign)) {
    return null;
  }
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const attacker = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  if (!attacker || !target) {
    return null;
  }
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  if (!options.ranged && distance <= options.reachTiles) {
    return null;
  }
  const sighted = hasLineOfSight(
    map.terrain,
    map.width,
    map.height,
    attacker.x,
    attacker.y,
    target.x,
    target.y,
  );
  // The SRD long-range rule: a ranged weapon reaches twice its normal range,
  // at disadvantage. Past that it cannot reach at all.
  if ((options.ranged || options.thrown) && distance <= options.rangeTiles * 2) {
    return sighted
      ? null
      : `${attacker.name} has no line of sight to ${target.name}; something blocks the shot. They must move their token to a sightline first or pick another target.`;
  }
  if (options.ranged || options.thrown) {
    return `${attacker.name} is ${formatDistanceFeet(distance * 5, campaign.gameSettings.unitSystem)} from ${target.name}, beyond this attack's ${formatDistanceFeet(options.rangeTiles * 10, campaign.gameSettings.unitSystem)} maximum range. They must move their token closer or pick another target.`;
  }
  return `${attacker.name} is ${formatDistanceFeet(distance * 5, campaign.gameSettings.unitSystem)} from ${target.name}, out of melee reach (${formatDistanceFeet(options.reachTiles * 5, campaign.gameSettings.unitSystem)}). They must move their token adjacent first or attack with a ranged weapon.`;
}

// ---- spatial checks for enemy_attack ----

const RANGED_ATTACK_RE =
  /bow|crossbow|sling|dart|javelin|thrown|spit|spine|rifle|pistol|gun|blast|bolt|ray|breath|web|rock|spear of|longarm/i;
const RANGED_TILES = 12;

// What an enemy attack can reach, in tiles. The printed block decides; a
// block without distances (synthesized, homebrew) is read from its name, at
// the old flat 60 ft.
function attackReachTiles(attack: Pick<EnemyAttack, "name" | "reach" | "range" | "longRange">) {
  const printed = attack.reach !== undefined || attack.range !== undefined;
  const melee = printed ? attack.reach !== undefined : !RANGED_ATTACK_RE.test(attack.name);
  const range = printed
    ? attack.range === undefined ? 0 : Math.max(1, Math.floor(attack.range / 5))
    : melee ? 0 : RANGED_TILES;
  return {
    melee,
    // Reach 0 (a swarm in your space) still means the next tile on a grid.
    reach: Math.max(1, Math.floor((attack.reach ?? 5) / 5)),
    range,
    long: Math.max(range, Math.floor((attack.longRange ?? 0) / 5)),
  };
}

// Whether an enemy attack is a ranged one when there is no board to measure
// on (shared with the condition engine's melee/ranged advantage rules).
export function isRangedAttack(attack: Pick<EnemyAttack, "name" | "reach" | "range" | "longRange">): boolean {
  return !attackReachTiles(attack).melee;
}

// Attackers step toward their target automatically so a model that never
// calls move_token still produces spatially coherent combat: into reach for
// a melee attack, into normal range and sight for a ranged one. Null when
// there is no board; otherwise how the attack is made (`far`: past normal
// range, at disadvantage) or why it cannot be.
export function approachForAttack(
  campaign: Campaign,
  encounterId: string,
  enemyId: string,
  targetCharacterId: string,
  attack: Pick<EnemyAttack, "name" | "reach" | "range" | "longRange">,
): { blocked?: Record<string, unknown>; movedTo?: string; ranged?: boolean; far?: boolean } | null {
  if (isJrpgCombat(campaign)) {
    return null;
  }
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const attacker = getTokenByRef(map.id, enemyId);
  const target = getTokenByRef(map.id, targetCharacterId);
  if (!attacker || !target) {
    return null;
  }
  const units = campaign.gameSettings.unitSystem;
  const tiles = attackReachTiles(attack);
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  if (tiles.melee && distance <= tiles.reach) {
    return { ranged: false };
  }
  if (tiles.range) {
    const sighted = hasLineOfSight(
      map.terrain,
      map.width,
      map.height,
      attacker.x,
      attacker.y,
      target.x,
      target.y,
    );
    if (distance <= tiles.range && sighted) {
      return { ranged: true };
    }
    // Out of range or sight: auto-reposition to the nearest reachable tile
    // that has both, so ranged enemies keep spatially coherent tokens the
    // same way melee attackers auto-approach.
    const enemy = listEnemies(encounterId).find((entry) => entry.id === enemyId);
    const budget =
      enemy && effectiveSpeed(enemy.conditions, 1) === 0
        ? 0
        : Math.max(0, speedToTiles(enemy?.stats.speed) - attacker.movedThisRound);
    const tokens = listTokens(map.id);
    const occupied = occupiedTiles(map, tokens, attacker);
    const spot =
      budget > 0
        ? bestFiringPosition(
            map.terrain,
            map.width,
            map.height,
            occupied,
            attacker,
            target,
            budget,
            tiles.range,
          )
        : null;
    if (spot) {
      moveToken(attacker.id, spot.at.x, spot.at.y, attacker.movedThisRound + spot.cost);
      publishBattleMapUpdate(campaign.id);
      return { ranged: true, movedTo: `(${spot.at.x},${spot.at.y})` };
    }
    // Long range: the shot is still there, at disadvantage.
    if (distance <= tiles.long && sighted) {
      return { ranged: true, far: true };
    }
    if (!tiles.melee) {
      return {
        blocked: {
          error: sighted
            ? `${attacker.name} is ${formatDistanceFeet(distance * 5, units)} from ${target.name}, beyond ${attack.name}'s ${formatDistanceFeet(Math.max(tiles.range, tiles.long) * 5, units)} range, and cannot close the gap this round. Pick another target or action.`
            : `${attacker.name} has no line of sight to ${target.name} and cannot reach a firing position this round. Pick another target or action.`,
        },
      };
    }
  }
  const enemy = listEnemies(encounterId).find((entry) => entry.id === enemyId);
  const budget =
    enemy && effectiveSpeed(enemy.conditions, 1) === 0
      ? 0
      : Math.max(0, speedToTiles(enemy?.stats.speed) - attacker.movedThisRound);
  const tokens = listTokens(map.id);
  const occupied = occupiedTiles(map, tokens, attacker);
  const path = findPath(map.terrain, map.width, map.height, occupied, attacker, target);
  // Path targets the occupied tile; stop on the first tile within reach.
  const inReach = path ? path.findIndex((step) => chebyshev(step.x, step.y, target.x, target.y) <= tiles.reach) : -1;
  const approach = path ? path.slice(0, inReach >= 0 ? inReach + 1 : -1) : null;
  let landed = { x: attacker.x, y: attacker.y };
  if (approach && approach.length && budget > 0) {
    const walk = walkPathWithBudget(map.terrain, map.width, approach, budget);
    if (walk.at) {
      landed = walk.at;
      moveToken(attacker.id, walk.at.x, walk.at.y, attacker.movedThisRound + walk.spent);
      publishBattleMapUpdate(campaign.id);
    }
  }
  const remaining = chebyshev(landed.x, landed.y, target.x, target.y);
  if (remaining <= tiles.reach) {
    return { ranged: false, movedTo: `(${landed.x},${landed.y})` };
  }
  return {
    blocked: {
      error: `${attacker.name} is ${formatDistanceFeet(remaining * 5, units)} from ${target.name} and cannot reach them with ${attack.name} this round${
        landed.x !== attacker.x || landed.y !== attacker.y
          ? `; it moved to (${landed.x},${landed.y})`
          : ""
      }. Use a ranged option or a different target.`,
    },
  };
}
