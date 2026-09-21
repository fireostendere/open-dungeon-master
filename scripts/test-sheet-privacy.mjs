import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { projectSheetForViewer } = await import("../src/lib/sheet-privacy.ts");

const base = {
  id: "sheet", campaignId: "c", userId: "owner", libraryCharacterId: null,
  name: "Hero", race: "human", class: "fighter", subclass: "", background: "",
  alignment: "", gender: "", level: 1, xp: 0,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  maxHp: 10, currentHp: 10, tempHp: 0, ac: 10, acOverride: false, speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 }, classes: [], hitDicePools: null,
  proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
  equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
  conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [],
  exhaustion: 0, deathSaves: null, concentratingOn: null, portrait: null,
  notes: "OWNER_PRIVATE_NOTE", backstory: "PUBLIC_BACKSTORY",
  isCompanion: false, companionKind: null, personality: "",
  createdAt: "", updatedAt: "",
};

test("sheet notes are visible only to their owner", () => {
  assert.equal(projectSheetForViewer(base, "owner").notes, "OWNER_PRIVATE_NOTE");
  assert.equal(projectSheetForViewer(base, "other").notes, "");
  assert.equal(projectSheetForViewer(base, "dm", { adjudicates: true }).notes, "");
  assert.equal(projectSheetForViewer(base, "other").backstory, "PUBLIC_BACKSTORY");
});

test("companion personality is DM-only", () => {
  const companion = { ...base, userId: "bot", isCompanion: true, companionKind: "party", personality: "DM_ONLY_MOTIVE" };
  assert.equal(projectSheetForViewer(companion, "player").personality, "");
  assert.equal(projectSheetForViewer(companion, "dm", { adjudicates: true }).personality, "DM_ONLY_MOTIVE");
});
