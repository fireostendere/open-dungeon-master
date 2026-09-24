import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const { characterDisplay } = await import("../src/lib/i18n/character-display.ts");
const { displaySystemText } = await import("../src/lib/i18n/session-system-text.ts");
const { composerGate } = await import("../src/app/campaigns/[campaignId]/composerGate.ts");
const { interpolateWorkshop } = await import("../src/app/workshop/copy.ts");

assert.equal(characterDisplay("kobold", "ru"), "Кобольд");
assert.equal(characterDisplay("rogue", "ru"), "Плут");
assert.equal(characterDisplay("custom_origin", "pl"), "custom_origin");
assert.equal(characterDisplay("__proto__", "ru"), "__proto__");
assert.equal(displaySystemText("The DM ran into a problem: This world has no AI storyteller configured.", "ru"), "Мастер столкнулся с проблемой: Для этого мира не настроен ИИ-ведущий.");
assert.equal(displaySystemText("Player-authored diagnostic", "ru"), "Player-authored diagnostic");
assert.equal(displaySystemText("__proto__", "ru"), "__proto__");
assert.equal(displaySystemText("constructor", "en"), "constructor");
assert.equal(interpolateWorkshop("Delete {name}?", { name: "$&" }), "Delete $&?");
assert.equal(composerGate({ floor: { mode: "open" }, sheets: [], meUserId: "test", kind: "do", myName: "$&", leadPrivate: false, openingNarrationPlaying: false, locale: "ru" }).placeholder, "Что делает или говорит $&?");
const submitted = composerGate({
  floor: { mode: "open" },
  sheets: [{ id: "hero", userId: "test", isCompanion: false }],
  meUserId: "test",
  kind: "do",
  myName: "Герой",
  leadPrivate: false,
  openingNarrationPlaying: false,
  globalTurnEnabled: true,
  globalTurnState: { roundNumber: 1, phase: "active", startedAt: null, firstActionAt: null, deadlineAt: null, quorumReachedAt: null, actionsByCharacter: { hero: { actionsCount: 1, updatedAt: new Date().toISOString() } } },
  locale: "ru",
});
assert.equal(submitted.inputBlocked, true);
assert.match(submitted.placeholder, /Ход уже отправлен/);
const diceOverlay = readFileSync(new URL("../src/app/campaigns/[campaignId]/Bg3DiceOverlay.tsx", import.meta.url), "utf8");
assert.match(diceOverlay, /no-scrollbar[^"\n]*overflow-y-auto/);
assert.match(diceOverlay, /term\.dice\.length > 1/);
assert.match(diceOverlay, /4: "polygon\(50% 2%, 98% 92%, 2% 92%\)"/);
console.log("character display: ok");
