import { z } from "zod";
import {
  allocateSeq,
  getCampaignById,
  getMember,
  latestSeq,
  setMemberSkipTurns,
  setFloor,
  getFloor,
  type Campaign,
  type InitiativeFloor,
} from "@/lib/db/campaigns";
import {
  createEncounter,
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  saveEncounter,
  type Encounter,
  type EncounterEnemy,
  orderEntryId,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getRoll, insertRoll } from "@/lib/db/rolls";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listOpenPendingRolls, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived, effectiveAcFor } from "@/lib/srd";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { suggestEnemies } from "@/lib/bestiary";
import { enemyRequestSchema, resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { healthState } from "@/lib/bestiary/health";
import type { EnemyAttack, EnemySaveAction } from "@/lib/bestiary/statblock";
import { pickEnemyAction, rechargeEnemies, spendAction } from "@/lib/dm/enemy-actions";
import {
  advanceOrder,
  buildOrder,
  coerceEncounterOutcome,
  critDamageExpression,
  numberDuplicates,
  pickEnemyTarget,
} from "@/lib/dm/encounter-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { followCombatAmbience } from "@/lib/dm/ambience-tools";
import {
  approachForAttack,
  createBattleMapForEncounter,
  handleMoveToken,
  isRangedAttack,
  moveTokenTool,
  publishBattleMapUpdate,
} from "@/lib/dm/map-tools";
import { isJrpgCombat } from "@/lib/dm/combat-mode";
import {
  applyEnemyDamage,
  finishEncounter,
  publishEncounter,
  resolveEnemyRef,
} from "@/lib/dm/enemy-damage";
import {
  applyExtraEncounterCall,
  EXTRA_ENCOUNTER_TOOL_NAMES,
  extraEncounterTools,
} from "@/lib/dm/encounter-tools-extra";
import { handlePcAttack, pcAttackTool } from "@/lib/dm/pc-attack";
import { isCompanionUserId } from "@/lib/db/users";
import { wakeDm } from "@/lib/dm/wake";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { applyField } from "@/lib/dm/effects-logic";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import {
  castAtEnemyTool,
  castAtPlayerTool,
  handleCastAtEnemy,
  handleCastAtPlayer,
} from "@/lib/dm/cast-tools";
import {
  ACTION_TOOL_NAMES,
  actionTools,
  currentCombatantId,
  handleTakeAction,
  handleUseReaction,
} from "@/lib/dm/action-tools";
import {
  attackContext,
  incapacitatedBy,
  isIncapacitated,
  mergeAdvantage,
} from "@/lib/dm/condition-logic";
import { tickEncounterConditions } from "@/lib/dm/condition-tick";
import { rollDeathSave } from "@/lib/dm/death";
import { getBattleMapForEncounter, getTokenByRef, resetRoundBudgets } from "@/lib/db/battle-maps";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Server-authoritative combat: enemies spawn from real stat blocks, their
// HP changes only through these tools, and the initiative pointer is moved
// by the server (finalize/lead skip), never by the model.

export const ENCOUNTER_TOOL_NAMES = [
  "start_encounter",
  "pc_attack",
  "cast_at_enemy",
  "cast_at_player",
  "damage_enemy",
  "enemy_attack",
  "move_token",
  "end_turn",
  "end_encounter",
  ...EXTRA_ENCOUNTER_TOOL_NAMES,
  ...ACTION_TOOL_NAMES,
];

export const ENCOUNTER_CAP_PER_TURN = 12;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const startEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "start_encounter",
    description:
      "Begin combat with real, server-tracked enemies. monster selects hidden mechanics; name is the in-world identity shown in initiative, combat UI, and map. For any person/NPC already present in the story, preserve that exact story name or role in name instead of exposing a stat-block label.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemies: {
          type: "array",
          minItems: 0,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              monster: {
                type: "string",
                description: "Mechanical stat-block slug/name only, e.g. 'rogue', 'guard', 'goblin'. This is not the combatant's story identity.",
              },
              name: {
                type: "string",
                description: "In-world identity shown to players. Preserve the existing story name/role for narrated NPCs, e.g. monster='rogue', name='Бармен'. Optional only for truly generic creatures whose stat-block name is also their intended visible name.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
            },
            required: ["monster"],
          },
        },
        summary: { type: "string", description: "One line on what this fight is." },
        surprised: {
          type: "string",
          enum: ["none", "enemies", "party"],
          description:
            "Who was caught off guard: 'enemies' when the party ambushes them, 'party' when they are jumped. The surprised side loses its first turn. Default none.",
        },
        battlefield: {
          type: "string",
          description:
            "One line describing the fighting ground, used to shape the tactical battle map, e.g. 'a torchlit crypt with a flooded channel'.",
        },
        locationId: {
          type: "string",
          description: "When the party is split: the place the fight is at (locationId from partyPositions). Only characters standing there fight.",
        },
      },
      required: ["enemies"],
    },
  },
};

const damageEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "damage_enemy",
    description:
      "Deal damage to an enemy in the active encounter. Call it BEFORE narrating a blow landing; the enemy dies only when the result says dead: true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        amount: { type: "integer", minimum: 1, maximum: 200 },
        type: { type: "string", description: "Damage type, e.g. slashing, fire." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId", "amount"],
    },
  },
};

const enemyAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_attack",
    description:
      "An enemy takes one of the actions in its stat block against a character. Attacks (stats.attacks): the server moves it into reach or range, rolls to-hit against the target's real AC, applies real damage and what the hit does (a web restrains, a bite poisons on a failed save). Save actions (stats.saves: a breath weapon, a gaze): every target rolls their own save from their sheet; list everyone caught in targetCharacterIds. Recharge and per-day actions are tracked (enemy.spent) and refused while spent. Never invent an enemy's numbers or use request_roll for enemy attacks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        targetCharacterId: {
          type: "string",
          description: "Exact characterId from GAME STATE.",
        },
        targetCharacterIds: {
          type: "array",
          items: { type: "string" },
          description: "Save actions only: everyone else caught in its area, exact characterIds.",
        },
        attack: {
          type: "string",
          description: "Action name from stats.attacks or stats.saves, e.g. \"Web\" or \"Fire Breath\". Omit for its everyday attack. An unknown name is refused, never swapped.",
        },
        advantage: { type: "string", enum: ["none", "advantage", "disadvantage"] },
      },
      required: ["enemyId", "targetCharacterId"],
    },
  },
};

const endEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "end_encounter",
    description:
      "End the active encounter when it resolves any way other than every enemy dying: flight, surrender, parley, or party defeat. Victory by killing every enemy ends automatically.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: {
          type: "string",
          enum: ["victory", "enemies_fled", "party_fled", "party_defeated", "truce"],
        },
        reason: { type: "string" },
      },
      required: ["outcome"],
    },
  },
};

const endTurnTool: ToolDef = {
  type: "function",
  function: {
    name: "end_turn",
    description:
      "Mark the current character's combat turn as complete. THIS is what advances the initiative: an attack alone never ends a turn, because the character may still have movement or a bonus action. Call it when the player has spent or declined the rest of their turn (or their whole declared turn is resolved). The server advances the initiative after your narration and posts a note naming the next turn. Never announce whose turn is next yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
      },
      required: ["characterId"],
    },
  },
};

export function encounterTools(hasActiveEncounter: boolean): ToolDef[] {
  return hasActiveEncounter
    ? [
        pcAttackTool,
        castAtEnemyTool,
        castAtPlayerTool,
        damageEnemyTool,
        enemyAttackTool,
        moveTokenTool,
        endTurnTool,
        endEncounterTool,
        ...extraEncounterTools,
        ...actionTools,
      ]
    : [startEncounterTool];
}

function crLabel(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

import { spatialEnabled, spatialStore } from "@/lib/spatial/service";
import { getOverworldPartyPositions, partyStanding } from "@/lib/db/overworld";
import { atFight, joinFight, placeArrivingHero, syncFightBoards } from "@/lib/dm/fight-presence";
import { withEncounterRoom } from "@/lib/spatial/publication-scope.mjs";

// ---- start_encounter ----

const startArgsSchema = z.object({
  enemies: z.array(enemyRequestSchema).max(8),
  summary: z.string().optional(),
  surprised: z.enum(["none", "enemies", "party"]).optional(),
  battlefield: z.string().max(300).optional(),
  roomId: z.string().optional(),
  locationId: z.string().optional(),
  rollInitiative: z.boolean().optional(),
  engaged: z.boolean().optional(),
});

// Accepts the documented {enemies:[...]} shape, or flat monster/name/count
// keys (the textual-salvage path cannot produce arrays).
function parseStartArgs(rawArguments: string): z.infer<typeof startArgsSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const nested = startArgsSchema.safeParse(raw);
  if (nested.success) {
    return nested.data;
  }
  const flat = enemyRequestSchema
    .extend({ summary: z.string().optional(), battlefield: z.string().max(300).optional(), roomId: z.string().optional(), locationId: z.string().optional() })
    .safeParse(raw);
  if (flat.success) {
    return {
      enemies: [{ monster: flat.data.monster, name: flat.data.name, count: flat.data.count, cr: flat.data.cr }],
      summary: flat.data.summary,
      battlefield: flat.data.battlefield,
      roomId: flat.data.roomId,
      locationId: flat.data.locationId,
    };
  }
  return null;
}

function suggestionLines(campaign: Campaign, sheets: CharacterSheet[]): string {
  return suggestEnemies(campaign.gameSettings, sheets.map((sheet) => sheet.level), 5)
    .map((entry) => `${entry.slug} as "${entry.name}" (CR ${crLabel(entry.cr)})`)
    .join(", ");
}

function handleStartEncounter(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
): Record<string, unknown> {
  const args = parseStartArgs(rawArguments);
  if (!args) {
    return {
      error:
        'Invalid start_encounter arguments. Send {"enemies":[{"monster":"goblin","count":3}],"summary":"..."}.',
    };
  }
  if (getActiveEncounter(campaign.id, args.roomId)) {
    return {
      error:
        "An encounter is already active. Use damage_enemy and enemy_attack, or end_encounter first.",
    };
  }
  let participants = sheets;
  if (spatialEnabled(campaign.id) && !args.roomId) return { error: "Location combat requires an exact roomId." };
  if (spatialEnabled(campaign.id) && args.roomId) {
    const roomSheets = sheets.filter(
      (sheet) => spatialStore().getUserRoom(campaign.id, sheet.userId) === args.roomId,
    );
    participants = roomSheets;
  }
  // Without rooms the fight is at one recorded place; a split party says which.
  let fightLocationId: string | null = null;
  if (!spatialEnabled(campaign.id)) {
    const standing = partyStanding(campaign.id, sheets);
    const places = [...new Set(sheets.map((sheet) => standing[sheet.id]).filter(Boolean))];
    const where = () => getOverworldPartyPositions(campaign.id)
      .filter((position) => position.locationId)
      .map((position) => `${position.name}: ${position.locationName} (locationId=${position.locationId})`).join("; ");
    if (args.locationId && !places.includes(args.locationId)) {
      return { error: `Nobody stands at that locationId. Where the party is: ${where()}.` };
    }
    if (!args.locationId && places.length > 1) {
      return { error: `The party is split; pass locationId of the place the fight is at. Only characters standing there fight. Where the party is: ${where()}.` };
    }
    fightLocationId = args.locationId ?? places[0] ?? null;
    if (fightLocationId) participants = sheets.filter((sheet) => standing[sheet.id] === fightLocationId);
  }
  if (!participants.length) {
    return { error: "No party characters to fight." };
  }

  if (!args.enemies.length && (!campaign.gameSettings.friendlyFire || participants.filter(sheet => sheet.currentHp > 0).length < 2)) {
    return { error: "A party-only encounter requires friendlyFire and at least two conscious characters." };
  }

  // Resolve every requested enemy before creating anything.
  const outcome = resolveEnemyRequests(campaign.gameSettings, args.enemies, campaign.ownerUserId);
  if ("unknownMonster" in outcome) {
    return {
      error: `Unknown monster "${outcome.unknownMonster}". Use a real monster slug or name, or pass cr for an invented enemy. Good picks for this world: ${suggestionLines(campaign, participants)}.`,
    };
  }
  const resolved = outcome.resolved;
  if (resolved.length > 8) {
    return { error: "Too many enemies; keep encounters to 8 combatants or fewer." };
  }

  // 5e budget check: refuse fights the party cannot plausibly survive.
  const partyLevels = participants.map((sheet) => sheet.level);
  const evaluation = evaluateEncounter(partyLevels, resolved.map((entry) => entry.stats.cr));
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  if (evaluation.adjustedXp > ceiling) {
    return {
      error: `Too deadly for this party: adjusted XP ${evaluation.adjustedXp} vs an allowed ceiling of ${ceiling} (difficulty ${campaign.difficulty}). Use fewer or weaker enemies. Good picks for this world: ${suggestionLines(campaign, participants)}.`,
    };
  }

  const encounter = createEncounter(campaign.id, args.summary ?? "", "fight", args.roomId, fightLocationId);
  if (!encounter) {
    return { error: "An encounter is already active." };
  }

  const names = numberDuplicates(resolved.map((entry) => entry.name));
  const enemies = resolved.map((entry, index) =>
    insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: entry.slug,
      displayName: names[index],
      // Enemy initiative rolls silently at spawn; players roll on request.
      initiative: rollExpression(d20Expression(entry.stats.dexMod)).total,
      stats: entry.stats,
    }),
  );
  // Surprise: the ambushed side loses its first turn. Stored as ids the
  // initiative pointer skips through round 1 and then forgets.
  if (args.surprised === "enemies") {
    encounter.surprisedIds = enemies.map((enemy) => enemy.id);
  } else if (args.surprised === "party") {
    encounter.surprisedIds = participants.map((sheet) => sheet.id);
  }
  if (encounter.surprisedIds.length) {
    saveEncounter(encounter);
  }
  createBattleMapForEncounter(campaign, encounter, enemies, participants, args.battlefield, args.engaged === true);
  publishEncounter(campaign.id);

  // Initiative is starting: the room's music changes, and the harder the
  // fight reads the bigger the music. The bed is left alone, because the
  // cave they are fighting in is still a cave.
  followCombatAmbience(
    campaign,
    true,
    evaluation.verdict === "deadly" || evaluation.verdict === "beyond_deadly",
  );

  // Opt-in: roll every hero's initiative digitally now instead of one request_roll per hero.
  // Its note says who acts first, so the model is not left guessing.
  const begun = args.rollInitiative === true ? ensureInitiativeProgress(campaign) : null;
  const rollList = participants
    .map((sheet) => `${sheet.name} (characterId=${sheet.id})`)
    .join(", ");
  return {
    ok: true,
    encounterId: encounter.id,
    enemies: enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      ac: enemy.ac,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
    })),
    difficulty: `${evaluation.verdict} for this party`,
    ...(evaluation.verdict === "deadly" || evaluation.verdict === "beyond_deadly"
      ? { warning: "This fight can kill characters. Telegraph the danger." }
      : {}),
    map: "A tactical battle map was generated; positions appear in GAME STATE on your next call.",
    ...(encounter.surprisedIds.length
      ? {
          surprise: `${args.surprised === "party" ? "The party is" : "The enemies are"} surprised: the server skips their turns for the first round. Narrate the ambush landing.`,
        }
      : {}),
    next: begun ?? (getActiveEncounter(campaign.id)?.orderReady
      ? "Initiative is rolled for every combatant; the order and the current actor are in GAME STATE."
      : `Now call request_roll with kind=initiative for EACH character: ${rollList}. Combat begins once every initiative is in.`),
  };
}

// ---- initiative collection ----

// Whether this combatant can take a turn: alive AND (for PCs) not
// incapacitated. A stunned or paralyzed PC's turn is skipped exactly like a
// downed one; the condition ticks away at round wrap. Enemies stay in the
// passed list either way (enemy_attack refuses the incapacitated ones).
function entryAlive(entry: OrderEntry, enemiesById: Map<string, EncounterEnemy>, here?: (sheet: CharacterSheet) => boolean): boolean {
  if (entry.kind === "pc") {
    const sheet = getSheetById(entry.characterId);
    // A hero who left the fight's place is passed over until they return.
    return (sheet?.currentHp ?? 0) > 0 && !isIncapacitated(sheet?.conditions ?? []) && (!sheet || !here || here(sheet));
  }
  if (entry.kind === "enemy") {
    return enemiesById.get(entry.enemyId)?.status === "alive";
  }
  // A DM's own NPC slot has no stat block to be dead in. It stays in the
  // order until the DM takes it out (src/lib/dm/initiative-edit.ts).
  return true;
}

// Surprise costs exactly the first turn: advanceOrder walks past these
// combatants until round 1 wraps, and startRound empties the list then.
function surprisedIn(encounter: Encounter) {
  return (entry: OrderEntry) => encounter.surprisedIds.includes(orderEntryId(entry));
}

// A new round: surprise is spent, timed conditions tick down, save-ends
// conditions re-save, spent recharge actions roll to come back, and movement
// budgets refill for every token. Other combatants keep their spent
// reactions until their own next turn.
function startRound(campaign: Campaign, encounter: Encounter) {
  encounter.round += 1;
  encounter.surprisedIds = [];
  tickEncounterConditions(campaign, encounter);
  rechargeEnemies(listEnemies(encounter.id));
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    resetRoundBudgets(map.id, encounter.round);
    publishBattleMapUpdate(campaign.id);
  }
}

// A character's Armor Class with every active effect folded in
// (src/lib/dm/effects-logic.ts). Every attack resolution asks this rather
// than effectiveAcFor directly, so a Shield of Faith and a curse both land on
// the same number instead of on whichever call site remembered them.
export function acWithEffects(campaignId: string, sheet: CharacterSheet): number {
  return applyField(
    effectiveAcFor(sheet),
    effectOutcome(campaignId, { kind: "character", id: sheet.id }, "ac"),
  );
}

// The same for an enemy, whose base AC is a column rather than a derivation.
export function enemyAcWithEffects(campaignId: string, enemy: EncounterEnemy): number {
  return applyField(
    enemy.ac,
    effectOutcome(campaignId, { kind: "enemy", id: enemy.id }, "ac"),
  );
}

// Exported for src/lib/dm/initiative.ts: a DM editing the order moves the
// pointer without going through advancePointer, and the floor has to follow
// it or the banner and the permission check disagree about whose turn it is.
export function setInitiativeFloor(campaign: Campaign | null, encounter: Encounter) {
  if (!campaign) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  const floor: InitiativeFloor = {
    mode: "initiative",
    encounterId: encounter.id,
    userIds: [current.userId],
    currentName: current.name,
    round: encounter.round,
  };
  // Pointer movement must not reopen a submitted combat turn. The narration
  // path is the only place that releases this gate.
  const previous = getFloor(campaign.id, encounter.roomId);
  const next = previous.mode === "hold" && previous.combat?.encounterId === encounter.id
    ? { ...previous, next: floor }
    : floor;
  setFloor(campaign.id, next, encounter.roomId);
  publishPersisted(campaign.id, "floor_changed", { floor: next });
}

function describeOrder(encounter: Encounter): string {
  return encounter.order
    .map((entry, index) => (index === encounter.turnIndex ? `${entry.name} (CURRENT)` : entry.name))
    .join(" > ");
}

// Records one PC's initiative result. When the last one lands, builds the
// order, points the turn at the first living PC, and locks the floor.
// Returns a note for the model when combat begins.
export function recordInitiativeRoll(
  campaignId: string,
  characterId: string | null,
  total: number,
): string | null {
  if (!characterId) {
    return null;
  }
  const sheet = getSheetById(characterId);
  const userRoom = sheet && spatialEnabled(campaignId) ? spatialStore().getUserRoom(campaignId, sheet.userId) : null;
  const encounter = (userRoom ? getActiveEncounter(campaignId, userRoom) : null) ?? getActiveEncounter(campaignId);
  if (!encounter || !sheet || !atFight(campaignId, encounter, sheet) ||
    encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === characterId)) {
    return null;
  }
  const entry = { kind: "pc" as const, characterId: sheet.id, userId: sheet.userId, name: sheet.name, initiative: total };
  if (encounter.orderReady) {
    joinFight(encounter, entry);
    placeArrivingHero(campaignId, encounter, sheet);
    publishEncounter(campaignId);
    return `${sheet.name} joins the fight at initiative ${total}.`;
  }
  encounter.order.push(entry);

  const relevantSheets = listSheets(campaignId).filter((s) => atFight(campaignId, encounter, s));
  const staged = encounter.order.filter(
    (entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc",
  );
  if (staged.length < relevantSheets.length) {
    saveEncounter(encounter);
    return null;
  }

  // Everyone is in: build the final order and open combat.
  const enemies = listEnemies(encounter.id);
  encounter.order = buildOrder(
    staged,
    enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      initiative: enemy.initiative ?? 0,
    })),
  );
  const enemiesById = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const first = advanceOrder(
    encounter.order,
    -1,
    (entry) => entryAlive(entry, enemiesById, (sheet) => atFight(campaignId, encounter, sheet)),
    surprisedIn(encounter),
  );
  if (!first) {
    saveEncounter(encounter);
    return null;
  }
  const campaign = getCampaignById(campaignId);
  // The whole party was ambushed: round 1 was the enemies' alone, and the
  // first hero's turn is in round 2.
  if (first.wrapped && campaign) {
    startRound(campaign, encounter);
  }
  encounter.orderReady = true;
  encounter.turnIndex = first.turnIndex;
  encounter.waitingSeq = latestSeq(campaignId);
  saveEncounter(encounter);
  setInitiativeFloor(campaign, encounter);
  publishEncounter(campaignId);
  if (campaign) {
    for (const passedCharacterId of first.pcsPassed) {
      rollDeathSave(campaign, passedCharacterId);
    }
  }

  // An enemy above the ambushed party passes twice; it is told to act once.
  const actFirst = [...new Set(first.enemiesPassed)]
    .map((enemyId) => enemiesById.get(enemyId)?.displayName)
    .filter(Boolean);
  const current = encounter.order[encounter.turnIndex];
  return `Combat begins. Initiative order: ${describeOrder(encounter)}.${
    actFirst.length
      ? ` ${actFirst.join(" and ")} act${actFirst.length === 1 ? "s" : ""} first: call enemy_attack for each now, then narrate and stop.`
      : ` It is ${current?.name}'s turn; narrate the scene and stop for their action.`
  }`;
}

// Deadlock guard: if combat is stuck collecting initiative with nothing
// pending, roll the stragglers digitally so a fight can never wedge.
export function ensureInitiativeProgress(campaign: Campaign): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || encounter.orderReady) {
    return null;
  }
  if (listOpenPendingRolls(campaign.id).length) {
    return null;
  }
  const staged = new Set(
    encounter.order
      .filter((entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc")
      .map((entry) => entry.characterId),
  );
  const relevantSheets = listSheets(campaign.id).filter((s) => atFight(campaign.id, encounter, s));
  const missing = relevantSheets.filter((sheet) => !staged.has(sheet.id));
  if (!missing.length) {
    return null;
  }
  let note: string | null = null;
  for (const sheet of missing) {
    const outcome = rollExpression(
      d20Expression(computeSheetDerived(sheet).initiative),
    );
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "initiative",
      detail: "initiative",
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    note = recordInitiativeRoll(campaign.id, sheet.id, outcome.total) ?? note;
  }
  return note;
}

// ---- damage_enemy ----

const damageArgsSchema = z.object({
  enemyId: z.string(),
  amount: z.number().int().min(1).max(200),
  type: z.string().optional(),
  reason: z.string().optional(),
});

function handleDamageEnemy(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first." };
  }
  let args: z.infer<typeof damageArgsSchema>;
  try {
    args = damageArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: damage_enemy needs enemyId and amount." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  // Double-apply guard: a damage roll carrying targetEnemyId already landed
  // this hit the moment the dice resolved; a damage_enemy call repeating the
  // same number out of habit must not stack the damage.
  const alreadyApplied = turn.rollIds
    .map((rollId) => getRoll(rollId))
    .some(
      (roll) => roll?.applied && roll.targetEnemyId === enemy.id && roll.total === args.amount,
    );
  if (alreadyApplied) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      note: "That damage was already applied when the roll resolved; nothing more to apply. Narrate from this state.",
    };
  }
  return applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    args.amount,
    sheets,
    sheetsById,
    args.type,
  );
}

// ---- enemy_attack ----

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  // Everyone else caught by a save action (a breath weapon's cone).
  targetCharacterIds: z.array(z.string()).max(12).optional(),
  attack: z.string().optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
});

// What a landed hit does past its damage: a web's restraint and a jaw's
// grapple land outright; a poison or a paralysis is the target's save,
// rolled from their sheet by cast_at_player.
function applyHitEffect(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  attack: EnemyAttack,
  target: CharacterSheet,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const effect = attack.onHit;
  const source = `${enemy.displayName}'s ${attack.name}`;
  const out: Record<string, unknown> = {};
  if (effect?.condition) {
    const applied = applyDmMutation(
      campaign,
      turn.id,
      "set_condition",
      JSON.stringify({ characterId: target.id, condition: effect.condition, reason: source }),
      sheets,
      sheetsById,
    ).result;
    if (!("error" in applied)) {
      out.condition = effect.condition;
      if (effect.escapeDc) {
        out.escape = `DC ${effect.escapeDc}: on their turn ${target.name} can use an action for a Strength (Athletics) or Dexterity (Acrobatics) check (request_roll); on a success clear_condition ${effect.condition}.`;
      }
    }
  }
  if (effect?.save) {
    const save = effect.save;
    out.save = handleCastAtPlayer(
      campaign,
      turn,
      JSON.stringify({
        characterId: target.id,
        source,
        saveAbility: save.ability,
        dc: save.dc,
        ...(save.damage ? { damage: save.damage, damageType: save.damageType, halfOnSave: Boolean(save.half) } : {}),
        ...(save.condition ? { condition: save.condition } : {}),
        ...(save.rounds ? { rounds: save.rounds } : {}),
      }),
      sheets,
      sheetsById,
    );
  }
  return out;
}

// A save action (breath, gaze, roar): every named character rolls their own
// save. Damage alone goes through aoe_damage so it is rolled once for the
// whole area, as printed; a condition goes target by target.
function resolveEnemySave(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  save: EnemySaveAction,
  targets: CharacterSheet[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const outside = targets.filter((sheet) => !atFight(campaign.id, encounter, sheet));
  if (outside.length) {
    return { error: `${outside.map((sheet) => sheet.name).join(", ")} ${outside.length === 1 ? "is" : "are"} not at this fight.` };
  }
  const source = `${enemy.displayName}'s ${save.name}`;
  const resolved = save.condition || !save.damage
    ? {
        results: targets.map((sheet) =>
          handleCastAtPlayer(
            campaign,
            turn,
            JSON.stringify({
              characterId: sheet.id,
              source,
              saveAbility: save.ability,
              dc: save.dc,
              ...(save.damage ? { damage: save.damage, damageType: save.damageType, halfOnSave: Boolean(save.half) } : {}),
              ...(save.condition ? { condition: save.condition } : {}),
              ...(save.rounds ? { rounds: save.rounds } : {}),
            }),
            sheets,
            sheetsById,
          ),
        ),
      }
    : applyExtraEncounterCall(
        campaign,
        turn,
        "aoe_damage",
        JSON.stringify({
          damage: save.damage,
          type: save.damageType,
          saveAbility: save.ability,
          dc: save.dc,
          halfOnSave: Boolean(save.half),
          characterIds: targets.map((sheet) => sheet.id),
          casterEnemyId: enemy.id,
          reason: source,
        }),
        sheets,
        sheetsById,
      )?.result ?? { error: "aoe_damage is unavailable." };
  if ("error" in resolved) {
    return resolved;
  }
  spendAction(enemy, save);
  if (!turn.actedEnemyIds.includes(enemy.id)) {
    turn.actedEnemyIds.push(enemy.id);
  }
  return {
    action: save.name,
    save: `${save.ability.toUpperCase()} DC ${save.dc}`,
    ...(save.area ? { area: save.area } : {}),
    ...resolved,
  };
}

function handleEnemyAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // Only the server fallback may resolve an owed turn after advancing the pointer.
  skippedTurn = false,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof attackArgsSchema>;
  try {
    args = attackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_attack needs enemyId and targetCharacterId." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status} and cannot attack.` };
  }
  if (isJrpgCombat(campaign)) {
    if ((!skippedTurn && currentCombatantId(encounter) !== enemy.id) ||
      !encounter.order.some(entry => entry.kind === "enemy" && entry.enemyId === enemy.id)) {
      return { error: "Only the current encounter participant may take this attack turn." };
    }
    if (listOpenPendingRolls(campaign.id).length) {
      return { error: "Resolve pending rolls before another attack." };
    }
  }
  const stoppedBy = incapacitatedBy(enemy.conditions);
  if (stoppedBy) {
    return {
      error: `${enemy.displayName} is ${stoppedBy} and cannot act this turn.`,
    };
  }
  const staleTarget =
    sheetsById.get(args.targetCharacterId.trim()) ??
    sheets.find(
      (sheet) => sheet.name.toLowerCase() === args.targetCharacterId.trim().toLowerCase(),
    );
  const target = staleTarget ? getSheetById(staleTarget.id) : null;
  if (!target) {
    return { error: "Unknown targetCharacterId; use one from GAME STATE." };
  }
  if (isJrpgCombat(campaign) && !encounter.order.some(entry => entry.kind === "pc" && entry.characterId === target.id)) {
    return { error: "The target is not a participant in this encounter." };
  }
  const picked = pickEnemyAction(enemy, args.attack);
  if ("error" in picked) {
    return picked;
  }
  if ("save" in picked) {
    const others = (args.targetCharacterIds ?? [])
      .map((ref) => resolveSheetRef(ref, sheets, sheetsById))
      .filter((sheet): sheet is CharacterSheet => Boolean(sheet));
    const targets = [target, ...others].filter((sheet, index, all) => all.findIndex((entry) => entry.id === sheet.id) === index);
    return resolveEnemySave(campaign, turn, encounter, enemy, picked.save, targets, sheets, sheetsById);
  }
  const attack = picked.attack;

  // Battle-map positions are authoritative: a melee attacker out of reach
  // auto-approaches along a legal path, a ranged one finds range and sight,
  // and the attack is refused when the target is still out of reach, so
  // narration can never teleport enemies.
  const spatial = approachForAttack(campaign, encounter.id, enemy.id, target.id, attack);
  if (spatial?.blocked) {
    return spatial.blocked;
  }

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source, and so does long range.
  const ranged = spatial?.ranged ?? isRangedAttack(attack);
  const conditionContext = attackContext({
    attackerConditions: enemy.conditions,
    targetConditions: target.conditions,
    melee: !ranged,
    adjacent: !ranged,
    requested: spatial?.far ? mergeAdvantage([args.advantage ?? "none", "disadvantage"]) : args.advantage ?? "none",
  });

  // Multiattack: the full routine executes in this ONE call, each swing its
  // own to-hit and damage dice cards, stopping early if the target drops.
  const advantage: Advantage = conditionContext.advantage;
  // A recharge or per-day action is its own action, never a Multiattack swing.
  const limited = Boolean(attack.recharge || attack.uses);
  const totalSwings = limited ? 1 : Math.max(1, Math.min(3, enemy.stats.attacksPerTurn ?? 1));
  const swings: Array<Record<string, unknown>> = [];
  let dropped = false;
  let totalDamage = 0;
  let targetHp: string | undefined;
  for (let swing = 0; swing < totalSwings && !dropped; swing += 1) {
    const hitOutcome = rollExpression(d20Expression(attack.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: ${attack.name}`,
      advantage,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    turn.rollIds.push(hitRoll.id);

    const natCrit = hitOutcome.crit === "nat20";
    const hit =
      hitOutcome.crit !== "nat1" &&
      (natCrit || hitOutcome.total >= acWithEffects(campaign.id, target));
    const crit = natCrit || (hit && conditionContext.autoCrit);
    if (!hit) {
      swings.push({
        rolled: hitOutcome.total,
        hit: false,
        ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      });
      continue;
    }

    const landed: Record<string, unknown> = { rolled: hitOutcome.total, hit: true, ...(crit ? { crit: true } : {}) };
    swings.push(landed);
    if (attack.damage) {
      const damageExpression = crit
        ? critDamageExpression(attack.damage, 0, {
            powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
            multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
          })
        : attack.damage;
      const damageOutcome = rollExpression(damageExpression);
      const damageRoll = insertRoll({
        campaignId: campaign.id,
        characterId: target.id,
        requestedBy: "dm",
        kind: "damage",
        detail: `${enemy.displayName}: ${attack.name} damage`,
        result: damageOutcome,
      });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
        roll: damageRoll,
        source: "digital",
      });
      turn.rollIds.push(damageRoll.id);

      // Damage lands through the standard mutation: temp HP, clamps, audit,
      // and the live sheet_updated publish all come for free.
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: target.id,
          amount: Math.max(1, damageOutcome.total),
          type: attack.type,
          // Crits against a dying target count double death-save failures.
          ...(crit ? { crit: true } : {}),
          reason: `${enemy.displayName}'s ${attack.name}`,
        }),
        sheets,
        sheetsById,
      ).result;
      totalDamage += damageOutcome.total;
      if (typeof applied.hp === "string") {
        targetHp = applied.hp;
      }
      if (applied.dropped) {
        dropped = true;
      }
      landed.damage = damageOutcome.total;
    }
    if (attack.onHit && !dropped) {
      const effect = applyHitEffect(campaign, turn, enemy, attack, target, sheets, sheetsById);
      Object.assign(landed, effect);
      const saved = effect.save as Record<string, unknown> | undefined;
      if (typeof saved?.hp === "string") {
        targetHp = saved.hp;
      }
      if (saved?.dropped) {
        dropped = true;
      }
    }
  }
  spendAction(enemy, attack);

  // The auto-act fallback in advanceAfterTurn skips enemies that already
  // took their turn here.
  if (!turn.actedEnemyIds.includes(enemy.id)) {
    turn.actedEnemyIds.push(enemy.id);
  }

  return {
    attack: attack.name,
    vsAc: acWithEffects(campaign.id, target),
    target: target.name,
    ...(totalSwings > 1 ? { multiattack: `${totalSwings} attacks` } : {}),
    swings,
    hit: swings.some((entry) => entry.hit),
    ...(totalDamage > 0 ? { totalDamage, damageType: attack.type } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    ...(spatial?.far ? { range: "long range: disadvantage" } : {}),
    ...(limited ? { spent: attack.recharge ? `recharges on a d6 of ${attack.recharge}+` : "a limited use" } : {}),
    ...(targetHp ? { targetHp } : {}),
    ...(dropped ? { dropped: true, note: `${target.name} falls to 0 HP.` } : {}),
  };
}

// ---- end_encounter ----

// Outcome is deliberately a free string: a rejected end_encounter used to
// leave the fight stuck open while the narration declared it over.
// coerceEncounterOutcome maps synonyms and infers from the roster.
const endArgsSchema = z.object({
  outcome: z.string().max(80).optional(),
  reason: z.string().optional(),
});

function handleEndEncounter(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof endArgsSchema>;
  try {
    args = endArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    args = { outcome: undefined };
  }
  const statuses = listEnemies(encounter.id).map((enemy) => enemy.status);
  const { outcome, inferred } = coerceEncounterOutcome(args.outcome, statuses);
  return {
    ok: true,
    ...(inferred
      ? { note: `Outcome "${args.outcome ?? ""}" was not recognized; recorded as ${outcome}.` }
      : {}),
    ...finishEncounter(campaign, turn, encounter, outcome, sheets, sheetsById),
  };
}

// ---- turn resolution marking ----

// Records that a PC's combat turn was adjudicated by a resolving tool this
// DM turn; finalize() only advances the initiative past a PC on this list
// (or with a landed non-initiative roll). Persisted with the turn so a
// parked physical-dice attack still counts when the turn resumes.
function markTurnResolved(turn: DmTurn, sheetId: string) {
  if (!turn.resolvedCharacterIds.includes(sheetId)) {
    turn.resolvedCharacterIds.push(sheetId);
    saveDmTurn(turn);
  }
}

// An attack no longer ends a HUMAN character's initiative turn: they may
// still have movement and a bonus action, so only end_turn (the model's or
// the player's own button) advances past them. Companions are the
// exception: the model plays their whole turn in one go, and marking them
// resolved here keeps the auto-act backstop from swinging a second time.
function markResolvedFromArgs(
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  result: Record<string, unknown>,
) {
  if ("error" in result) {
    return;
  }
  let characterId: string | null = null;
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { characterId?: unknown };
    characterId = typeof parsed.characterId === "string" ? parsed.characterId : null;
  } catch {
    return;
  }
  const sheet = characterId ? resolveSheetRef(characterId, sheets, sheetsById) : null;
  if (sheet?.isCompanion) {
    markTurnResolved(turn, sheet.id);
  }
}

const endTurnArgsSchema = z.object({ characterId: z.string() });

function handleEndTurn(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return { error: "No active encounter with a locked initiative order." };
  }
  let args: z.infer<typeof endTurnArgsSchema>;
  try {
    args = endTurnArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: end_turn needs characterId." };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc" || current.characterId !== sheet.id) {
    return { error: `It is ${current?.name ?? "someone else"}'s turn, not ${sheet.name}'s.` };
  }
  markTurnResolved(turn, sheet.id);
  const floor = getFloor(campaign.id);
  if (floor.mode === "hold" && floor.combat?.characterId === sheet.id) {
    setFloor(campaign.id, { ...floor, combat: { ...floor.combat, mechanicsResolved: true } });
  }
  return {
    ok: true,
    note: "Turn recorded. Narrate the result; the turn passes to the next actor only when you hand it over.",
  };
}

// ---- dispatch ----

export function applyEncounterCall(
  campaign: Campaign,
  turn: DmTurn,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // pc_attack only: physical-dice roster and the call id its parked to-hit
  // roll answers on resume.
  callContext?: { realDiceUserIds: Set<string>; toolCallId: string | null },
): { result: Record<string, unknown> } {
  switch (toolName) {
    case "start_encounter":
      return { result: handleStartEncounter(campaign, rawArguments, sheets) };
    case "pc_attack": {
      const result = handlePcAttack(
        campaign,
        turn,
        rawArguments,
        sheets,
        sheetsById,
        callContext?.realDiceUserIds ?? new Set(),
        callContext?.toolCallId ?? null,
      );
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "cast_at_enemy": {
      const result = handleCastAtEnemy(campaign, turn, rawArguments, sheets, sheetsById);
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "cast_at_player":
      return { result: handleCastAtPlayer(campaign, turn, rawArguments, sheets, sheetsById) };
    case "take_action": {
      const result = handleTakeAction(campaign, turn, rawArguments, sheets, sheetsById);
      markResolvedFromArgs(turn, rawArguments, sheets, sheetsById, result);
      return { result };
    }
    case "use_reaction":
      return { result: handleUseReaction(campaign, turn, rawArguments, sheets, sheetsById) };
    case "end_turn":
      return { result: handleEndTurn(campaign, turn, rawArguments, sheets, sheetsById) };
    case "damage_enemy":
      return { result: handleDamageEnemy(campaign, turn, rawArguments, sheets, sheetsById) };
    case "enemy_attack":
      return { result: handleEnemyAttack(campaign, turn, rawArguments, sheets, sheetsById) };
    case "move_token":
      return { result: handleMoveToken(campaign, rawArguments, sheets, sheetsById) };
    case "end_encounter":
      return { result: handleEndEncounter(campaign, turn, rawArguments, sheets, sheetsById) };
    default:
      return (
        applyExtraEncounterCall(campaign, turn, toolName, rawArguments, sheets, sheetsById) ?? {
          result: { error: `Unknown encounter tool ${toolName}.` },
        }
      );
  }
}

// ---- server-driven turn advancement ----

function advancePointer(
  campaign: Campaign,
  encounter: Encounter,
  options?: { announce?: boolean },
): { enemiesPassed: string[] } | null {
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const next = advanceOrder(
    encounter.order,
    encounter.turnIndex,
    (entry) => entryAlive(entry, enemiesById, (sheet) => atFight(campaign.id, encounter, sheet)),
    surprisedIn(encounter),
  );
  if (!next) {
    return null;
  }
  encounter.turnIndex = next.turnIndex;
  // The action economy belongs to whoever was acting; the next combatant
  // starts clean (src/lib/dm/action-budget.ts).
  encounter.turnBudget = null;
  const incoming = encounter.order[encounter.turnIndex];
  if (incoming) encounter.reactionsUsed = encounter.reactionsUsed.filter(id => id !== orderEntryId(incoming));
  if (next.wrapped) {
    startRound(campaign, encounter);
  }
  encounter.waitingSeq = latestSeq(campaign.id);
  saveEncounter(encounter);
  setInitiativeFloor(campaign, encounter);
  publishEncounter(campaign.id);
  // A held player submission publishes its result first; narration announces
  // the already-selected actor when it opens the gate.
  if (options?.announce !== false) announceCurrentTurn(campaign);
  // Downed PCs the pointer skipped make their death saves now, once per
  // pass, announced to the table as system messages and dice cards.
  for (const characterId of next.pcsPassed) {
    rollDeathSave(campaign, characterId);
  }
  return { enemiesPassed: next.enemiesPassed };
}

// The auto-act fallback: enemies the model skipped this turn take their
// default attack anyway, so an enemy turn can never silently vanish. Runs
// through handleEnemyAttack, so multiattack, auto-approach, conditions, and
// real dice cards all apply; the outcome posts as a system table note the
// model narrates around next turn.
function autoActSkippedEnemies(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemyIds: string[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
) {
  const notes: string[] = [];
  for (const enemyId of enemyIds) {
    if (turn.actedEnemyIds.includes(enemyId)) {
      continue;
    }
    const enemy = resolveEnemyRef(encounter.id, enemyId);
    if (!enemy || enemy.status !== "alive" || isIncapacitated(enemy.conditions)) {
      continue;
    }
    const living = sheets.filter((sheet) => {
      if (!atFight(campaign.id, encounter, sheet)) return false;
      if (isJrpgCombat(campaign) && !encounter.order.some(entry => entry.kind === "pc" && entry.characterId === sheet.id)) return false;
      const fresh = getSheetById(sheet.id);
      return (fresh?.currentHp ?? 0) > 0;
    });
    if (!living.length) {
      break;
    }
    const map = getBattleMapForEncounter(encounter.id);
    const attackerToken = map ? getTokenByRef(map.id, enemy.id) : null;
    const enemyOrderIndex = encounter.order
      .filter((entry) => entry.kind === "enemy")
      .findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id);
    const targetId = pickEnemyTarget(
      attackerToken ? { x: attackerToken.x, y: attackerToken.y } : null,
      living.map((sheet) => {
        const token = map ? getTokenByRef(map.id, sheet.id) : null;
        return {
          characterId: sheet.id,
          ac: acWithEffects(campaign.id, sheet),
          position: token ? { x: token.x, y: token.y } : null,
        };
      }),
      !isJrpgCombat(campaign),
      encounter.round - 1 + Math.max(0, enemyOrderIndex),
    );
    if (!targetId) {
      break;
    }
    const result = handleEnemyAttack(
      campaign,
      turn,
      JSON.stringify({ enemyId: enemy.id, targetCharacterId: targetId }),
      sheets,
      sheetsById,
      true,
    );
    const targetName = sheetsById.get(targetId)?.name ?? "a hero";
    if ("error" in result) {
      // Out of reach or otherwise unable: the skipped turn passes quietly.
      continue;
    }
    const swings = Array.isArray(result.swings) ? (result.swings as Array<Record<string, unknown>>) : [];
    const summary = swings
      .map((swing) =>
        swing.hit
          ? `${swing.rolled} vs AC ${result.vsAc}: HIT${swing.damage === undefined ? "" : ` for ${swing.damage}`}${swing.crit ? " (CRIT)" : ""}${swing.condition ? `, ${swing.condition}` : ""}`
          : `${swing.rolled} vs AC ${result.vsAc}: miss`,
      )
      .join("; ");
    notes.push(
      `${enemy.displayName} attacks ${targetName} with ${String(result.attack)} (${summary}).${
        result.dropped ? ` ${targetName} falls!` : ""
      }`,
    );
  }
  if (notes.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      content: `Skipped enemy turns resolve automatically: ${notes.join(" ")}`,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
    saveDmTurn(turn);
  }
}

// Called from finalize() on a successful DM turn: the pointer moves only
// when the current PC's turn was actually adjudicated this DM turn (a
// resolving tool like pc_attack or cast_at_enemy ran for them, a
// non-initiative roll of theirs landed, or the model called end_turn), so
// table talk and questions never steal anyone's turn. Enemies the pointer
// passes that the model never attacked with auto-act via the server
// fallback.
export function advanceAfterTurn(campaign: Campaign, turn?: DmTurn, options?: { announce?: boolean }) {
  const held = getFloor(campaign.id);
  // A bundle is held while the DM adjudicates it. end_turn may move the
  // pointer, but narration still owns the public handoff and floor release.
  const floor = held.mode === "hold" && held.combat?.requiresEndTurn && held.combat.mechanicsResolved
    ? held.next
    : held;
  if (floor.mode !== "initiative") {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady || encounter.id !== floor.encounterId) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  // Only an explicit end_turn (the model's call, the player's End Turn
  // button, or the companion auto-act) resolves a turn now: attacks and
  // landed rolls leave the floor with the character, because they may still
  // have movement or a bonus action to spend.
  const resolved = turn !== undefined && turn.resolvedCharacterIds.includes(current.characterId);
  if (!resolved) {
    // AI companion turn the model never adjudicated: the server takes the
    // basic action (like skipped enemies), so combat cannot wedge on a
    // combatant no human controls.
    if (turn && isCompanionUserId(current.userId)) {
      companionAutoAct(campaign, turn, encounter, current.characterId);
    } else {
      return;
    }
  }
  const advanced = advancePointer(campaign, encounter, options);
  if (advanced && turn) {
    const sheets = listSheets(campaign.id).filter(sheet => atFight(campaign.id, encounter, sheet));
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    autoActSkippedEnemies(
      campaign,
      turn,
      encounter,
      advanced.enemiesPassed,
      sheets,
      sheetsById,
    );
  }
  // The pointer now rests on an AI companion: wake the DM so the model can
  // play their turn with real tactics; if that turn ends without resolving
  // them, the auto-act above is the safety net.
  if (advanced) {
    const next = encounter.order[encounter.turnIndex];
    if (next?.kind === "pc" && isCompanionUserId(next.userId)) {
      wakeDm(campaign.id);
    }
  }
}

export function announceCurrentTurn(campaign: Campaign): void {
  const encounter = getActiveEncounter(campaign.id);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
  if (!encounter || !current) return;
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: `It is now ${current.name}'s turn (round ${encounter.round}).`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// The companion analog of autoActSkippedEnemies: nearest living enemy,
// basic attack through the full pc_attack engine (range checks, conditions,
// advantage, damage application), outcome posted as a table note. The turn
// counts as resolved even when the attack is out of reach, so initiative
// always moves on.
function companionAutoAct(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  characterId: string,
) {
  markTurnResolved(turn, characterId);
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.currentHp <= 0 || isIncapacitated(sheet.conditions)) {
    return;
  }
  const enemies = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive");
  if (!enemies.length) {
    return;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const myToken = map ? getTokenByRef(map.id, sheet.id) : null;
  let target = enemies[0];
  if (!isJrpgCombat(campaign) && map && myToken) {
    let best = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const token = getTokenByRef(map.id, enemy.id);
      if (!token) {
        continue;
      }
      const distance = Math.max(Math.abs(token.x - myToken.x), Math.abs(token.y - myToken.y));
      if (distance < best) {
        best = distance;
        target = enemy;
      }
    }
  }
  const result = handlePcAttack(
    campaign,
    turn,
    JSON.stringify({ characterId: sheet.id, targetEnemyId: target.id }),
    [sheet],
    new Map([[sheet.id, sheet]]),
    new Set<string>(),
    null,
  );
  const note =
    "error" in result
      ? `${sheet.name} cannot reach an enemy this round and holds position.`
      : result.hit
        ? `${sheet.name} attacks ${target.displayName} with ${String(result.weapon ?? "their weapon")} and hits for ${String(result.damage)} damage${result.dead ? `, slaying ${target.displayName}!` : "."}`
        : `${sheet.name} attacks ${target.displayName} but misses.`;
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: `${sheet.name}'s turn resolves automatically: ${note}`,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  saveDmTurn(turn);
}

// Self-service turn end: the current player declares their combat turn done
// (attack landed, movement spent or declined). Same shape as the lead skip
// below; the caller wakes the DM so intervening enemies still act.
export function endOwnTurn(campaignId: string, userId: string, skipped = false): boolean {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  const floor = getFloor(campaignId);
  if (!campaign || campaign.status !== "active" || !encounter || !encounter.orderReady ||
    floor.mode !== "initiative" || listOpenPendingRolls(campaignId).length) {
    return false;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc" || current.userId !== userId) {
    return false;
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "player",
    userId,
    characterId: current.characterId,
    content: `[combat turn intent] ${current.name}: ${skipped ? "skip this turn" : "end turn"}.\n[end turn requested]`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  const held = { mode: "hold" as const, next: floor, combat: {
    encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex,
    characterId: current.characterId, submissionMessageId: message.id, requiresEndTurn: true, mechanicsResolved: false,
    heldAt: new Date().toISOString(),
  } };
  setFloor(campaignId, held);
  publishPersisted(campaignId, "floor_changed", { floor: held });
  publishPersisted(campaignId, "dm_intent_queued", { messageId: message.id, userId, characterId: current.characterId, seq });
  return true;
}

// Consume exactly one persisted Skip N when its owner's initiative arrives.
// The normal adjudication cycle resolves this automatic intent; pending
// physical dice leave the turn untouched.
export function skipOwnTurn(campaignId: string, userId: string): boolean {
  const member = getMember(campaignId, userId);
  if (!member || member.skipTurnsCount <= 0 || !endOwnTurn(campaignId, userId, true)) return false;
  const updated = setMemberSkipTurns(campaignId, userId, member.skipTurnsCount - 1);
  publishPersisted(campaignId, "member_updated", { member: updated });
  return true;
}

// Queue only one skipped intent. Its normal end_turn + narration cycle owns
// enemy actions and then queues the next one; never fast-forward a whole round.
export function queueSkippedCombatTurn(campaignId: string): void {
  const floor = getFloor(campaignId);
  if (floor.mode === "initiative" && floor.userIds[0] && skipOwnTurn(campaignId, floor.userIds[0])) wakeDm(campaignId);
}

// Call after any move. Boards follow who is at each fight; a hero who walks
// out on their own turn hands it on (the DM then plays enemies passed).
export function syncFightRosters(campaignId: string): string[] {
  const { notes, leftOnTheirTurn } = syncFightBoards(campaignId);
  for (const encounter of leftOnTheirTurn) {
    const leaving = encounter.order[encounter.turnIndex]?.name;
    const pass = () => skipCurrentTurn(campaignId, "left");
    // Without rooms there is one fight, the campaign's own.
    if (!(encounter.roomId ? withEncounterRoom(campaignId, encounter.roomId, pass) : pass())) continue;
    const after = getActiveEncounter(campaignId, encounter.roomId);
    notes.push(`It was ${leaving}'s turn; it passed to ${after?.order[after.turnIndex]?.name ?? "the next combatant"}. Play any enemies before them.`);
  }
  return notes;
}

// Lead escape hatch: advance past an absent player's turn. Inserts a table
// note; the caller wakes the DM so intervening enemies still act (kept out
// of this module to avoid an import cycle with the turn loop).
export function skipCurrentTurn(campaignId: string, reason: "lead" | "left" = "lead"): boolean {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  if (!campaign || !encounter || !encounter.orderReady) {
    return false;
  }
  const skipped = encounter.order[encounter.turnIndex];
  if (!advancePointer(campaign, encounter, { announce: false })) {
    return false;
  }
  const next = encounter.order[encounter.turnIndex];
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `${reason === "left" ? `${skipped?.name ?? "Someone"} left the fight.` : `The party lead skipped ${skipped?.name ?? "the current"}'s turn.`}${
      next ? ` It is now ${next.name}'s turn.` : ""
    }`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  return true;
}
