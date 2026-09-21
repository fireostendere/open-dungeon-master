import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { gameSettingsSchema } = await import("../src/lib/schemas/game-settings.ts");
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");

const defaults = gameSettingsSchema.parse({});
assert.equal(defaults.enemyHpVisibility, "state");
assert.equal(defaults.enemyConditionVisibility, "status_turns");
assert.equal(gameSettingsSchema.safeParse({ enemyHpVisibility: "wallhack" }).success, false);
assert.equal(gameSettingsSchema.safeParse({ enemyConditionVisibility: "forever" }).success, false);

const encounter = {
  id: "encounter",
  status: "active",
  round: 2,
  turnIndex: 0,
  orderReady: true,
  order: [{ kind: "enemy", enemyId: "enemy", name: "Burning Guard", initiative: 14 }],
  turnBudget: null,
};

const enemy = {
  id: "enemy",
  encounterId: "encounter",
  campaignId: "campaign",
  slug: "guard",
  displayName: "Burning Guard",
  maxHp: 40,
  currentHp: 20,
  ac: 16,
  initiative: 14,
  status: "alive",
  cr: 1,
  xp: 200,
  conditions: ["burning", "frightened"],
  conditionMeta: { burning: { rounds: 2 }, frightened: { rounds: 1 } },
  concentration: null,
  stats: { type: "humanoid" },
};

function projected(options) {
  return publicEncounter(encounter, [enemy], options).enemies[0];
}

const legacy = projected({ enemyHpVisibility: "state", enemyConditionVisibility: "status_turns" });
assert.equal(legacy.health, "bloodied");
assert.equal(legacy.hpPercent, undefined);
assert.equal(legacy.currentHp, undefined);
assert.deepEqual(legacy.conditions, ["burning", "frightened"]);
assert.deepEqual(legacy.conditionRounds, { burning: 2, frightened: 1 });

const hidden = projected({ enemyHpVisibility: "state", enemyConditionVisibility: "hidden" });
assert.deepEqual(hidden.conditions, []);
assert.deepEqual(hidden.conditionRounds, {});

const statusOnly = projected({ enemyHpVisibility: "bar", enemyConditionVisibility: "status" });
assert.equal(statusOnly.hpPercent, 50);
assert.equal(statusOnly.currentHp, undefined);
assert.deepEqual(statusOnly.conditions, ["burning", "frightened"]);
assert.deepEqual(statusOnly.conditionRounds, {});

const exact = projected({ enemyHpVisibility: "exact", enemyConditionVisibility: "status_turns" });
assert.equal(exact.hpPercent, 50);
assert.equal(exact.currentHp, 20);
assert.equal(exact.maxHp, 40);
assert.equal(exact.ac, undefined, "player exact-HP mode must not reveal AC");
assert.equal(exact.initiative, undefined, "player exact-HP mode must not reveal initiative");

const dm = projected({
  enemyNumbers: true,
  enemyHpVisibility: "state",
  enemyConditionVisibility: "hidden",
});
assert.equal(dm.hpPercent, 50);
assert.equal(dm.currentHp, 20);
assert.equal(dm.maxHp, 40);
assert.equal(dm.ac, 16);
assert.equal(dm.initiative, 14);
assert.deepEqual(dm.conditions, ["burning", "frightened"]);
assert.deepEqual(dm.conditionRounds, { burning: 2, frightened: 1 });

const settingsUi = fs.readFileSync(
  new URL("../src/app/campaigns/[campaignId]/GameSettingsPanel.tsx", import.meta.url),
  "utf8",
);
assert.match(settingsUi, /enemyHpVisibility/);
assert.match(settingsUi, /enemyConditionVisibility/);
assert.match(settingsUi, /value="state"/);
assert.match(settingsUi, /value="bar"/);
assert.match(settingsUi, /value="exact"/);
assert.match(settingsUi, /value="hidden"/);
assert.match(settingsUi, /value="status"/);
assert.match(settingsUi, /value="status_turns"/);

const encounterUi = fs.readFileSync(
  new URL("../src/app/campaigns/[campaignId]/EncounterPanel.tsx", import.meta.url),
  "utf8",
);
assert.match(encounterUi, /role="progressbar"/);
assert.match(encounterUi, /enemy\.conditionRounds/);

const streamUi = fs.readFileSync(
  new URL("../src/app/campaigns/[campaignId]/useCampaignStream.ts", import.meta.url),
  "utf8",
);
assert.match(streamUi, /enemyHpVisibility/);
assert.match(streamUi, /enemyConditionVisibility/);
assert.match(streamUi, /refreshEncounter\(\)/);

console.log("combat visibility settings: passed");
