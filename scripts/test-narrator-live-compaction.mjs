// Live narrator reads name the speaker, keep only the roll itself, and never echo a
// narration back to the writer that just sent it.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-live-compaction-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { allocateSeq, createCampaign, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { publishWithSeq } = await import("../src/lib/events.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const { getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");

try {
  const dm = createUser("live_dm", "hash");
  const campaign = createCampaign(dm.id, {
    title: "Live", description: "", theme: "", maxPlayers: 4, startingLevel: 1,
    difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
  });
  const hero = instantiateIntoCampaign(createCharacter(dm.id, 1, createSheetSchema.parse({
    name: "Грог", race: "half-orc", class: "barbarian", subclass: "", background: "outlander",
    abilities: { str: 17, dex: 12, con: 16, int: 8, wis: 10, cha: 12 }, maxHp: 15, ac: 14, speed: 30,
    hitDice: { die: "d12", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: ["common"], tools: [], armor: [], weapons: [] },
    equipment: [], gold: 0, copper: 0,
  })).id, campaign.id, dm.id, 1);
  setCampaignStatus(campaign.id, "active");

  const seq = allocateSeq(campaign.id);
  const said = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "player", userId: dm.id, characterId: hero.id, content: "Рублю цепь." });
  publishWithSeq(campaign.id, seq, "message_added", { message: said });
  const roll = { id: randomUUID(), campaignId: campaign.id, characterId: hero.id, requestedBy: "dm", kind: "skill_check", detail: "athletics",
    expression: "1d20+5", advantage: "none", dc: 12, total: 17, success: true, visibility: "public", messageId: null, targetEnemyId: null, applied: false,
    breakdown: { expression: "1d20+5", total: 17, natural: 12, terms: [{ kind: "dice", sign: 1, count: 1, sides: 20, dice: [{ sides: 20, value: 12, kept: true }], subtotal: 12 }] },
    createdAt: new Date().toISOString() };
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });

  const live = (await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, projection: "live" })).result;
  const message = live.messages.find(item => item.id === said.id);
  assert.equal(message.character, "Грог", "the speaker arrives by name, not only as a characterId");
  assert.equal(message.campaignId, undefined);
  assert.equal(message.createdAt, undefined);
  const rolled = live.events.find(event => event.type === "roll_result").payload.roll;
  assert.deepEqual(rolled, { id: roll.id, characterId: hero.id, kind: "skill_check", detail: "athletics", expression: "1d20+5", dc: 12, total: 17, success: true, natural: 12 });
  const full = (await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, projection: "full" })).result;
  assert.equal(full.messages.find(item => item.id === said.id).campaignId, campaign.id, "full reads keep the stored row");

  const receipt = (await executeMcpNarratorControl("narrator.narrate", {
    campaignId: campaign.id, expectedSeq: live.currentSeq, timelineEpoch: live.timelineEpoch, commandId: randomUUID(),
    content: "Цепь лопается с визгом.", readAfter: { projection: "live" },
  })).result;
  const echoed = receipt.state.messages.find(item => item.id === receipt.result.messageId);
  assert.equal(echoed.content, null, "the writer is not sent its own narration back");
  assert.equal(echoed.ownWrite, true);
  const fight = (await executeMcpNarratorControl("narrator.invoke", {
    campaignId: campaign.id, expectedSeq: receipt.currentSeq, timelineEpoch: live.timelineEpoch, commandId: randomUUID(),
    name: "start_encounter", args: { enemies: "goblin", summary: "Засада у причала", rollInitiative: true, engaged: true }, readAfter: false,
  })).result;
  assert.match(fight.result.result.next, /rolled for every combatant/, "no request_roll per hero is asked for");
  const order = (await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, projection: "live" })).result.encounter.encounter;
  assert.equal(order.orderReady, true, "the fight starts with every initiative in");
  assert.ok(order.order.some(entry => entry.kind === "pc" && entry.characterId === hero.id));
  const tokens = listTokens(getBattleMapForEncounter(order.id).id);
  const [pc, foe] = ["pc", "enemy"].map(kind => tokens.find(token => token.kind === kind));
  assert.ok(Math.max(Math.abs(pc.x - foe.x), Math.abs(pc.y - foe.y)) <= 1, "an engaged fight starts at arm's length, not across the map");
  console.log("Live narrator compaction passed: speaker names, compact rolls, no own-write echo, one-call initiative");
} finally {
  removeTempDir(dir);
}
