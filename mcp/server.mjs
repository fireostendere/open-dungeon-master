import { createHash, timingSafeEqual } from "node:crypto";
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
        text: "Trusted DM only: connect with stateDelta:true, then read until hasMore is false. Keep stateDelta.revision and return it as knownStateRevision; changed entities arrive as upsert/remove/order patches and changed scalar state as set/unset. A full resyncRequired response replaces the baseline after restart/eviction. Use the fully drained nextCursor/currentSeq as expectedSeq for one invoke, narrate, edit_message, delete_message, set_floor, request_response, autopilot_action, or release_floor. Inspect pendingRolls, roll_result events, and recentRolls; the server owns dice. In global-turn mode, a waiting round keeps players locked: wait for global_turn_narrator_trigger and narrate with startGlobalRound equal to its roundNumber; that confirmed narration opens collection. Later wait for global_turn_ready, treat all player messages through that event seq as one round, and narrate with completeGlobalRound equal to its roundNumber; that confirmed MCP write advances and opens the next round. After a write, consume its attached authoritative state delta as the read; if absent/incomplete, drain narrator.read. Always reread after a timeout or error. An ambiguous serialized write may have one immediate receipt-recovery retry only with the saved exact request: same UUID commandId, original expectedSeq, timelineEpoch and all arguments. Never regenerate a payload, expectedSeq or UUID to replay an effect; then checkpoint and escalate. An answer_ask retry also keeps the exact expectedVersion. If timelineEpoch changed, reconnect and discard incompatible pending work. This resource is not a background loop. The bearer is campaign-scoped narrator access, not player access; never put it or DM secrets in player chat.",
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

## Read and write protocol
Call connect and read; follow nextCursor until hasMore is false. Filtering OOC
messages can produce empty pages with a NEW cursor: keep draining them. Use the
fully drained currentSeq as expectedSeq for one invoke, narrate, delete_message, edit_message, autopilot_action, finish_global_round, set_floor, request_response or release_floor.
When global-turn mode is enabled, the server owns the round counter and input gate.
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
remain. Use rules-engine actions or an explicit rewind when mechanics must change.
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

  registerTool(
    "odm_models",
    {
      title: "ODM models and providers",
      description:
        "Inspect, list, test, and switch LLM text models/providers between local runtime and remote servers. Operations: status, list_models, test_and_connect, apply_profile, switch_remote.",
      inputSchema: z.object({
        operation: z
          .enum(["status", "list_models", "test_and_connect", "apply_profile", "switch_remote"])
          .default("status")
          .describe("Operation to perform"),
        provider: z
          .enum(["qwen-local", "qwen", "gemini", "chatgpt"])
          .optional()
          .describe("LLM provider (default: qwen-local for local/remote Ollama, vLLM, etc.)"),
        baseUrl: z
          .string()
          .max(500)
          .optional()
          .describe("Local or remote server URL (e.g. http://127.0.0.1:11434/v1 or http://gpu-server:11434/v1)"),
        remoteUrl: z
          .string()
          .max(500)
          .optional()
          .describe("Remote server URL for switch_remote"),
        model: z
          .string()
          .max(200)
          .optional()
          .describe("Exact model ID to test, connect or switch"),
        apiKey: z
          .string()
          .max(400)
          .optional()
          .describe("API key if required by the provider/server"),
        region: z
          .enum(["international", "china", "token-plan"])
          .optional()
          .describe("Qwen cloud API region"),
        profileId: z
          .string()
          .uuid()
          .optional()
          .describe("Saved profile ID to apply"),
        apply: z
          .boolean()
          .optional()
          .describe("Whether to apply immediately as default DM (default: true)"),
        campaignId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional campaign ID to apply the model specifically to"),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "status":
          return run("models.status", { campaignId: args.campaignId });
        case "list_models":
          return run("models.list", {
            provider: args.provider || "qwen-local",
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
            region: args.region,
          });
        case "test_and_connect":
          return run("models.test_and_connect", {
            provider: args.provider || "qwen-local",
            model: args.model,
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
            region: args.region,
            apply: args.apply !== false,
            campaignId: args.campaignId,
          });
        case "apply_profile":
          return run("models.apply", {
            profileId: args.profileId,
            campaignId: args.campaignId,
          });
        case "switch_remote":
          return run("models.switch_remote", {
            remoteUrl: args.remoteUrl || args.baseUrl,
            model: args.model,
            apiKey: args.apiKey,
            apply: args.apply !== false,
            campaignId: args.campaignId,
          });
      }
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
  "odm_models",
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
