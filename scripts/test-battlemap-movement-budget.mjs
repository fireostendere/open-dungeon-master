import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { movementBudget } = await import("../src/lib/battlemap/movement-budget.ts");

const sheet = (overrides = {}) => ({
  class: "fighter",
  speed: 30,
  conditions: [],
  exhaustion: 0,
  equipment: [],
  proficiencies: { armor: [], weapons: [], saves: [], skills: [], languages: [], tools: [] },
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  features: [],
  level: 1,
  ac: 10,
  ...overrides,
});

assert.equal(movementBudget({ sheet: sheet(), movedThisRound: 2, dashed: true }).remaining, 10);
assert.equal(movementBudget({ sheet: sheet({ conditions: ["restrained"] }), movedThisRound: 0 }).remaining, 0);
assert.equal(movementBudget({ sheet: sheet({ exhaustion: 2 }), movedThisRound: 0 }).remaining, 3);
console.log("battlemap-movement-budget: 3 tests passed");
