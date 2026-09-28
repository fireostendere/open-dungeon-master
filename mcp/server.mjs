import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { callControl, withMcpCancellation, withMcpCredential } from "./control-client.mjs";
import { createSafeHttpListener } from "./http-boundary.mjs";
import { narratorInputSchema } from "./narrator-schema.mjs";

const VERSION = "0.1.0";
const TOKEN = process.env.ODM_MCP_TOKEN?.trim() || "";
const NARRATOR_TOKEN = process.env.ODM_MCP_NARRATOR_TOKEN?.trim() || "";
const UPSTREAM_TOKEN = process.env.ODM_MCP_UPSTREAM_TOKEN?.trim() || TOKEN;
const NARRATOR_ONLY = /^(1|true)$/i.test(process.env.ODM_MCP_NARRATOR_ONLY?.trim() || "");
const NARRATOR_CAMPAIGN_ID = process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID?.trim() || "";
const HOST = process.env.ODM_MCP_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.ODM_MCP_PORT || 3006);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenMatches(value) {
  if (!value) return false;
  const accepted = NARRATOR_ONLY ? [NARRATOR_TOKEN] : [TOKEN, NARRATOR_TOKEN];
  return accepted.filter(Boolean).some(token => timingSafeEqual(digest(value), digest(token)));
}

function bearerFrom(headers) {
  const raw = headers.authorization || "";
  if (!raw.startsWith("Bearer ")) return "";
  return raw.slice(7).trim();
}

function allowedOrigin(origin) {
  if (!origin) return true;
  const allowed = (process.env.ODM_MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.length) return false;
  try {
    const normalized = new URL(origin).origin;
    return allowed.includes(normalized);
  } catch {
    return false;
  }
}

export function formatToolResult(value, options = {}) {
  const pretty = /^(1|true)$/i.test(process.env.ODM_MCP_PRETTY?.trim() || "");
  const compact = options.compact ?? !pretty;
  const text = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  const response = { content: [{ type: "text", text }] };
  const structured = options.structured ?? /^(1|true)$/i.test(process.env.ODM_MCP_STRUCTURED_RESULTS?.trim() || "");
  if (structured) response.structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return response;
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function run(action, params) {
  try {
    if (NARRATOR_ONLY && (!action.startsWith("narrator.") || params?.campaignId !== NARRATOR_CAMPAIGN_ID)) {
      throw new Error("This MCP is restricted to its configured narrator campaign.");
    }
    const compact = params?.compact ?? (action.startsWith('narrator.') ? true : undefined);
    return formatToolResult(await callControl(action, params), { compact });
  } catch (error) {
    return failure(error);
  }
}

const LOCAL_TTS_ENABLED = /^(1|true)$/i.test(process.env.ODM_LOCAL_TTS_ENABLED?.trim() || "");
const LOCAL_TTS_URL = "http://127.0.0.1:" + (process.env.ODM_LOCAL_TTS_PORT?.trim() || "8875");
let localTtsProcess;
let localTtsToken;
let localTtsStarting;

async function localTtsHealth() {
  if (!localTtsToken) return false;
  try {
    const response = await fetch(LOCAL_TTS_URL + "/healthz", {
      headers: { Authorization: "Bearer " + localTtsToken },
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureLocalTts() {
  if (!LOCAL_TTS_ENABLED) throw new Error("Local voiceover is not enabled in this narrator profile.");
  if (await localTtsHealth()) return;
  if (!localTtsStarting) {
    localTtsToken ??= randomBytes(32).toString("hex");
    const script = fileURLToPath(new URL("../scripts/local-tts-server.py", import.meta.url));
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const cache = process.env.ODM_LOCAL_TTS_CACHE?.trim() || path.join(appRoot, "node_modules", ".cache", "odm-tts");
    const python = process.env.ODM_LOCAL_TTS_PYTHON?.trim() || path.join(cache, ".venv", "bin", "python");
    localTtsProcess = spawn(python, [script], {
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        // Do not inherit LD_LIBRARY_PATH: it may shadow this WSL's matching ROCm runtime.
        HOME: process.env.HOME || "",
        PATH: process.env.PATH || "",
        ODM_LOCAL_TTS_CACHE: cache,
        ODM_LOCAL_TTS_PORT: process.env.ODM_LOCAL_TTS_PORT?.trim() || "8875",
        ODM_LOCAL_TTS_TOKEN: localTtsToken,
        PYTHONUNBUFFERED: "1",
      },
    });
    localTtsProcess.once("exit", () => { localTtsProcess = undefined; });
    localTtsProcess.once("error", () => { localTtsProcess = undefined; });
    localTtsStarting = (async () => {
      for (let attempt = 0; attempt < 900; attempt += 1) {
        if (await localTtsHealth()) return;
        if (!localTtsProcess || localTtsProcess.exitCode !== null) {
          throw new Error("Local TTS process exited before it became ready.");
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("Local TTS service did not become ready.");
    })().finally(() => { localTtsStarting = undefined; });
  }
  await localTtsStarting;
}

process.once("exit", () => { localTtsProcess?.kill(); });

async function localVoiceover(args) {
  try {
    if (!args.messageId || !args.voiceoverSegments?.length) {
      throw new Error("Provide the exact DM messageId and its voiceover segments.");
    }
    const totalCharacters = args.voiceoverSegments.reduce((sum, segment) => sum + segment.text.length, 0);
    if (totalCharacters > 3000) throw new Error("Narration is too long for one live voiceover.");
    await ensureLocalTts();
    const response = await fetch(LOCAL_TTS_URL + "/synthesize", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + localTtsToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ segments: args.voiceoverSegments }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error.slice(0, 1000) || "Local voice generation failed.");
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 12 * 1024 * 1024) {
      throw new Error("Generated voiceover exceeds the 12 MiB upload limit.");
    }
    const stored = await callControl("narrator.store_audio", {
      campaignId: args.campaignId,
      messageId: args.messageId,
      mimeType: "audio/wav",
      audioBase64: audio.toString("base64"),
    });
    return formatToolResult(stored, { compact: true });
  } catch (error) {
    return failure(error);
  }
}

const userRefFields = {
  userId: z.string().uuid().optional().describe("ODM user UUID"),
  username: z.string().trim().min(1).max(80).optional().describe("ODM username"),
};

const ownerRefFields = {
  ownerUserId: z.string().uuid().optional().describe("Campaign/character owner UUID"),
  ownerUsername: z.string().trim().min(1).max(80).optional().describe("Campaign/character owner username"),
};

// The known settings stay discoverable in tools/list while catchall preserves
// application settings the sidecar does not own.
const gameSettingsInputSchema = z.object({
  combatMode: z.enum(["classical", "jrpg"]).optional(),
  unitSystem: z.enum(["metric", "imperial"]).optional(),
}).catchall(z.unknown());

function ownerRef(args) {
  return { userId: args.ownerUserId, username: args.ownerUsername };
}

function userRef(args) {
  return { userId: args.userId, username: args.username };
}

function createMcpServer() {
  const server = new McpServer(
    { name: "open-dungeon-master", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );
  const registerTool = (name, config, callback) => server.registerTool(name, config, withMcpCancellation(callback));
  const registerResource = (name, uri, config, callback) => server.registerResource(name, uri, config, withMcpCancellation(callback));

  if (!NARRATOR_ONLY) {
    registerResource(
      "server-status",
      "odm://server/status",
      {
        title: "Open Dungeon Master server status",
        description: "Live health and object counts for the connected ODM instance.",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await callControl("server.status", {}), null, 2),
          },
        ],
      }),
    );
  }

  registerResource(
    "external-narrator-instructions",
    "odm://narrator/instructions",
    {
      title: "External narrator instructions",
      description: "Protocol for a trusted external MCP narrator in a human-DM, no-server-AI campaign.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: "Trusted DM only: connect with stateDelta:true, then read until hasMore is false. Keep stateDelta.revision and return it as knownStateRevision; changed entities arrive as upsert/remove/order patches and changed scalar state as set/unset. A full resyncRequired response replaces the baseline after restart/eviction. Use the fully drained nextCursor/currentSeq as expectedSeq for one invoke, narrate, edit_message, delete_message, set_floor, request_response, autopilot_action, finish_global_round, or release_floor. finish_global_round is only the no-prose spatial global-turn finalizer after every required room narration. Inspect pendingRolls, roll_result events, and recentRolls; the server owns dice. A player submits exactly one Do per turn, including dialogue. In combat, the first accepted Do leaves the floor held until DM resolution and end_turn. In global-turn mode, actionsByCharacter locks that character until round completion: a waiting round keeps players locked, so wait for global_turn_narrator_trigger and narrate with startGlobalRound equal to its roundNumber; that confirmed narration opens collection. Later wait for global_turn_ready, treat all player messages through that event seq as one round, and narrate with completeGlobalRound equal to its roundNumber; that confirmed MCP write advances and opens the next round. After a write, consume its attached authoritative state delta as the read; if absent/incomplete, drain narrator.read. Always reread after a timeout or error. An ambiguous serialized write may have one immediate receipt-recovery retry only with the saved exact request: same UUID commandId, original expectedSeq, timelineEpoch and all arguments. Never regenerate a payload, expectedSeq or UUID to replay an effect; then checkpoint and escalate. An answer_ask retry also keeps the exact expectedVersion. If timelineEpoch changed, reconnect and discard incompatible pending work. This resource is not a background loop. The bearer is campaign-scoped narrator access, not player access; never put it or DM secrets in player chat.",
      }],
    }),
  );

  registerResource(
    "narrator-playbook",
    "odm://narrator/playbook",
    {
      title: "External narrator playbook",
      description: "Rules-engine, cursor, private Ask and dialogue guidance for a trusted external DM.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# External narrator playbook

You describe the world and play NPCs. Players decide their own character actions.
The server owns dice, HP, slots, initiative and inventory. Never invent a roll or
claim an action succeeded before the authoritative result has arrived.

Set status=thinking immediately before an actual model-provider call and restore
status=idle in a finally block. Do not show thinking merely because input is queued.

## Read and write protocol
Call connect and read; follow nextCursor until hasMore is false. Filtering OOC
messages can produce empty pages with a NEW cursor: keep draining them. Use the
fully drained currentSeq as expectedSeq for one invoke, narrate, delete_message,
edit_message, autopilot_action, finish_global_round, set_floor, request_response
or release_floor. finish_global_round is only
the no-prose spatial global-turn finalizer after every required room narration.
When global-turn mode is enabled, the server owns the round counter and input gate.
A player submits exactly one Do per turn, with dialogue included in that Do. The first
accepted Do locks that character in actionsByCharacter until the DM completes the round.
A waiting round accepts no player input. Wait for global_turn_narrator_trigger, narrate
the opening/transition, and send startGlobalRound=roundNumber; only that committed MCP
write opens collection. While collection is active, an explicitly opted-in member may
be represented only by the host's isolated actor role using autopilot_action with the
current characterId and roundNumber. Never invent an action for a non-opted-in player;
the server rechecks opt-in, skip/mute/floor, round freshness and duplicate actions.
Outside global-turn mode, a spotlighted opted-in player may act via autopilot_action
without roundNumber. The lead chooses the spotlight; the host waits for the selected
players before resolving ordinary input. A lead response request may wake the host
earlier, and takes priority over later ordinary input. The lead's private director
directive is visible only in the authenticated narrator read, never player chat.
Then do not resolve player messages individually: wait for global_turn_ready, batch all
player messages through its seq, and send the final round
narration with completeGlobalRound=roundNumber. In location-private spatial mode,
narrate every affected input.roomIds room with location_narrate; after all such
writes the host uses an internal no-prose finalizer before unlocking. That final
committed write advances the counter and opens the next round.
Consume the attached state after a write; drain missing pages/events with read.
delete_message removes the exact main-transcript messageId, including player, DM or
system messages. It removes transcript-derived pins/beats, but it is not a gameplay
rewind: authoritative rolls and mechanical state survive, and moderation audit records
remain. If it deletes the exact held combat submission, inputReopened confirms whether
the same player's turn was reopened; check the floor before telling the player to act.
If it is still held, use request_player_input for that same actor only when its combat
guards allow it. Spent actions and rolls stay spent. Use rules-engine actions or an explicit rewind when mechanics must change.
edit_message changes exact main-transcript text while retaining its author and
preserving every roll marker. Edits and deletions invalidate queued narrator text;
reread before acting. Neither operation rewinds mechanics or private Ask/whispers.
Always read after a timeout or error, including 409. A readRequired flag on a
successful receipt means only the post-commit read failed: never replay the effect. An ambiguous serialized
write gets at most one immediate receipt-recovery retry with the saved exact
request: same UUID commandId, original expectedSeq, timelineEpoch and all
arguments. Never regenerate payload, expectedSeq or UUID to replay an effect;
then checkpoint and escalate. An answer_ask retry also keeps exact expectedVersion.
If timelineEpoch changed, reconnect and discard incompatible pending work. This
resource does not run a background loop or wake an agent by itself.

Use live reads with delta:true and stateDelta:true. The first read is a full
authoritative baseline; keep stateDelta.revision and send it as
knownStateRevision. Later reads return only stable-ID entity upserts/removals/order
plus changed scalar state. Verify/apply patches only to the matching
campaign/timeline/projection baseline. resyncRequired:true with full:true replaces
the baseline after cache eviction or server restart. Legacy knownSections exists
only for old clients.

Connect with stateDelta:true is metadata-only and does not echo the full state.
Install the full policy as trusted host instructions. Catalog summaries are the
default; request one action schema when needed. readAfter may carry the same
knownStateRevision and returns authoritative post-write state in the same command.
Consume all byte pages and story events before advancing; never advance on a
partial read. Post-write page requests use the exact returned readAfter parameters.
Story writes attach bounded state by default. Use it for HP, seq and current actor;
do not follow a complete receipt with a redundant snapshot/read. Normal compound
turn: read input -> combat_turn with readAfter -> one narrate with readAfter.
Cache action schemas and rules evidence; look up only unresolved new questions.

## Rules and combat
Use catalog to obtain the current argument schemas. Request real skill/save/damage
rolls through the engine and inspect pendingRolls, roll_result and recentRolls.
Start an encounter before narrating a fight as active. Initiative controls the floor.
Move tokens through move_token; forced movement is for a justified DM override,
not a shortcut around normal movement budgets. pc_attack uses characterId and
both enemyId and targetEnemyId set to the same current target. cast_at_enemy is for one saving-throw
spell and requires targetEnemyId, spell and saveAbility; attack-roll spells use
pc_attack. request_roll attack/damage/custom calls require an expression, while
combat attacks should use pc_attack. The engine adjudicates hits and damage. Do not apply the
same damage or reward again. Use grant_item/award_xp for an explicit new award.
Use supported campaign controls for scene and quest-log changes.

A complete player Do is one turn, whether an attack, healing or a pet command.
Resolve ALL declared parts, then end once, then publish ONE scene. Do not ask for
undeclared bonus actions. Use combat_turn(characterId,steps:[{name,args}]) for a
compound plan; completed already ended initiative. blocked/awaiting_rolls preserves
earlier steps: continue from nextStep, never replay the bundle. Single supported
actions accept completeTurn:true. Attack spells use pc_attack.spell, buffs use
cast_buff, healing uses heal(spell,casterId,characterId,level) and already spends
the slot/action. Pet attacks use targetEnemyId and a real sheet.pets entry.
If a player message includes the validated combatTurn object, use its ordered choices
and IDs exactly; the optional description adds dialogue/flavor, not an extra
mechanical action. Clarify contradictions rather than invent steps. Copy
action.cunningAction as take_action.cunningAction:true, attach attack.sneakAttack to
that pc_attack, and resolve the declared list in one combat_turn call. A completed
receipt already ended initiative; an argument refusal is not a fictional miss.
Browsing a dropdown never declares a feature. Only queued actions or clear prose
authorize optional abilities/resources; queued actions have application priority.
Free-text-only intent, including YOLO slang, is valid without exact ability names.
Clarify real contradictions/cancellations instead of applying both. No prose with
a queued plan means resolve it and give a concise outcome, not invent player speech.
Sneak Attack requires pc_attack(sneakAttack:true) from that declared intent.
2014 Mercy: use_resource(ki,variant:hand_of_healing,targetCharacterId) pays the
action/ki and rolls/applies healing. flurry_of_healing pays bonus/ki after Attack,
replaces one Flurry strike with healing; the other declared strike uses
pc_attack(weapon:'Unarmed strike',flurry:true). Check touch range in the scene.
Bundle these in combat_turn; do not use a separate healing roll or heal command.
For necessary clarification, request_player_input to the one current actor opens
the SAME turn without resetting budgets or rolls. Verify the floor before waiting.
Argument errors are not in-world misses. Do not replace a failed call with a
different attack or an invented failure. In YOLO tone, write 2–4 vivid short
paragraphs with impact, NPC reactions, dark humor and fitting profanity/emoji;
ordinary brevity must not turn the scene into an HP report.
Exception: an explicitly queued plan with no prose gets a concise neutral outcome,
even in YOLO. Attach a declared rider such as Sneak Attack to its attack, not a
separate action; do not invent player dialogue or an additional ability.

## Dialogue and private questions
Player speech, actions and OOC have different visual styles. OOC is absent from
narrator message/event projections; it is still stored and visible in player chat.
Inspect asks on EVERY read, even when the story cursor did not change. Human-mode
submissions receive an acknowledgement; answer via answer_ask using the askId in
this campaign and optional grounded citations. It changes no scene/floor state.
Private questions and answers are for the asker and the trusted DM only. Never
copy them into shared narration or table events. Notification events contain no
question or answer. A continuous client must actually schedule reads/subscribe to
its authorized notifications; an undocumented host watch script is not guaranteed.

The bearer is operator-wide, not a per-player credential. Never expose it, private
questions, private whispers, DM outlines or other DM secrets to the table.
` }] }),
  );

  if (!NARRATOR_ONLY) {
    registerResource(
      "control-capabilities",
      "odm://server/capabilities",
      {
        title: "Open Dungeon Master MCP control capabilities",
        description: "The internal actions this MCP server can perform.",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await callControl("server.capabilities", {}), null, 2),
          },
        ],
      }),
    );
  }

  registerTool(
    "odm_narrator",
    {
      title: "External campaign narrator",
      description: "Trusted external DM lifecycle for human mode with server LLM, TTS, and automatic maps disabled. Contract v4 supports stateDelta/knownStateRevision so unchanged game state is not resent; connect can be metadata-only and readAfter can carry the authoritative post-write delta. Reread after errors; an ambiguous serialized write gets at most one immediate exact receipt-recovery retry with the same commandId, expectedSeq, timelineEpoch and arguments, never regenerated values. answer_ask also keeps exact expectedVersion. See odm://narrator/playbook.",
      inputSchema: narratorInputSchema,
    },
    async (args) => {
      if (args.operation === "voiceover") return localVoiceover(args);
      const action = `narrator.${args.operation}`;
      const params = { ...args };
      delete params.operation;
      return run(action, params);
    },
  );

  if (NARRATOR_ONLY) return server;

  registerTool(
    "odm_server",
    {
      title: "ODM server",
      description: "Inspect the Dungeon Master server. Use status for liveness/counts and capabilities for the complete control action list.",
      inputSchema: z.object({ operation: z.enum(["status", "capabilities"]).default("status") }),
    },
    async ({ operation }) => run(operation === "status" ? "server.status" : "server.capabilities", {}),
  );

  registerTool(
    "odm_users",
    {
      title: "ODM users",
      description: "List users and their UUIDs. Use this before creating a campaign for a particular player when more than one admin exists.",
      inputSchema: z.object({}),
    },
    async () => run("users.list", {}),
  );

  registerTool(
    "odm_campaigns",
    {
      title: "ODM campaigns",
      description:
        "Create, inspect and administer campaigns/workshops. Operations: list, get, create, update, delete, set_status, regenerate_invite, assign_dm_seat. gameSettings.combatMode is classical (default) or jrpg. Delete requires confirm=true.",
      inputSchema: z.object({
        operation: z.enum(["list", "get", "create", "update", "delete", "set_status", "regenerate_invite", "assign_dm_seat"]),
        campaignId: z.string().uuid().optional(),
        kind: z.enum(["campaign", "workshop", "all"]).optional(),
        ...ownerRefFields,
        title: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).optional(),
        theme: z.string().trim().max(120).optional(),
        maxPlayers: z.number().int().min(1).max(8).optional(),
        startingLevel: z.number().int().min(1).max(20).optional(),
        difficulty: z.enum(["easy", "normal", "hard", "deadly"]).optional(),
        gameSettings: gameSettingsInputSchema.optional(),
        status: z.enum(["lobby", "active", "ended"]).optional(),
        seat: z.enum(["dm", "assistant"]).optional(),
        userId: z.string().uuid().nullable().optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "list":
          return run("campaigns.list", { kind: args.kind || "campaign" });
        case "get":
          return run("campaigns.get", { campaignId: args.campaignId });
        case "create":
          return run("campaigns.create", {
            owner: ownerRef(args),
            title: args.title,
            description: args.description,
            theme: args.theme,
            maxPlayers: args.maxPlayers,
            startingLevel: args.startingLevel,
            difficulty: args.difficulty,
            kind: args.kind === "workshop" ? "workshop" : "campaign",
            gameSettings: args.gameSettings,
          });
        case "update": {
          const patch = Object.fromEntries(
            ["title", "description", "theme", "maxPlayers", "startingLevel", "difficulty"]
              .filter((key) => args[key] !== undefined)
              .map((key) => [key, args[key]]),
          );
          return run("campaigns.update", { campaignId: args.campaignId, patch });
        }
        case "delete":
          return run("campaigns.delete", { campaignId: args.campaignId, confirm: args.confirm });
        case "set_status":
          return run("campaigns.set_status", { campaignId: args.campaignId, status: args.status });
        case "regenerate_invite":
          return run("campaigns.regenerate_invite", { campaignId: args.campaignId });
        case "assign_dm_seat":
          return run("campaigns.assign_dm_seat", { campaignId: args.campaignId, seat: args.seat, userId: args.userId });
      }
    },
  );

  registerTool(
    "odm_campaign_settings",
    {
      title: "ODM campaign settings",
      description:
        "Change game rules, AI/text/image providers, or DM mode for a campaign. For game patches combatMode accepts classical (default) or jrpg; other game-setting keys pass through unchanged. Story settings may write API keys but reads never reveal stored keys.",
      inputSchema: z.object({
        operation: z.enum(["game", "story", "dm_mode"]),
        campaignId: z.string().uuid(),
        patch: gameSettingsInputSchema.optional(),
        mode: z.enum(["ai", "human", "assisted"]).optional(),
        actorUserId: z.string().uuid().optional(),
        actorUsername: z.string().trim().min(1).max(80).optional(),
      }),
    },
    async (args) => {
      if (args.operation === "game") {
        return run("campaigns.update_game_settings", { campaignId: args.campaignId, patch: args.patch || {} });
      }
      if (args.operation === "story") {
        return run("campaigns.update_story_settings", { campaignId: args.campaignId, patch: args.patch || {} });
      }
      return run("campaigns.set_dm_mode", {
        campaignId: args.campaignId,
        mode: args.mode,
        actor:
          args.actorUserId || args.actorUsername
            ? { userId: args.actorUserId, username: args.actorUsername }
            : undefined,
      });
    },
  );

  registerTool(
    "odm_story",
    {
      title: "ODM story control",
      description:
        "Operate live story state. Set scene, quest log, secret DM outline, structured story arc, read persisted campaign events, or send an MCP notice to connected players.",
      inputSchema: z.object({
        operation: z.enum(["set_scene", "set_quest_log", "set_outline", "set_arc", "events", "announce"]),
        campaignId: z.string().uuid(),
        scene: z.string().max(2_000).optional(),
        quests: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
        outline: z.string().max(8_000).optional(),
        arc: z.unknown().optional(),
        afterSeq: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        message: z.string().trim().min(1).max(1_000).optional(),
        level: z.enum(["info", "warning"]).optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "set_scene":
          return run("campaigns.set_scene", { campaignId: args.campaignId, scene: args.scene });
        case "set_quest_log":
          return run("campaigns.set_quest_log", { campaignId: args.campaignId, quests: args.quests });
        case "set_outline":
          return run("campaigns.set_outline", { campaignId: args.campaignId, outline: args.outline });
        case "set_arc":
          return run("campaigns.set_story_arc", { campaignId: args.campaignId, arc: args.arc });
        case "events":
          return run("campaigns.events", {
            campaignId: args.campaignId,
            afterSeq: args.afterSeq || 0,
            limit: args.limit || 100,
          });
        case "announce":
          return run("campaigns.announce", {
            campaignId: args.campaignId,
            message: args.message,
            level: args.level || "info",
          });
      }
    },
  );

  registerTool(
    "odm_members",
    {
      title: "ODM campaign members",
      description: "List members, add an existing ODM user to a campaign, or transfer party lead. Identify the user by UUID or username.",
      inputSchema: z.object({
        operation: z.enum(["list", "join", "set_lead"]),
        campaignId: z.string().uuid(),
        ...userRefFields,
      }),
    },
    async (args) => {
      if (args.operation === "list") return run("campaigns.members", { campaignId: args.campaignId });
      return run(args.operation === "join" ? "campaigns.join_user" : "campaigns.set_lead", {
        campaignId: args.campaignId,
        user: userRef(args),
      });
    },
  );

  registerTool(
    "odm_characters",
    {
      title: "ODM character library",
      description:
        "Manage library characters and instantiate them into a campaign. Creating/updating requires a complete ODM create-sheet object. Delete requires confirm=true.",
      inputSchema: z.object({
        operation: z.enum(["list", "get", "create", "update", "delete", "instantiate"]),
        ...ownerRefFields,
        characterId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        level: z.number().int().min(1).max(20).optional(),
        targetLevel: z.number().int().min(1).max(20).optional(),
        role: z.enum(["pc", "companion"]).optional(),
        workshopId: z.string().max(100).optional(),
        sheet: z.record(z.string(), z.unknown()).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "list":
          return run("characters.list", { owner: ownerRef(args), role: args.role });
        case "get":
          return run("characters.get", { characterId: args.characterId });
        case "create":
          return run("characters.create", {
            owner: ownerRef(args),
            level: args.level,
            role: args.role || "pc",
            workshopId: args.workshopId || "",
            sheet: args.sheet,
          });
        case "update":
          return run("characters.update", {
            characterId: args.characterId,
            level: args.level,
            sheet: args.sheet,
          });
        case "delete":
          return run("characters.delete", { characterId: args.characterId, confirm: args.confirm });
        case "instantiate":
          return run("characters.instantiate", {
            characterId: args.characterId,
            campaignId: args.campaignId,
            targetLevel: args.targetLevel,
          });
      }
    },
  );

  registerTool(
    "odm_sheets",
    {
      title: "ODM live character sheets",
      description:
        "Read or patch live campaign character sheets. This is the game-state control surface for HP, conditions, XP, inventory, abilities, spells, identity and other DM-managed fields.",
      inputSchema: z.object({
        operation: z.enum(["list", "get", "patch"]),
        campaignId: z.string().uuid().optional(),
        sheetId: z.string().uuid().optional(),
        patch: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async (args) => {
      if (args.operation === "list") return run("sheets.list", { campaignId: args.campaignId });
      if (args.operation === "get") return run("sheets.get", { sheetId: args.sheetId });
      return run("sheets.patch", { sheetId: args.sheetId, patch: args.patch || {} });
    },
  );

  return server;
}

export const BASE_MCP_TOOLS = Object.freeze([
  "odm_server",
  "odm_users",
  "odm_campaigns",
  "odm_campaign_settings",
  "odm_story",
  "odm_members",
  "odm_characters",
  "odm_sheets",
  "odm_narrator",
]);

export const PRELOAD_MCP_TOOLS = Object.freeze([
  "odm_assets",
  "odm_progress",
]);

export const ALL_EXPECTED_MCP_TOOLS = Object.freeze([
  ...PRELOAD_MCP_TOOLS,
  ...BASE_MCP_TOOLS,
].sort());

export function assertRegisteredTools(server, { expectPreload = true } = {}) {
  const registered = Object.keys(server._registeredTools || {}).sort();
  const expected = (expectPreload ? ALL_EXPECTED_MCP_TOOLS : BASE_MCP_TOOLS).slice().sort();
  const missing = expected.filter((tool) => !registered.includes(tool));
  if (missing.length > 0) {
    throw new Error(
      `MCP tools verification failed: missing expected tool(s) [${missing.join(", ")}]. Registered: [${registered.join(", ")}]`
    );
  }
  return registered;
}

export function createVerifiedMcpServer(options = {}) {
  const server = createMcpServer();
  const requirePreload =
    options.expectPreload ??
    (process.env.ODM_MCP_REQUIRE_PRELOAD !== "0" &&
      process.env.ODM_MCP_REQUIRE_PRELOAD !== "false");
  if (requirePreload && !NARRATOR_ONLY) {
    assertRegisteredTools(server, { expectPreload: true });
  } else if (NARRATOR_ONLY) {
    const registered = Object.keys(server._registeredTools || {}).sort();
    if (registered.length !== 1 || registered[0] !== "odm_narrator") {
      throw new Error(`Narrator-only MCP registered unexpected tools: [${registered.join(", ")}]`);
    }
  }
  return server;
}

async function serveHttp() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("ODM_MCP_PORT must be a valid TCP port.");
  }
  if (!TOKEN && !NARRATOR_TOKEN) {
    throw new Error("ODM_MCP_TOKEN or ODM_MCP_NARRATOR_TOKEN must be set before the HTTP MCP endpoint can start.");
  }
  if (NARRATOR_ONLY && (!NARRATOR_TOKEN || NARRATOR_TOKEN.length < 32 || /\s/.test(NARRATOR_TOKEN) || !UUID.test(NARRATOR_CAMPAIGN_ID) || !UPSTREAM_TOKEN)) {
    throw new Error("Narrator-only MCP requires a distinct token, campaign UUID and upstream control token.");
  }

  const handler = createMcpHandler(createVerifiedMcpServer);
  const nodeHandler = toNodeHandler(handler);
  const http = createHttpServer(createSafeHttpListener(async (req, res, pathname) => {

    if (pathname === "/healthz") {
      try {
        await callControl("server.status", {}, { timeout: 5_000 });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
        res.end('{"ok":false}');
      }
      return;
    }

    if (pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"Not found"}');
      return;
    }

    if (!allowedOrigin(req.headers.origin)) {
      res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"error":"Origin not allowed"}');
      return;
    }

    if (!tokenMatches(bearerFrom(req.headers))) {
      res.writeHead(401, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "www-authenticate": 'Bearer realm="open-dungeon-master-mcp"',
      });
      res.end('{"error":"Unauthorized"}');
      return;
    }

    await withMcpCredential(NARRATOR_ONLY ? UPSTREAM_TOKEN : bearerFrom(req.headers), () => nodeHandler(req, res));
  }, {
    onError: (error) => console.error("MCP request failed:", error instanceof Error ? error.message : String(error)),
  }));

  const shutdown = async () => {
    http.close();
    await callControl.close?.();
    await handler.close().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(PORT, HOST, () => {
      console.error(`Open Dungeon Master MCP ${VERSION} listening on http://${HOST}:${PORT}/mcp`);
      resolve();
    });
  });
}

export { createMcpServer, serveHttp, serveStdio };

const isDirectRun =
  Boolean(process.argv[1]) &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith("/server.mjs") ||
    process.argv[1].endsWith("\\server.mjs"));

if (isDirectRun) {
  if (process.argv.includes("--stdio")) {
    await serveStdio(createVerifiedMcpServer);
  } else {
    await serveHttp();
  }
}
