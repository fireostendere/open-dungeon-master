// Turn-loop integration with a fake model and explicit domain test doubles.
// Effects and input checkpoints use real SQLite; combat rule implementations,
// Next HTTP, browser delivery and live providers are deliberately not exercised.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadReviewModule, namedImports, sqliteAdapter } from "./lib/review-module.mjs";

const source = process.env.ODM_REVIEW_TURN_SOURCE || fileURLToPath(new URL("../src/lib/dm/turn.ts", import.meta.url));
const input = loadReviewModule(fileURLToPath(new URL("../src/lib/dm/turn-input.ts", import.meta.url)));
const tool = (name) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });
const call = (name, id = name, args = {}) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function fixture({ encounterNames = [] } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE campaigns (id TEXT PRIMARY KEY);
    INSERT INTO campaigns VALUES ('c');
    CREATE TABLE dm_turns (id TEXT PRIMARY KEY, campaign_id TEXT, status TEXT, payload TEXT);
    CREATE TABLE campaign_messages (id TEXT PRIMARY KEY, seq INTEGER, author_type TEXT, content TEXT);
    CREATE TABLE effects (name TEXT PRIMARY KEY, amount INTEGER);
    INSERT INTO effects VALUES ('slots', 3), ('hp', 20), ('npcs', 0);`);
  const adapter = sqliteAdapter(db);
  const state = { modelCalls: 0, responses: [], events: [], turns: [], encounter: null,
    floor: { mode: "open" }, promptHistory: [], beforeResponse: null, guard: null };
  const campaign = { id: "c", status: "active", settings: {}, gameSettings: {
    dicePolicy: "digital", stages: {}, variantRules: {}, relationships: "off",
  } };
  const sheets = [{ id: "pc", userId: "u", name: "Hero", level: 2, conditions: [], conditionMeta: {} }];
  let seq = 0;
  function message(entry) {
    const result = { id: `m${++seq}`, seq, ...entry };
    db.prepare("INSERT INTO campaign_messages VALUES (?, ?, ?, ?)")
      .run(result.id, result.seq, result.authorType, result.content);
    return result;
  }
  function history() {
    return db.prepare("SELECT id, seq, author_type AS authorType, content FROM campaign_messages ORDER BY seq").all();
  }
  function save(turn) {
    db.prepare("INSERT INTO dm_turns VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload")
      .run(turn.id, "c", turn.status, JSON.stringify(turn));
  }
  function turn(conversation = []) {
    const result = { id: `t${state.turns.length + 1}`, campaignId: "c", status: "running", actor: "ai",
      callIndex: 0, conversation, narrationParts: [], rollIds: [], playerWhisperIds: [],
      answeredWhisperCharacterIds: [], actedEnemyIds: [], resolvedCharacterIds: [], imageArgs: null,
      locationId: null, mutationCount: 0, encounterCount: 0, contextTrace: null };
    state.turns.push(result); save(result); return result;
  }
  const mocks = {};
  for (const { from, name } of namedImports(source)) {
    mocks[from] ??= {};
    // Defaults are explicit empty domain data; individual behavior below
    // replaces every dependency used by these scenarios.
    mocks[from][name] = () => [];
  }
  const set = (from, exports) => Object.assign(mocks[from] ??= {}, exports);
  const commitEffects = loadReviewModule(fileURLToPath(new URL("../src/lib/db/commit-effects.ts", import.meta.url)));
  mocks["@/lib/db/core"] = { getDatabase: () => adapter };
  mocks["@/lib/db/commit-effects"] = commitEffects;
  const checkpoint = loadReviewModule(fileURLToPath(new URL("../src/lib/db/dm-turn-inputs.ts", import.meta.url)), {
    "@/lib/db/core": { getDatabase: () => adapter },
  });
  mocks["@/lib/dm/tool-transaction"] = loadReviewModule(fileURLToPath(new URL("../src/lib/dm/tool-transaction.ts", import.meta.url)), mocks);
  mocks["@/lib/db/dm-turn-inputs"] = checkpoint;
  mocks["@/lib/dm/turn-input"] = input;
  mocks["@/lib/i18n/game-text"] = loadReviewModule(fileURLToPath(new URL("../src/lib/i18n/game-text.ts", import.meta.url)));
  set("@/lib/db/campaigns", {
    getCampaignById: () => campaign, getCampaignSummaryState: () => ({ summary: "" }),
    getFloor: () => state.floor, setFloor: (_, value) => { state.floor = value; },
    allocateSeq: () => seq + 1, listMembers: () => [],
  });
  set("@/lib/db/dm-turns", { createDmTurn: (_, conversation) => turn(conversation), saveDmTurn: save,
    getDmTurn: (id) => JSON.parse(db.prepare("SELECT payload FROM dm_turns WHERE id = ?").get(id).payload),
    listPendingForTurn: () => [], failStaleRunningTurns: () => {},
  });
  mocks["@/lib/db/dm-execution"] = loadReviewModule(fileURLToPath(new URL("../src/lib/db/dm-execution.ts", import.meta.url)), mocks);
  set("@/lib/db/messages", { insertCampaignMessage: message, listRecentMessages: history });
  set("@/lib/db/sheets", { listSheets: () => sheets });
  set("@/lib/events", {
    publishPersisted: (_, type, payload) => commitEffects.afterCommit(() => state.events.push({ type, payload })),
    publishWithSeq: (_, __, type, payload) => commitEffects.afterCommit(() => state.events.push({ type, payload })),
    publishEphemeral: (_, type, payload) => commitEffects.afterCommit(() => state.events.push({ type, payload })),
  });
  set("@/lib/db/encounters", { getActiveEncounter: () => state.encounter, listEnemies: () => [] });
  set("@/lib/dm/model", { requestDmMessage: async (_, conversation, options) => {
    state.modelCalls += 1;
    state.promptHistory.push(structuredClone(conversation));
    options.onDelta?.("UNVERIFIED hit before dice");
    if (state.beforeResponse) await state.beforeResponse(state.modelCalls);
    return { message: state.responses.shift() ?? { content: "The checked outcome." } };
  } });
  set("@/lib/story-prompt", { extractStoryText: (text) => text ?? "",
    createStreamingArtifactFilter: () => ({ push: (text) => text, flush: () => "" }),
  });
  set("@/lib/dm/delta-buffer", { createDeltaBatcher: (emit) => ({ push: emit, flush: () => {} }) });
  set("@/lib/dm/tool-text", { fakeRollMarkerRegex: () => /\[roll:[^\]]+\]/g });
  set("@/lib/dm/rolls", {
    extractToolCalls: (calls) => (calls ?? []).map((c) => ({ id: c.id, name: c.function.name, rawArguments: c.function.arguments })),
    salvageXmlToolCalls: (text) => ({ text, calls: [] }),
    salvageTextualToolCalls: (text) => ({ text, calls: [] }),
    salvageProseRollAsks: (text) => ({ text, calls: [] }),
    resolveSheetRef: (id) => sheets.find((sheet) => sheet.id === id) ?? null,
  });
  set("@/lib/dm/encounter-tools", { ENCOUNTER_TOOL_NAMES: encounterNames, ENCOUNTER_CAP_PER_TURN: 10,
    encounterTools: () => encounterNames.map(tool), ensureInitiativeProgress: () => {}, advanceAfterTurn: () => {},
  });
  set("@/lib/dm/mutations", { MUTATION_TOOL_NAMES: [], MUTATION_CAP_PER_TURN: 10, mutationTools: [] });
  set("@/lib/dm/pc-attack", { PC_ATTACK_PARKED: "parked" });
  set("@/lib/dm/cast-tools", { castBuffTool: tool("cast_buff"), handleCastBuff: () => {
    db.exec("UPDATE effects SET amount = amount - 1 WHERE name = 'slots'"); return { ok: true, slotSpent: 1 };
  } });
  set("@/lib/dm/split-damage", { SPLIT_DAMAGE_TOOL_NAMES: ["split_damage"], splitDamageTool: tool("split_damage"), handleSplitDamage: () => {
    db.exec("UPDATE effects SET amount = amount - 3 WHERE name = 'hp'"); return { ok: true, damage: 3 };
  } });
  set("@/lib/dm/social-tools", { SOCIAL_TOOL_NAMES: ["set_npc"], socialTools: [tool("set_npc")], npcRosterForPrompt: () => [], handleSetNpc: () => {
    db.exec("UPDATE effects SET amount = amount + 1 WHERE name = 'npcs'"); return { ok: true, npc: "recorded" };
  } });
  for (const [file, names, tools] of [
    ["check-tools", "CHECK_TOOL_NAMES", "checkTools"], ["hazard-tools", "HAZARD_TOOL_NAMES", "hazardTools"],
    ["pet-tools", "PET_TOOL_NAMES", "petTools"], ["party-tools", "PARTY_TOOL_NAMES", "partyTools"],
    ["scene-tools", "SCENE_TOOL_NAMES", "sceneTools"], ["mount-tools", "MOUNT_TOOL_NAMES", "mountTools"],
    ["effect-tools", "EFFECT_TOOL_NAMES", "effectTools"], ["world-tools", "WORLD_TOOL_NAMES", "worldTools"],
    ["ambience-tools", "AMBIENCE_TOOL_NAMES", "ambienceTools"],
  ]) set(`@/lib/dm/${file}`, { [names]: [], [tools]: [] });
  set("@/lib/dm/relationship-tools", { RELATIONSHIP_TOOL_NAMES: [], relationshipTools: () => [] });
  set("@/lib/dm/companion-tools", { COMPANION_TOOL_NAMES: new Set(), companionTools: () => [] });
  set("@/lib/dm/rest-tools", { restTools: [] });
  set("@/lib/dm/prompt", Object.fromEntries([
    ["requestRollTool", tool("request_roll")], ["requestPlayerInputTool", tool("request_player_input")],
    ["movePartyTool", tool("move_party")], ["updateLocationTool", tool("update_location")],
    ["recordEventTool", tool("record_event")], ["recallStoryTool", tool("recall_story")],
    ["sendWhisperTool", tool("send_whisper")], ["completeBeatTool", tool("complete_beat")],
    ["buildDmMessages", (_, entries) => entries.map((entry) => ({ role: "user", content: entry.content }))],
  ]));
  set("@/lib/dm/lore-search", { searchLoreTool: tool("search_lore") });
  set("@/lib/dm/note-tools", { writeCampaignNoteTool: tool("write_campaign_note") });
  set("@/lib/db/locations", { getCurrentLocation: () => null, listLocations: () => [] });
  set("@/lib/db/director-arms", { takeDirectorArm: () => null });
  set("@/lib/dm/stages", { isStageEnabled: () => false });
  set("@/lib/image-tool", { parseGenerateImageToolCall: () => null, generateImageTool: tool("generate_image") });
  set("@/lib/dm/engine-boundary", { announcesEncounterStart: () => false });
  set("@/lib/dm/narration-guard", { enforceEngineBoundary: (_, t) => { state.guard?.(t); } });
  set("@/lib/db/character-events", { listRecentEventsForCampaign: () => new Map() });
  const engine = loadReviewModule(source, mocks);
  return { db, state, campaign, sheets, turn, engine, message, checkpoint, mocks, save, effect: (name) => db.prepare("SELECT amount FROM effects WHERE name=?").get(name).amount };
}

for (const name of ["cast_buff", "split_damage", "set_npc"]) {
  for (const content of ["", "Narration accompanying the action."]) {
    test(`R02: ${name}, ${content ? "with" : "without"} narration, executes exactly once`, async () => {
      const f = fixture();
      try {
        if (name === "split_damage") f.state.encounter = { id: "fight", turnIndex: 2 };
        const t = f.turn();
        f.state.responses.push({ content, tool_calls: [call(name)] });
        await f.engine.reenterDmTurn(f.campaign, t);
        assert.equal(t.status, "done");
        assert.equal(f.effect("slots"), name === "cast_buff" ? 2 : 3);
        assert.equal(f.effect("hp"), name === "split_damage" ? 17 : 20);
        assert.equal(f.effect("npcs"), name === "set_npc" ? 1 : 0);
        assert.equal(t.conversation.filter((entry) => entry.role === "tool" && entry.tool_call_id === name).length, 1);
      } finally { f.db.close(); }
    });
  }
}

test("R02: combined calls with duplicated/missing IDs each receive one result", async () => {
  const f = fixture();
  try {
    const t = f.turn();
    f.state.responses.push({ content: "", tool_calls: [call("cast_buff", "same"), call("set_npc", "same"), call("set_npc", undefined)] });
    await f.engine.reenterDmTurn(f.campaign, t);
    const results = t.conversation.filter((entry) => entry.role === "tool");
    assert.equal(results.length, 3); assert.equal(new Set(results.map((entry) => entry.tool_call_id)).size, 3);
    assert.equal(f.effect("slots"), 2); assert.equal(f.effect("npcs"), 2);
  } finally { f.db.close(); }
});

test("R02: tools returned on the narration-only call are explicitly rejected before effects", async () => {
  const f = fixture();
  try {
    const t = f.turn(); t.callIndex = 3;
    f.state.responses.push({ content: "A fabricated buff.", tool_calls: [call("cast_buff")] });
    await f.engine.reenterDmTurn(f.campaign, t);
    assert.equal(f.effect("slots"), 3); assert.equal(t.status, "failed");
    assert.match(t.conversation.find((entry) => entry.role === "tool").content, /budget exhausted/);
  } finally { f.db.close(); }
});

test("R03: AI spotlight uses the initiative guard and preserves turn ownership", async () => {
  const f = fixture();
  try {
    f.state.encounter = { id: "fight", turnIndex: 2 }; f.state.floor = { mode: "initiative", userId: "u" };
    const before = structuredClone(f.state.floor); const t = f.turn();
    f.state.responses.push({ content: "", tool_calls: [call("request_player_input", "input", { characterIds: ["pc"] })] });
    await f.engine.reenterDmTurn(f.campaign, t);
    assert.deepEqual(f.state.floor, before); assert.equal(f.state.encounter.turnIndex, 2);
    assert.match(t.conversation.find((entry) => entry.tool_call_id === "input").content, /initiative/);
    assert.equal(f.state.events.some((event) => event.type === "floor_changed"), false);
  } finally { f.db.close(); }
});

test("R03: an active encounter also protects a hold-wrapped initiative floor", () => {
  const f = fixture();
  try {
    f.state.encounter = { id: "fight", turnIndex: 2 };
    f.state.floor = { mode: "hold", next: { mode: "initiative" } };
    const result = f.engine.handleRequestPlayerInput(f.campaign, '{"characterIds":["pc"]}', f.sheets, new Map(f.sheets.map((s) => [s.id, s])));
    assert.match(result.error, /initiative/); assert.equal(f.state.floor.mode, "hold");
  } finally { f.db.close(); }
});

test("R04: an action arriving during model latency gets exactly one follow-up turn", async () => {
  const f = fixture();
  try {
    f.message({ authorType: "player", content: "FIRST ACTION" });
    let release; const held = new Promise((resolve) => { release = resolve; });
    let entered; const requested = new Promise((resolve) => { entered = resolve; });
    f.state.beforeResponse = async (number) => { if (number === 1) { entered(); await held; } };
    const first = f.engine.startDmTurn("c"); await requested;
    f.message({ authorType: "player", content: "SECOND ACTION" }); release(); await first;
    assert.equal(f.checkpoint.completedInputSeq("c"), 1);
    await f.engine.startDmTurn("c"); await f.engine.startDmTurn("c");
    assert.equal(f.state.modelCalls, 2);
    assert.equal(f.state.promptHistory[0].some((m) => m.content === "SECOND ACTION"), false);
    assert.equal(f.state.promptHistory[1].filter((m) => m.content === "SECOND ACTION").length, 1);
    assert.equal(f.checkpoint.completedInputSeq("c"), 2);
  } finally { f.db.close(); }
});

test("R04: failed turns do not acknowledge inputs; campaign checkpoints stay isolated", () => {
  const f = fixture();
  try {
    const t = f.turn(); f.checkpoint.rememberTurnInput(t.id, "c", 7);
    assert.equal(f.checkpoint.completedInputSeq("c"), null);
    f.db.prepare("UPDATE dm_turns SET status='failed' WHERE id=?").run(t.id);
    assert.equal(f.checkpoint.completedInputSeq("c"), null);
    f.db.prepare("UPDATE dm_turns SET status='done' WHERE id=?").run(t.id);
    assert.equal(f.checkpoint.completedInputSeq("c"), 7);
    assert.equal(f.checkpoint.completedInputSeq("other"), null);
    assert.equal(input.needsDmTurn([{ seq: 8, authorType: "player" }, { seq: 9, authorType: "dm" }], 7, false), true);
    assert.equal(input.needsDmTurn([{ seq: 8, authorType: "player" }, { seq: 9, authorType: "dm" }], 8, false), false);
  } finally { f.db.close(); }
});

test("R19: unverified deltas are never published; only guarded final narration reaches players", async () => {
  const f = fixture();
  try {
    const t = f.turn(); f.state.guard = (turn) => { turn.narrationParts = ["GUARDED OUTCOME"]; };
    await f.engine.reenterDmTurn(f.campaign, t);
    assert.equal(f.state.events.some((event) => event.type === "dm_delta"), false);
    const messages = f.state.events.filter((event) => event.type === "message_added");
    assert.equal(messages.length, 1); assert.equal(messages[0].payload.message.content, "GUARDED OUTCOME");
  } finally { f.db.close(); }
});

test("R08: actual main loop replays the prepared batch after a handler exception", async () => {
  const f=fixture();try{
    let fail=true;
    f.mocks["@/lib/dm/cast-tools"].handleCastBuff=()=>{
      f.db.exec("UPDATE effects SET amount=amount-1 WHERE name='slots'");
      if(fail){fail=false;throw Error("injected handler failure");}return{ok:true};
    };
    const t=f.turn();f.state.responses.push({content:"",tool_calls:[call("cast_buff")]});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"failed");assert.equal(f.effect("slots"),3);assert.equal(f.state.modelCalls,1);
    const batch=f.mocks["@/lib/db/dm-execution"].pendingDmBatch(t.id);
    assert.ok(batch);f.mocks["@/lib/db/dm-execution"].restoreDmBatch(t,batch);f.save(t);
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("slots"),2);assert.equal(f.state.modelCalls,2);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_tool_results").get().n,1);
  }finally{f.db.close();}
});
test("R08: actual finalization rollback retries narration/initiative without a new model call", async () => {
  const f=fixture();try{
    f.db.exec("INSERT INTO effects VALUES ('initiative',0)");let fail=true;
    f.mocks["@/lib/dm/encounter-tools"].advanceAfterTurn=()=>{
      f.db.exec("UPDATE effects SET amount=amount+1 WHERE name='initiative'");
      if(fail){fail=false;throw Error("injected finalization failure");}
    };
    const t=f.turn();await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"failed");assert.equal(f.effect("initiative"),0);assert.equal(f.state.modelCalls,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_messages WHERE author_type='dm'").get().n,0);
    t.status="running";f.save(t);await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("initiative"),1);assert.equal(f.state.modelCalls,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_messages WHERE author_type='dm'").get().n,1);
    await f.engine.reenterDmTurn(f.campaign,t);assert.equal(f.effect("initiative"),1);
  }finally{f.db.close();}
});
test("R03: held initiative stays protected even without a currently loaded encounter",()=>{
  const f=fixture();try{
    f.state.floor={mode:"hold",next:{mode:"initiative"}};
    assert.match(f.engine.handleRequestPlayerInput(f.campaign,'{"characterIds":["pc"]}',f.sheets,new Map(f.sheets.map(s=>[s.id,s]))).error,/initiative/);
    assert.equal(f.state.floor.mode,"hold");
  }finally{f.db.close();}
});

test("R08: a post-roll persistence fault rolls back the whole tool batch", async () => {
  const f=fixture();try{
    let fail=true;
    f.mocks["@/lib/dm/rolls"].rollArgsSchema={parse:x=>x};
    f.mocks["@/lib/dm/rolls"].resolveRollExpression=()=>({expression:"1d6",detail:"damage"});
    f.mocks["@/lib/dice"].rollExpression=()=>({total:4,terms:[]});
    f.mocks["@/lib/db/rolls"].insertRoll=()=>{
      f.db.exec("UPDATE effects SET amount=amount-4 WHERE name='hp'");
      if(fail){fail=false;throw Error("post-roll database fault");}
      return{id:"r1",total:4};
    };
    const t=f.turn();f.state.responses.push({content:"",tool_calls:[call("cast_buff"),call("request_roll","damage",{kind:"damage",expression:"1d6"})]});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"failed");assert.equal(f.effect("hp"),20);assert.equal(f.effect("slots"),3);
    const batch=f.mocks["@/lib/db/dm-execution"].pendingDmBatch(t.id);
    assert.ok(batch);f.mocks["@/lib/db/dm-execution"].restoreDmBatch(t,batch);f.save(t);
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("hp"),16);assert.equal(f.effect("slots"),2);
    assert.equal(f.state.events.filter(e=>e.type==="roll_result").length,1);
  }finally{f.db.close();}
});

test("R08: interrupted private fallback replays once without leaking into shared narration", async () => {
  const f=fixture();try{
    f.db.exec("INSERT INTO effects VALUES ('whispers',0), ('answered',0)");let fail=true;
    const whisper={id:"w",characterId:"pc",userId:"u",characterName:"Hero",content:"private question"};
    f.mocks["@/lib/db/dm-whispers"].listPendingPlayerWhispers=()=>f.effect("answered")?[]:[whisper];
    f.mocks["@/lib/db/dm-whispers"].markPlayerWhispersAnswered=()=>f.db.exec("UPDATE effects SET amount=1 WHERE name='answered'");
    f.mocks["@/lib/dm/whispers"].FALLBACK_WHISPER_MESSAGE="private fallback";
    f.mocks["@/lib/dm/whispers"].deliverWhisper=()=>{
      f.db.exec("UPDATE effects SET amount=amount+1 WHERE name='whispers'");
      if(fail){fail=false;throw Error("private delivery interrupted");}
    };
    const t=f.turn();t.playerWhisperIds=["w"];f.save(t);
    f.state.responses.push({content:""},{content:""});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"failed");assert.equal(f.effect("whispers"),0);assert.equal(f.effect("answered"),0);
    const batch=f.mocks["@/lib/db/dm-execution"].pendingDmBatch(t.id);
    assert.equal(batch.phase,"whispers");f.mocks["@/lib/db/dm-execution"].restoreDmBatch(t,batch);f.save(t);
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("whispers"),1);assert.equal(f.effect("answered"),1);
    assert.equal(f.state.modelCalls,2);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_messages WHERE author_type='dm'").get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM dm_tool_results WHERE tool_name='send_whisper'").get().n,1);
  }finally{f.db.close();}
});

test("R08: a returned tool error rolls back its own SQL/cache/notifications, not a successful sibling", async () => {
  const f = fixture();
  try {
    const sheet = f.sheets[0]; const conditions = sheet.conditions;
    const t = f.turn();
    f.mocks["@/lib/dm/cast-tools"].handleCastBuff = (_campaign, turn, _args, sheets, byId) => {
      f.db.exec("UPDATE effects SET amount=amount-1 WHERE name='slots'");
      sheet.conditions.push("invalid-partial-buff"); sheet.newField = "must disappear";
      turn.rollIds.push("nonexistent-roll"); byId.delete(sheet.id); sheets.push({ id: "ghost" });
      f.mocks["@/lib/events"].publishPersisted("c", "refused_effect", {});
      return { error: "The spell was refused after a partial resource spend." };
    };
    f.state.responses.push({ content: "", tool_calls: [call("cast_buff"), call("set_npc")] });
    await f.engine.reenterDmTurn(f.campaign, t);
    assert.equal(t.status, "done"); assert.equal(f.effect("slots"), 3); assert.equal(f.effect("npcs"), 1);
    assert.equal(f.sheets.length, 1); assert.equal(f.sheets[0], sheet); assert.equal(sheet.conditions, conditions);
    assert.deepEqual(conditions, []); assert.equal(sheet.newField, undefined); assert.deepEqual(t.rollIds, []);
    assert.equal(f.state.events.some(e => e.type === "refused_effect"), false);
    const results = f.db.prepare("SELECT tool_name,result_json FROM dm_tool_results ORDER BY tool_name").all();
    assert.equal(results.length, 2); assert.match(results[0].result_json, /spell was refused/);
    assert.equal(JSON.parse(results[1].result_json).ok, true);
  } finally { f.db.close(); }
});

test("R02: malformed historical tool metadata cannot crash new call-ID allocation", async () => {
  const f = fixture();
  try {
    const t = f.turn([{ role: "assistant", content: "legacy", tool_calls: { malformed: true } },
      { role: "tool", content: "old result", tool_call_id: "same" }]);
    f.state.responses.push({content:"",tool_calls:[call("cast_buff","same")]});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("slots"),2);
    const results = f.db.prepare("SELECT tool_call_id FROM dm_tool_results").all();
    assert.equal(results.length,1);assert.notEqual(results[0].tool_call_id,"same");
    assert.deepEqual(t.conversation[0].tool_calls,{malformed:true});
  } finally { f.db.close(); }
});

for (const language of ["ru", "pl", "en"]) {
  test(`R21: empty narration and provider failures use the campaign language (${language})`, async () => {
    const f = fixture();
    try {
      f.campaign.gameSettings.language = language;
      const game = f.mocks["@/lib/i18n/game-text"];
      const prefix = "The DM ran into a problem: ";
      f.mocks["@/lib/campaign-types"].DM_HALTED_PREFIX = prefix;
      f.state.responses.push({ content: "" });
      const t = f.turn(); await f.engine.reenterDmTurn(f.campaign, t);
      assert.equal(t.status, "done");
      assert.equal(f.state.events.find(e => e.type === "message_added").payload.message.content, game.gameText(language, "moment"));
      f.mocks["@/lib/dm/model"].requestDmMessage = async () => ({error: Response.json({error:"Internal provider message"},{status:504})});
      const failed = f.turn(); await f.engine.reenterDmTurn(f.campaign, failed);
      assert.equal(failed.status, "failed");
      assert.equal(f.state.events.filter(e => e.type === "message_added").at(-1).payload.message.content, prefix + game.gameText(language, "timeout"));
    } finally { f.db.close(); }
  });
}

test("R08: whole-batch failure restores successful earlier tools' cached mutations too", async () => {
  const f = fixture();
  try {
    const sheet = f.sheets[0]; const conditions = sheet.conditions; const t = f.turn();
    let fail = true;
    f.mocks["@/lib/dm/cast-tools"].handleCastBuff = () => {
      f.db.exec("UPDATE effects SET amount=amount-1 WHERE name='slots'");
      conditions.push("buff"); return {ok:true};
    };
    f.mocks["@/lib/dm/social-tools"].handleSetNpc = () => {
      if (fail) { fail = false; throw new Error("second-tool fault"); }
      return {ok:true};
    };
    f.state.responses.push({content:"",tool_calls:[call("cast_buff"),call("set_npc")]});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"failed");assert.deepEqual(conditions,[]);assert.equal(f.effect("slots"),3);
    const journal = f.mocks["@/lib/db/dm-execution"];
    journal.restoreDmBatch(t,journal.pendingDmBatch(t.id));f.save(t);
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.deepEqual(conditions,["buff"]);assert.equal(f.effect("slots"),2);
  } finally { f.db.close(); }
});

test("R08: a nested dispatcher error does not advance encounter counters", async () => {
  const f=fixture({ encounterNames: ["end_turn"] });
  try {
    let executed = 0;
    f.mocks["@/lib/dm/encounter-tools"].applyEncounterCall = (_campaign, turn) => {
      executed++;
      f.db.exec("UPDATE effects SET amount=amount-1 WHERE name='slots'");
      turn.resolvedCharacterIds.push("pc");
      return {result:{error:"Refused end turn"}};
    };
    const t=f.turn();f.state.responses.push({content:"",tool_calls:[call("end_turn")]});
    await f.engine.reenterDmTurn(f.campaign,t);
    assert.equal(t.status,"done");assert.equal(f.effect("slots"),3);
    assert.deepEqual(t.resolvedCharacterIds,[]);assert.equal(t.encounterCount,0);
    assert.equal(executed,1);
    assert.match(t.conversation.find(entry=>entry.role==="tool").content,/Refused end turn/);
  } finally { f.db.close(); }
});
