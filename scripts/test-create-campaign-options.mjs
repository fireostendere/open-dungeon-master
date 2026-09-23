// The new-campaign dialog must offer every game setting a table would want to
// decide up front. It used to send only a subset, and gameSettingsSchema is
// .partial() at the API, so an omitted field silently took its default and
// nobody could see it. This asserts against the dialog's source so a setting
// added later cannot quietly go missing again.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { gameSettingsSchema } = await import("../src/lib/schemas/game-settings.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(scriptsDir, relative), "utf8");

const dialog = read("../src/app/CreateCampaignDialog.tsx");
const worldSetup = read("../src/app/WorldSetupFields.tsx");
const rulesPanel = read("../src/app/campaigns/[campaignId]/RulesPanel.tsx");
const advancedStep = read("../src/app/create-campaign/AdvancedStep.tsx");
const creationSurface = `${dialog}\n${worldSetup}\n${rulesPanel}\n${advancedStep}`;
const creationRoute = read("../src/app/api/campaigns/route.ts");

// Fields intentionally absent from creation fall into two categories:
// 1) live-table/operator controls (globalTurn, visibility, beatReminder, targetParty);
// 2) retired server-hosted AI/media controls that normalize off and must not
//    reappear in the browser contract.
const DELIBERATELY_OMITTED = new Set([
  "stages",
  "beatReminder",
  "dmAssist",
  "targetParty",
  "globalTurn",
  "combatInputMode",
  "enemyHpVisibility",
  "enemyConditionVisibility",
  "aiStorySetup",
  "ttsEnabled",
  "ttsVoice",
  "mapsEnabled",
  "narrationGuard",
]);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A key counts as offered only where it stands as its own identifier or
// property token (`voice:`, `voice,`, `voice}`). A bare substring test let
// "voice" pass for as long as the dialog had a `(voice) =>` TTS loop, while
// the actual voice settings were never offered at creation.
function offeredAtCreation(key) {
  // Language is selected in the shared UI and inherited by the creation route.
  const surface = key === "language" ? `${creationSurface}\n${creationRoute}` : creationSurface;
  return new RegExp(`(?<![.\\w$])${key}(?=\\s*[:,}])`).test(surface);
}

test("every game setting except the omitted ones is offered at creation", () => {
  const keys = Object.keys(gameSettingsSchema.shape);
  assert.ok(keys.length > 20, "the settings schema looks wrong; the shape is nearly empty");
  const missing = keys.filter((key) => !DELIBERATELY_OMITTED.has(key) && !offeredAtCreation(key));
  assert.deepEqual(missing, [], "these game settings are not offered at creation");
});

test("retired hosted-AI/media controls do not return to campaign creation", () => {
  assert.doesNotMatch(dialog, /\/api\/capabilities/);
  for (const key of ["aiStorySetup", "ttsEnabled", "ttsVoice", "mapsEnabled", "narrationGuard"]) {
    assert.doesNotMatch(dialog, new RegExp(`\\b${key}\\b`), `${key} leaked back into CreateCampaignDialog`);
  }
  assert.match(dialog, /dmMode:\s*"human"/, "new campaigns must stay on the human\/external narrator boundary");
});

test("the dialog sends the settings it collects", () => {
  for (const key of ["relationships", "romance", "variantRules", "worldPack", "combatMode", "campaignLength", "worldSimulation", "companions"]) {
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(dialog),
      `${key} is never referenced in CreateCampaignDialog`,
    );
  }
});

test("combat mode defaults to classical and rejects invalid values", () => {
  assert.equal(gameSettingsSchema.parse({}).combatMode, "classical");
  assert.equal(gameSettingsSchema.safeParse({ combatMode: "freeform" }).success, false);
});

test("romance cannot be sent on while bonds are off", () => {
  // Romance rides on the bond meter, so the payload has to gate it.
  assert.match(
    dialog,
    /romance:\s*relationships === "off" \? "off" : romance/,
    "the dialog can post romance on with relationships off",
  );
});

console.log(`test-create-campaign-options: ${passed} passed`);
