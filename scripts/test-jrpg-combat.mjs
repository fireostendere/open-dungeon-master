import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewModule } from "./lib/review-module.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { isJrpgCombat } = await import("../src/lib/dm/combat-mode.ts");
const { pickEnemyTarget } = await import("../src/lib/dm/encounter-logic.ts");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = { id: "map", terrain: "..........", width: 10, height: 1 };
const tokens = new Map([
  ["pc", { id: "pc-token", refId: "pc", name: "Hero", x: 1, y: 0, movedThisRound: 0 }],
  ["enemy", { id: "enemy-token", refId: "enemy", name: "Ogre", x: 8, y: 0, movedThisRound: 0 }],
  ["ally", { id: "ally-token", kind: "pc", refId: "ally", name: "Ally", x: 7, y: 0, movedThisRound: 0 }],
]);
let moves = 0;
const mapTools = loadReviewModule(path.join(root, "src/lib/dm/map-tools.ts"), {
  "@/lib/db/encounters": { getActiveEncounter: () => null, listEnemies: () => [] },
  "@/lib/db/battle-maps": {
    getBattleMapForEncounter: () => map,
    getTokenByRef: (_mapId, refId) => tokens.get(refId) ?? null,
    listTokens: () => [...tokens.values()], moveToken: () => { moves += 1; },
    createBattleMap: () => null, placeTokens: () => null,
  },
  "@/lib/battlemap/generate": { generateBattleMap: () => null, fnv1a: () => 1 },
  "@/lib/battlemap/movement": { findPath: () => null, speedToTiles: () => 6, walkPathWithBudget: () => null },
  "@/lib/battlemap/los": { coverBetween: () => 5, hasLineOfSight: () => false },
  "@/lib/battlemap/tactics": { bestFiringPosition: () => null },
  "@/lib/battlemap/view": { occupiedTiles: () => new Set() },
  "@/lib/db/locations": { getCurrentLocation: () => null },
  "@/lib/events": { publishEphemeral: () => null },
  "@/lib/dm/rolls": { resolveSheetRef: () => null },
  "@/lib/dm/opportunity": { resolvePcOpportunityAttacks: () => [] },
  "@/lib/dm/condition-logic": { effectiveSpeed: () => 1 },
});
const classical = { id: "classic", gameSettings: { combatMode: "classical" } };
const jrpg = { id: "jrpg", gameSettings: { combatMode: "jrpg" } };

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("JRPG mode is opt-in and legacy settings remain classical", () => {
  assert.equal(isJrpgCombat({ gameSettings: {} }), false);
  assert.equal(isJrpgCombat({ gameSettings: { combatMode: "classical" } }), false);
  assert.equal(isJrpgCombat({ gameSettings: { combatMode: "jrpg" } }), true);
});

test("JRPG enemy target fallback ignores map distance but retains valid-target AC selection", () => {
  const candidates = [
    { characterId: "near-high-ac", ac: 18, position: { x: 1, y: 0 } },
    { characterId: "far-low-ac", ac: 12, position: { x: 99, y: 99 } },
  ];
  assert.equal(pickEnemyTarget({ x: 0, y: 0 }, candidates), "near-high-ac");
  assert.equal(pickEnemyTarget({ x: 0, y: 0 }, candidates, false), "far-low-ac");
});

test("PC and enemy attack spatial gates are bypassed only in JRPG", () => {
  const options = { ranged: false, thrown: false, rangeTiles: 6, reachTiles: 1 };
  assert.match(mapTools.checkPcAttackRange(classical, "encounter", "pc", "enemy", options), /out of melee reach/);
  assert.equal(mapTools.checkPcAttackRange(jrpg, "encounter", "pc", "enemy", options), null);
  assert.deepEqual(
    mapTools.pcAttackSpatials(classical, "encounter", "pc", "enemy", options),
    { cover: 5, longRange: false },
  );
  assert.deepEqual(
    mapTools.pcAttackSpatials(jrpg, "encounter", "pc", "enemy", options),
    { cover: 0, longRange: false },
  );
  assert.equal(mapTools.approachForAttack(jrpg, "encounter", "enemy", "pc", "Club"), null);
  assert.equal(moves, 0);
  assert.equal(mapTools.allyAdjacentToEnemy(classical, "encounter", "pc", "enemy"), true);
  assert.equal(mapTools.allyAdjacentToEnemy(jrpg, "encounter", "pc", "enemy"), false);
});

test("JRPG auras cover encounter participants without leaking to the rest of the campaign", () => {
  let campaign = jrpg;
  const aura = loadReviewModule(path.join(root, "src/lib/dm/aura.ts"), {
    "@/lib/db/campaigns": { getCampaignById: () => campaign },
    "@/lib/db/encounters": { getActiveEncounter: () => ({ order: [{ kind: "pc", characterId: "pc" }, { kind: "pc", characterId: "paladin" }] }) },
    "@/lib/db/battle-maps": { getBattleMapForEncounter: () => null, getTokenByRef: () => null },
    "@/lib/db/sheets": { listSheets: () => [
      { id: "paladin", name: "Paladin", currentHp: 30, level: 6, features: [{ bonus: 3 }] },
      { id: "elsewhere", name: "Elsewhere", currentHp: 30, level: 20, features: [{ bonus: 5 }] },
    ] },
    "@/lib/srd": { computeSheetDerived: () => ({ abilityMods: {} }) },
    "@/lib/srd/feature-effects": { defenseRiders: ({ features }) => ({ saveBonus: features[0].bonus }) },
  });
  assert.equal(aura.allySaveAura("campaign", { id: "pc" }).bonus, 3);
  assert.equal(aura.allySaveAura("campaign", { id: "elsewhere" }), null);
  campaign = classical;
  assert.equal(aura.allySaveAura("campaign", { id: "pc" }), null);
});

console.log(`jrpg combat: ${passed} passed`);
