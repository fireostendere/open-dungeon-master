import assert from "node:assert/strict";
import { resolveDndPlayMode, explicitYoloRequested } from "../src/lib/dm/play-mode.mjs";
import { resolveNarratorPlayMode, filterNarratorCatalog } from "../narrator/runtime-mode.mjs";
import { NarratorOrchestrator } from "../narrator/orchestration.mjs";
import { OpenCodeAdapter } from "../narrator/opencode-adapter.mjs";

const clean = {};
assert.equal(resolveDndPlayMode({ source: "internal", env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "external", env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: clean }), "full");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", requested: true, env: clean }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: { ODM_DND_MODE: "yolo" } }), "yolo");
assert.equal(resolveDndPlayMode({ source: "custom-opencode", env: { YOLO_DND: "1" } }), "yolo");
// A non-OpenCode client cannot promote itself into the expensive full path.
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
  { category: "combat", label: "Combat", actions: [{ name: "pc_attack" }, { name: "end_turn" }] },
  { category: "social", label: "Social", actions: [{ name: "romance_advance" }, { name: "record_event" }] },
], "yolo");
assert.deepEqual(filtered, [
  { category: "combat", label: "Combat", actions: [{ name: "pc_attack" }, { name: "end_turn" }] },
  { category: "social", label: "Social", actions: [{ name: "record_event" }] },
]);

const adapter = new OpenCodeAdapter({
  endpoint: "http://127.0.0.1:4096",
  workspace: "/tmp/odm-yolo-routing-test",
  model: { providerID: "test", id: "model" },
  fetchImpl: async () => { throw new Error("network must not be used"); },
});
assert.equal(adapter.runtimeSource, "custom-opencode");
assert.equal(resolveNarratorPlayMode(adapter, { env: clean }), "full");

console.log("yolo routing: ok");
