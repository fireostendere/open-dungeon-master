// Real engine and narrator writes on an isolated database; no model or network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "odm-post-combat-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getFloor, getGlobalTurnState, joinByInviteCode, latestSeq, setCampaignStatus, setFloor } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { getActiveEncounter } = await import("../src/lib/db/encounters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createDmTurn, createPendingRoll, resolvePendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { insertRoll } = await import("../src/lib/db/rolls.ts");
const { sealGlobalTurnNow } = await import("../src/lib/dm/global-turn-logic.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const fetchBefore = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected network request"); };

try {
  for (const [ending, handoff] of [["damage_enemy", "narrate"], ["end_encounter", "narrate"], ["damage_enemy", "explicit_start"], ["enemy_flees", "release_floor"]]) {
    const dm = createUser(`post-dm-${randomUUID()}`, "hash");
    const player = createUser(`post-player-${randomUUID()}`, "hash");
    const campaign = createCampaign(dm.id, {
      title: "Post-combat round", description: "", theme: "", maxPlayers: 1, startingLevel: 1, difficulty: "normal",
      gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false,
        globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 1, quorumDelayMinutes: 0 } },
    });
    assert.ok(joinByInviteCode(player.id, campaign.inviteCode).campaign);
    setCampaignStatus(campaign.id, "active");
    const hero = createSheet(campaign.id, player.id, 1, createSheetSchema.parse({
      name: "Hero", race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      maxHp: 200, ac: 12, hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    }));
    const narrator = (operation, args) => executeMcpNarratorControl(operation, {
      campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), ...args,
    });
    const invoke = (name, args) => narrator("narrator.invoke", { name, args });
    const round = () => getGlobalTurnState(campaign.id);
    const events = type => getDatabase().prepare("SELECT seq, payload_json FROM campaign_events WHERE campaign_id = ? AND type = ? ORDER BY seq").all(campaign.id, type);

    await narrator("narrator.narrate", { content: "A bandit blocks the road.", startGlobalRound: 1 });
    sealGlobalTurnNow(campaign.id, 1);
    await invoke("start_encounter", { enemies: [{ monster: "Разбойник", cr: 0.25 }], surprised: "enemies", rollInitiative: true });
    await narrator("narrator.narrate", { content: "Steel rings against steel.", completeGlobalRound: 1 });
    assert.equal(round().roundNumber, 2);
    assert.equal(round().phase, "waiting", "initiative owns input during the whole-party fight");
    const encounter = getActiveEncounter(campaign.id);
    const enemyId = encounter.order.find(entry => entry.kind === "enemy").enemyId;
    // The same hold persisted by accepting a player's combat submission.
    setFloor(campaign.id, { mode: "hold", next: getFloor(campaign.id), combat: {
      encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, characterId: hero.id,
      requiresEndTurn: true, mechanicsResolved: false,
    } });
    const unresolvedSeq = latestSeq(campaign.id);
    await assert.rejects(() => narrator("narrator.narrate", { content: "The road is clear.", passTurn: true }), /not resolved yet/);
    assert.equal(latestSeq(campaign.id), unresolvedSeq, "an unresolved handoff writes nothing");
    await invoke(ending, ending === "damage_enemy" ? { enemyId, amount: 200, type: "fire" }
      : ending === "enemy_flees" ? { enemyId } : { outcome: "truce" });
    assert.equal(getActiveEncounter(campaign.id), null);
    assert.equal(round().phase, "waiting", "the killing effect must not open input before narration");
    assert.equal(getFloor(campaign.id).mode, "hold");
    const triggers = events("global_turn_narrator_trigger").filter(event => JSON.parse(event.payload_json).kind === "post_combat");
    assert.equal(triggers.length, 1, `${ending}: every ending must publish one post-combat trigger`);
    assert.equal(JSON.parse(triggers[0].payload_json).roundNumber, 2);
    assert.equal(events("global_turn_started").length, 1);

    const pending = createPendingRoll({ campaignId: campaign.id, turnId: createDmTurn(campaign.id, [], "human_dm").id,
      toolCallId: null, userId: player.id, characterId: hero.id, kind: "custom", detail: "Outstanding physical roll",
      expression: "1d20", advantage: "none", dc: null, reason: "Outstanding physical roll" });
    const pendingSeq = latestSeq(campaign.id);
    await assert.rejects(() => narrator("narrator.narrate", { content: "The road is clear.", passTurn: true }), /pending physical rolls/);
    await assert.rejects(() => narrator("narrator.release_floor", {}), /pending physical rolls/);
    assert.equal(latestSeq(campaign.id), pendingSeq);
    assert.equal(round().phase, "waiting", "even an ended fight cannot skip pending physical dice");
    const roll = insertRoll({ campaignId: campaign.id, characterId: hero.id, requestedBy: "player", kind: "custom",
      result: { expression: "1d20", total: 10, terms: [] } });
    resolvePendingRoll(pending.id, "submitted", roll.id);

    await narrator("narrator.narrate", { content: "The bandit falls back. The road is clear.", passTurn: false });
    assert.equal(round().phase, "waiting", "an intermediate narration keeps input closed");
    const finalWrite = { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(),
      ...(handoff === "release_floor" ? {} : { content: "You can continue down the road.", passTurn: true,
        ...(handoff === "explicit_start" ? { startGlobalRound: 2 } : {}) }) };
    const operation = handoff === "release_floor" ? "narrator.release_floor" : "narrator.narrate";
    await executeMcpNarratorControl(operation, finalWrite);
    assert.equal(round().phase, "active", `${handoff}: the final handoff opens the waiting round`);
    assert.equal(round().roundNumber, 2);
    assert.deepEqual(getFloor(campaign.id), { mode: "open" });
    assert.equal(events("global_turn_started").length, 2, "the waiting round starts exactly once");
    const seq = latestSeq(campaign.id);
    assert.equal((await executeMcpNarratorControl(operation, finalWrite)).result.replayed, true);
    assert.equal(latestSeq(campaign.id), seq, "receipt recovery must not restart the round");
    assert.equal(events("global_turn_started").length, 2);
    await assert.rejects(() => narrator("narrator.release_floor", {}), /Global-turn pacing/);
    assert.equal(latestSeq(campaign.id), seq, "ordinary global-turn pacing still cannot be bypassed");
  }
  console.log("PASS automatic victory, explicit ending, flight, final narration, floor release and receipt replay reopen the post-combat round exactly once");
} finally {
  globalThis.fetch = fetchBefore;
  process.chdir(cwd);
  removeTempDir(directory);
}
