import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { normalizeArgs } = await import("../src/lib/dm/invoke.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");

const start = adjudication("start_encounter");
const add = adjudication("add_enemies");
assert.ok(start);
assert.ok(add);

const bartender = { monster: "rogue", name: "Бармен", count: 1, cr: 2 };
const guards = { monster: "guard", name: "Охранник", count: 2 };

const startNormalized = normalizeArgs(start, {
  enemies: [bartender, guards],
  summary: "The tavern erupts into a fight.",
});
assert.deepEqual(
  startNormalized.enemies,
  [bartender, guards],
  "structured combatants must retain in-world names and mechanical overrides",
);

const addNormalized = normalizeArgs(add, {
  enemies: [{ monster: "bandit", name: "Седой охранник", count: 1 }],
});
assert.deepEqual(addNormalized.enemies, [
  { monster: "bandit", name: "Седой охранник", count: 1 },
]);

// Human-console/prepared-encounter shorthand still uses the old roster parser.
assert.deepEqual(normalizeArgs(start, { enemies: "goblin x2\nhobgoblin" }).enemies, [
  { monster: "goblin", count: 2 },
  { monster: "hobgoblin", count: 1 },
]);

console.log("combat narrative identity: preserved");
