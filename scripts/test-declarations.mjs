// The spell book panel's picks (src/lib/dm/declarations.ts): what the server
// accepts from the sheet and the canonical lines the narrator reads.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { MAX_DECLARATIONS, validateDeclarations, declarationLabel } = await import("../src/lib/dm/declarations.ts");

const me = "00000000-0000-4000-8000-000000000001";
const ally = "00000000-0000-4000-8000-000000000002";
const sheet = {
  id: me, name: "Vela", equipment: [{ name: "Potion of Healing", qty: 1 }, { name: "Rope", qty: 1 }],
  resources: { bardic_inspiration: { max: 3, used: 0 }, lay_on_hands: { max: 25, used: 0 }, relentless_endurance: { max: 1, used: 0 } },
  spellcasting: { ability: "cha", slots: { 1: { max: 1, used: 0 } }, prepared: ["Shield of Faith"], known: [], cantrips: ["Light"] },
};
const library = [
  { name: "Light", level: 0, castingTime: "1 action", ritual: false, concentration: false, target: "other" },
  { name: "Detect Magic", level: 1, castingTime: "1 action", ritual: true, concentration: true, target: "self" },
  { name: "Alarm", level: 1, castingTime: "1 minute", ritual: true, concentration: false, target: "other", ritualOnly: true },
  { name: "Shield of Faith", level: 1, castingTime: "1 bonus action", ritual: false, concentration: true, target: "party" },
];
const party = new Map([[me, "Vela"], [ally, "Bram"]]);
const check = (declarations, language = "en") => validateDeclarations(declarations, { sheet, library, party, language });
const ok = (declarations, why) => { const result = check(declarations); assert.equal(result.ok, true, `${why}: ${result.error}`); return result; };
const refused = (declarations, why) => assert.equal(check(declarations).ok, false, why);
const spell = (name, extra = {}) => ({ type: "spell", spell: name, targetIds: [], ...extra });

refused([], "nothing picked");
refused(Array.from({ length: MAX_DECLARATIONS + 1 }, () => spell("Light")), "too many picks");
refused([spell("Fireball", { slotLevel: 1 })], "not on the sheet");
ok([spell("Light")], "a cantrip");
refused([spell("Light", { slotLevel: 1 })], "a cantrip takes no slot");
ok([spell("Detect Magic", { ritual: true })], "a ritual takes no slot");
ok([spell("Detect Magic", { slotLevel: 1 })], "or a slot");
refused([spell("Shield of Faith", { ritual: true, targetIds: [me] })], "no ritual tag");
refused([spell("Alarm", { slotLevel: 1 })], "an unprepared spellbook spell is ritual only");
ok([spell("Alarm", { ritual: true })], "as a ritual");
refused([spell("Detect Magic", { ritual: true, targetIds: [ally] })], "a self spell on someone else");
refused([spell("Light", { targetIds: [ally] })], "an other-target spell takes no party target");
refused([spell("Shield of Faith", { slotLevel: 1 })], "a party spell needs a target");
refused([spell("Shield of Faith", { slotLevel: 1, targetIds: ["00000000-0000-4000-8000-000000000009"] })], "a stranger");
refused([spell("Shield of Faith", { slotLevel: 1, targetIds: [ally] }), spell("Detect Magic", { slotLevel: 1 })], "one slot for two spells");
refused([{ type: "resource", resource: "bardic_inspiration", targetIds: [me] }], "inspiration goes to someone else");
refused([{ type: "resource", resource: "bardic_inspiration", targetIds: [] }], "inspiration needs a target");
ok([{ type: "resource", resource: "lay_on_hands", targetIds: [me] }], "Lay on Hands may heal its owner");
refused([{ type: "resource", resource: "relentless_endurance", targetIds: [] }], "a passive feature is never spent by choice");
refused([{ type: "item", item: "Rope", targetIds: [] }], "not a consumable");
refused([{ type: "item", item: "Potion of Healing", targetIds: [] }, { type: "item", item: "Potion of Healing", targetIds: [] }], "only one potion");

const english = ok([
  spell("Detect Magic", { ritual: true }),
  spell("Shield of Faith", { slotLevel: 1, targetIds: [ally] }),
  { type: "resource", resource: "bardic_inspiration", targetIds: [ally] },
  { type: "item", item: "Potion of Healing", targetIds: [ally] },
], "a full request").content;
assert.equal(english, [
  "Picked from the spell and ability book (exact engine names):",
  "1. Spell: Detect Magic, as a ritual: no slot, 10 minutes longer; on themselves",
  "2. Spell: Shield of Faith, level 1 slot; targets: Bram",
  "3. Ability: Bardic Inspiration; target: Bram",
  "4. Item: Potion of Healing; target: Bram",
].join("\n"));
const russian = validateDeclarations([spell("Light")], { sheet, library, party, language: "ru", localize: (_kind, name) => name === "Light" ? "Свет" : name });
assert.equal(russian.content.split("\n")[1], "1. Заклинание: Свет [Light] (заговор); цель — в тексте заявки");
assert.equal(declarationLabel(spell("Shield of Faith", { slotLevel: 1, targetIds: [ally] }), { party, language: "ru" }), "Shield of Faith · 1 круг → Bram");

console.log("declarations: spell book picks validated and rendered");
