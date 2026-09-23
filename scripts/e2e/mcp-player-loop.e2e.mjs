// Production HTTP smoke: real player bearer sessions and an operator-only MCP.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const root = process.cwd();
const remoteOrigin = process.env.ODM_E2E_REMOTE_ORIGIN?.replace(/\/+$/, "");
if (remoteOrigin) assert.equal(new URL(remoteOrigin).hostname, "127.0.0.1", "Remote E2E must stay on server loopback");
const temp = remoteOrigin ? null : fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-player-e2e-"));
let origin = remoteOrigin;
if (!origin) {
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  origin = `http://127.0.0.1:${port}`;
}
const operatorToken = remoteOrigin
  ? fs.readFileSync(process.env.ODM_E2E_MCP_TOKEN_FILE, "utf8").trim()
  : randomBytes(32).toString("hex");
const adminCredentials = remoteOrigin
  ? JSON.parse(fs.readFileSync(process.env.ODM_E2E_ADMIN_JSON, "utf8"))
  : null;
const env = remoteOrigin ? null : {
  ...process.env, NODE_ENV: "production", PORT: new URL(origin).port, COOKIE_SECURE: "0",
  SQLITE_DB_PATH: path.join(temp, "game.sqlite"), DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ODM_MEDIA_ROOT: path.join(temp, "media"), ODM_LOCAL_ORIGIN: origin, ODM_PUBLIC_URL: origin,
  ODM_MCP_TOKEN: operatorToken, NEXT_TELEMETRY_DISABLED: "1", VOICE_ENABLED: "0",
  COMFYUI_URL: "", FLUX_WORKER_URL: "", OLLAMA_BASE_URL: "",
};
if (env) for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete env[key];
let server;
let logs = "";
let adminToken;
const createdUserIds = [];
const campaignTitle = remoteOrigin ? `MCP player loop E2E ${randomBytes(4).toString("hex")}` : "MCP player loop";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function http(method, url, body, token, expected = 200) {
  const res = await fetch(origin + url, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  assert.equal(res.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}
async function mcp(action, params) {
  const body = await http("POST", "/api/internal/mcp", { action, params }, operatorToken);
  assert.equal(body.ok, true, `${action}: ${JSON.stringify(body)}`);
  return body.result;
}
async function token(username, password) {
  return (await http("POST", "/api/auth/token", { username, password })).token;
}
const sheet = name => ({
  name, race: "human", class: "fighter", background: "soldier",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 },
  maxHp: 12, ac: 16, hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics", "perception"], languages: ["common"], tools: [], armor: ["all"], weapons: ["all"] },
});
let campaignId;
const read = () => mcp("narrator.read", { campaignId, projection: "live", maxBytes: 131072, afterSeq: 0 });
async function write(action, params) {
  const state = await read();
  return mcp(action, { campaignId, expectedSeq: state.currentSeq, timelineEpoch: state.timelineEpoch, commandId: randomUUID(), ...params });
}

try {
  if (!remoteOrigin) {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", new URL(origin).port],
      { cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", chunk => { logs += chunk; });
    server.stderr.on("data", chunk => { logs += chunk; });
  }
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { healthy = (await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (healthy) break;
    await sleep(500);
  }
  assert.ok(healthy, `Next server did not start: ${logs.slice(-4000)}`);

  const remoteAdminSession = remoteOrigin ? await http("POST", "/api/auth/token", adminCredentials) : null;
  const admin = remoteAdminSession?.user
    ?? (await http("POST", "/api/auth/register", { username: "loop_admin", password: "TestPass2026!" }, undefined, 201)).user;
  adminToken = remoteAdminSession?.token ?? await token("loop_admin", "TestPass2026!");
  const campaign = (await http("POST", "/api/campaigns", {
    title: campaignTitle, maxPlayers: 3,
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false, worldSimulation: false },
  }, adminToken, 201)).campaign;
  campaignId = campaign.id;
  const dmName = remoteOrigin ? `odm_e2e_dm_${randomBytes(4).toString("hex")}` : "loop_dm";
  const playerName = remoteOrigin ? `odm_e2e_p_${randomBytes(4).toString("hex")}` : "loop_player";
  const dm = (await http("POST", "/api/auth/register", { username: dmName, password: "TestPass2026!", joinCode: campaign.inviteCode }, undefined, 201)).user;
  createdUserIds.push(dm.id);
  const player = (await http("POST", "/api/auth/register", { username: playerName, password: "TestPass2026!", joinCode: campaign.inviteCode }, undefined, 201)).user;
  createdUserIds.push(player.id);
  const playerToken = await token(playerName, "TestPass2026!");
  await mcp("campaigns.join_user", { campaignId, user: { userId: dm.id } });
  await mcp("campaigns.join_user", { campaignId, user: { userId: player.id } });
  await mcp("campaigns.assign_dm_seat", { campaignId, seat: "dm", userId: dm.id });
  const adminSheet = (await http("POST", `/api/campaigns/${campaignId}/sheet`, sheet("Lead Hero"), adminToken, 201)).sheet;
  const playerSheet = (await http("POST", `/api/campaigns/${campaignId}/sheet`, sheet("Second Hero"), playerToken, 201)).sheet;
  await mcp("campaigns.set_status", { campaignId, status: "active" });
  assert.equal((await mcp("narrator.connect", { campaignId, projection: "live" })).state.campaign.status, "active");
  assert.match((await http("POST", "/api/internal/mcp", { action: "narrator.read", params: { campaignId } }, playerToken, 401)).error, /Unauthorized/);
  console.log("PASS admin-only MCP, player seats and active table");

  const first = await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "do", content: "I search the stone arch." }, adminToken, 202);
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "say", content: "I watch the doorway." }, playerToken, 202);
  const ask = (await http("POST", `/api/campaigns/${campaignId}/ask`, { question: "What do I know of this arch?", visibility: "private" }, playerToken, 202)).ask;
  let state = await read();
  assert.ok(state.messages.some(message => message.id === first.messageId));
  assert.ok(state.asks.some(item => item.id === ask.id));
  assert.equal((await http("GET", `/api/campaigns/${campaignId}/ask`, undefined, adminToken)).asks.some(item => item.id === ask.id), false);
  await mcp("narrator.answer_ask", { campaignId, askId: ask.id, expectedVersion: ask.version, answer: "The arch is old dwarven masonry.", commandId: randomUUID() });
  assert.equal((await http("GET", `/api/campaigns/${campaignId}/ask`, undefined, playerToken)).asks.find(item => item.id === ask.id).status, "answered");
  const roll = await write("narrator.invoke", { name: "request_roll", args: { characterId: adminSheet.id, kind: "skill_check", skill: "perception", dc: 12, reason: "Inspect the arch" } });
  state = await read();
  assert.ok(roll.result?.result?.dice?.length || state.pendingRolls.length || state.recentRolls.length,
    `Rules engine must own the die: ${JSON.stringify(roll).slice(0, 1000)}`);
  const narration = await write("narrator.narrate", { content: "The arch bears a weathered dwarven seal." });
  const dmMessageId = narration.result?.messageId;
  assert.ok(dmMessageId, `MCP narration must persist a message: ${JSON.stringify(narration).slice(0, 1000)}`);
  await write("narrator.edit_message", { messageId: dmMessageId, content: "The arch bears an ancient dwarven seal." });
  await write("narrator.delete_message", { messageId: first.messageId });
  const playerView = await http("GET", `/api/campaigns/${campaignId}`, undefined, playerToken);
  assert.ok(JSON.stringify(playerView).includes("ancient dwarven seal"));
  assert.ok(!JSON.stringify(playerView).includes("I search the stone arch."));
  console.log("PASS Do/Say, private Ask, engine roll, MCP narration/edit/delete");

  await mcp("campaigns.update_game_settings", { campaignId, patch: { globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 2, quorumDelayMinutes: 0 } } });
  state = await read();
  const round = state.campaign.globalTurnState.roundNumber;
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "do", content: "Too early" }, adminToken, 409);
  await write("narrator.narrate", { content: "The next exchange begins.", startGlobalRound: round });
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "do", content: "I inspect the seal." }, adminToken, 202);
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "do", content: "I hold the lantern." }, playerToken, 202);
  state = await read();
  assert.equal(state.campaign.globalTurnState.phase, "ready");
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "say", content: "Too late" }, playerToken, 409);
  await write("narrator.narrate", { content: "The seal yields to the party's careful search.", completeGlobalRound: round });
  state = await read();
  assert.equal(state.campaign.globalTurnState.roundNumber, round + 1);
  console.log("PASS global round barrier, quorum and atomic MCP completion");

  await http("POST", `/api/campaigns/${campaignId}/members/${player.id}/autopilot`, { autopilot: true }, playerToken);
  await http("POST", `/api/campaigns/${campaignId}/actions`, { kind: "do", content: "I act manually" }, playerToken, 409);
  state = await read();
  if (state.campaign.globalTurnState.phase === "waiting") {
    await write("narrator.narrate", { content: "Another round opens.", startGlobalRound: round + 1 });
  } else assert.equal(state.campaign.globalTurnState.phase, "active");
  await write("narrator.autopilot_action", { characterId: playerSheet.id, roundNumber: round + 1, kind: "do", content: "I shield the lead." });
  await http("POST", `/api/campaigns/${campaignId}/members/${player.id}/autopilot`, { autopilot: false }, adminToken);
  console.log("PASS player opt-in autopilot and leader override");
} finally {
  if (remoteOrigin && adminToken) {
    const cleanupErrors = [];
    if (campaignId) try {
      assert.equal((await mcp("campaigns.get", { campaignId })).campaign.title, campaignTitle);
      await mcp("campaigns.delete", { campaignId, confirm: true });
    } catch (error) { cleanupErrors.push(error); }
    for (const userId of createdUserIds) try {
      await http("DELETE", `/api/admin/users/${userId}`, undefined, adminToken);
    } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      console.error("Isolated production test cleanup failed:", cleanupErrors);
      process.exitCode = 1;
    } else console.log("PASS isolated production test data removed");
  }
  if (server) {
    try { process.platform === "win32" ? server.kill() : process.kill(-server.pid, "SIGTERM"); } catch {}
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), sleep(4000)]);
  }
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
}
