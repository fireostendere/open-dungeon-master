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
assert.equal(displaySystemText("Грог is no longer poisoned (the effect ran its course). Шёпот stays frightened (WIS save 9 vs DC 13).", "ru"), "Грог: состояние «Отравлен» закончилось. Шёпот: состояние «Испуган» держится (спасбросок МДР 9 против СЛ 13).");
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
// Multi-dice terms are itemised per die in the roll overlay's tally chips.
const diceOverlay = readFileSync(new URL("../src/app/campaigns/[campaignId]/DiceRollOverlay.tsx", import.meta.url), "utf8");
assert.match(diceOverlay, /kept\.length > 1/, "several kept dice of one size share a chip");
assert.match(diceOverlay, /fx-flat-dice/, "the overlay keeps a flat fallback when WebGL is unavailable");
console.log("character display: ok");
