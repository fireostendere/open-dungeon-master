import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveDndPlayMode, explicitYoloRequested } from "../shared/dnd-play-mode.mjs";
import { parseGameFacadeArgs, YOLO_GAME_TOOL_NAME } from "../shared/dnd-game-facade.mjs";
import { resolveNarratorPlayMode, filterNarratorCatalog } from "../narrator/runtime-mode.mjs";
import { NarratorOrchestrator, validateDecision } from "../narrator/orchestration.mjs";
import { OpenCodeAdapter } from "../narrator/opencode-adapter.mjs";

const turnSource = fs.readFileSync(new URL("../src/lib/dm/turn.ts", import.meta.url), "utf8");
const promptSource = fs.readFileSync(new URL("../src/lib/dm/prompt.ts", import.meta.url), "utf8");
const toolTextSource = fs.readFileSync(new URL("../src/lib/dm/tool-text.ts", import.meta.url), "utf8");
assert.match(turnSource, /const tools = \[buildGameEngineTool\(innerTools\)\]/);
assert.match(turnSource, /parseGenerateImageToolCall\(effectiveToolCalls\)/);
assert.match(turnSource, /if \(call\.name !== "game"\) return \[call\]/);
assert.doesNotMatch(turnSource, /const tools = yolo\s*\?/);
assert.match(promptSource, /GAME_ENGINE_FACADE_SYSTEM/);
assert.match(toolTextSource, /"game\|request_roll\|/);

const clean = {};
assert.equal(resolveDndPlayMode({ source: "internal", env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "external", env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: clean }), "full");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", requested: true, env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: { ODM_DND_MODE: "yolo" } }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: { YOLO_DND: "1" } }), "yolo");
assert.equal(resolveDndPlayMode({ source: "external", env: { ODM_DND_MODE: "full", YOLO_DND: "0" } }), "yolo");
assert.equal(explicitYoloRequested({ env: { YOLO_DND: "true" } }), true);

const generic = { generate: async () => "{}" };
const custom = { runtimeSource: "custom-opencode", generate: async () => "{}" };
assert.equal(resolveNarratorPlayMode(generic, { env: clean }), "yolo");
assert.equal(resolveNarratorPlayMode(custom, { env: clean }), "full");
assert.equal(resolveNarratorPlayMode(custom, { requested: true, env: clean }), "yolo");

const full = new NarratorOrchestrator({ adapter: custom, startAfterSeq: 0 });
assert.equal(full.playMode, "full");
assert.equal(full.maxSteps, 24);

const yolo = new NarratorOrchestrator({ adapter: custom, startAfterSeq: 0, yolo: true });
assert.equal(yolo.playMode, "yolo");
assert.equal(yolo.maxSteps, 6);

const other = new NarratorOrchestrator({ adapter: generic, startAfterSeq: 0 });
assert.equal(other.playMode, "yolo");
assert.equal(other.maxSteps, 6);

const filtered = filterNarratorCatalog([
  {
    category: "combat",
    label: "Combat",
    entries: [
      { name: "pc_attack", label: "Player attacks", fields: [{ name: "characterId", required: true, kind: "character" }, { name: "enemyId", required: true, kind: "enemy" }] },
      { name: "end_turn", label: "End turn", fields: [] },
    ],
  },
  {
    category: "social",
    label: "Social",
    entries: [
      { name: "romance_advance", label: "Romance", fields: [] },
      { name: "record_event", label: "Record event", fields: [{ name: "summary", required: true, kind: "text" }] },
    ],
  },
], "yolo");
assert.equal(filtered.length, 1);
assert.equal(filtered[0].actions.length, 1);
assert.equal(filtered[0].actions[0].name, YOLO_GAME_TOOL_NAME);
assert.deepEqual(filtered[0].actions[0].operations.map(operation => operation.name), [
  "pc_attack",
  "end_turn",
  "record_event",
]);
assert.deepEqual(filtered[0].actions[0].operations[0].fields, [
  { name: "characterId", required: true, kind: "character" },
  { name: "enemyId", required: true, kind: "enemy" },
]);

const fullFacade = filterNarratorCatalog([
  {
    category: "social",
    label: "Social",
    actions: [
      { name: "request_roll", label: "Roll" },
      { name: "romance_advance", label: "Romance" },
    ],
  },
], "full");
assert.equal(fullFacade.length, 1);
assert.equal(fullFacade[0].actions.length, 1);
assert.equal(fullFacade[0].actions[0].name, YOLO_GAME_TOOL_NAME);
assert.deepEqual(
  fullFacade[0].actions[0].operations.map(operation => operation.name),
  ["request_roll", "romance_advance"],
);

const parsed = parseGameFacadeArgs(
  { action: "pc_attack", args: { characterId: "pc-1", enemyId: "enemy-1" } },
  new Set(["pc_attack"]),
);
assert.deepEqual(parsed, {
  ok: true,
  action: "pc_attack",
  args: { characterId: "pc-1", enemyId: "enemy-1" },
});
assert.equal(parseGameFacadeArgs({ action: "romance_advance", args: {} }, new Set(["pc_attack"])).ok, false);

assert.deepEqual(
  validateDecision(
    { kind: "invoke", action: "game", args: { action: "pc_attack", args: {} } },
    { allowedActions: new Set(["game"]), catalogActions: new Set(["pc_attack"]) },
  ),
  { kind: "invoke", action: "game", args: { action: "pc_attack", args: {} } },
);
assert.throws(
  () => validateDecision(
    { kind: "invoke", action: "pc_attack", args: {} },
    { allowedActions: new Set(["game"]), catalogActions: new Set(["pc_attack"]) },
  ),
  /Disallowed engine action/,
);
assert.deepEqual(
  validateDecision(
    { kind: "catalog", action: "pc_attack" },
    { allowedActions: new Set(["game"]), catalogActions: new Set(["pc_attack"]) },
  ),
  { kind: "catalog", action: "pc_attack" },
);

const adapter = new OpenCodeAdapter({
  endpoint: "http://127.0.0.1:4096",
  workspace: "/tmp/odm-yolo-routing-test",
  model: { providerID: "test", id: "model" },
  fetchImpl: async () => { throw new Error("network must not be used"); },
});
assert.equal(adapter.runtimeSource, "custom-opencode");
assert.equal(resolveNarratorPlayMode(adapter, { env: clean }), "full");

console.log("yolo routing: ok");
