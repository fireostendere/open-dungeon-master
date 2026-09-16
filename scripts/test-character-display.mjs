import assert from "node:assert/strict";
import { register } from "node:module";
import { characterDisplay } from "../src/lib/i18n/character-display.ts";
import { displaySystemText } from "../src/lib/i18n/session-system-text.ts";
register("./lib/register-alias.mjs", import.meta.url);
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
assert.equal(composerGate({ floor: { mode: "open" }, sheets: [], meUserId: "test", kind: "do", myName: "$&", leadPrivate: false, openingNarrationPlaying: false, locale: "ru" }).placeholder, "Что делает $&?");
console.log("character display: ok");
