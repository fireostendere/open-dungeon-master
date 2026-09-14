import { createHash, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const VERSION = "0.1.0";
const CONTROL_URL = process.env.ODM_MCP_CONTROL_URL?.trim() || "http://127.0.0.1:3005/api/internal/mcp";
const TOKEN = process.env.ODM_MCP_TOKEN?.trim() || "";
const HOST = process.env.ODM_MCP_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.ODM_MCP_PORT || 3006);

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenMatches(value) {
  if (!TOKEN || !value) return false;
  return timingSafeEqual(digest(value), digest(TOKEN));
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

async function callControl(action, params = {}) {
  if (!TOKEN) {
    throw new Error("ODM_MCP_TOKEN is not configured. The control plane is disabled.");
  }
  const response = await fetch(CONTROL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `ODM control API returned HTTP ${response.status}.`);
  }
  return body?.result;
}

function result(value) {
  const text = JSON.stringify(value, null, 2);
  const structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
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
    return result(await callControl(action, params));
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

  server.registerResource(
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

  server.registerResource(
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

  server.registerTool(
    "odm_server",
    {
      title: "ODM server",
      description: "Inspect the Dungeon Master server. Use status for liveness/counts and capabilities for the complete control action list.",
      inputSchema: z.object({ operation: z.enum(["status", "capabilities"]).default("status") }),
    },
    async ({ operation }) => run(operation === "status" ? "server.status" : "server.capabilities", {}),
  );

  server.registerTool(
    "odm_users",
    {
      title: "ODM users",
      description: "List users and their UUIDs. Use this before creating a campaign for a particular player when more than one admin exists.",
      inputSchema: z.object({}),
    },
    async () => run("users.list", {}),
  );

  server.registerTool(
    "odm_campaigns",
    {
      title: "ODM campaigns",
      description:
        "Create, inspect and administer campaigns/workshops. Operations: list, get, create, update, delete, set_status, regenerate_invite. Delete requires confirm=true.",
      inputSchema: z.object({
        operation: z.enum(["list", "get", "create", "update", "delete", "set_status", "regenerate_invite"]),
        campaignId: z.string().uuid().optional(),
        kind: z.enum(["campaign", "workshop", "all"]).optional(),
        ...ownerRefFields,
        title: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).optional(),
        theme: z.string().trim().max(120).optional(),
        maxPlayers: z.number().int().min(1).max(8).optional(),
        startingLevel: z.number().int().min(1).max(20).optional(),
        difficulty: z.enum(["easy", "normal", "hard", "deadly"]).optional(),
        gameSettings: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(["lobby", "active", "ended"]).optional(),
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
      }
    },
  );

  server.registerTool(
    "odm_campaign_settings",
    {
      title: "ODM campaign settings",
      description:
        "Change game rules, AI/text/image provider settings, or DM mode for a campaign. Story settings may write API keys but reads never reveal stored keys.",
      inputSchema: z.object({
        operation: z.enum(["game", "story", "dm_mode"]),
        campaignId: z.string().uuid(),
        patch: z.record(z.string(), z.unknown()).optional(),
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "odm_sheets",
    {
      title: "ODM live character sheets",
      description:
        "Read or patch live campaign character sheets. This is the game-state control surface for HP, conditions, XP, inventory, abilities, spells, identity and other DM-managed sheet fields.",
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

  server.registerTool(
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
  if (requirePreload) {
    assertRegisteredTools(server, { expectPreload: true });
  }
  return server;
}

async function serveHttp() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("ODM_MCP_PORT must be a valid TCP port.");
  }
  if (!TOKEN) {
    throw new Error("ODM_MCP_TOKEN must be set before the HTTP MCP endpoint can start.");
  }

  const handler = createMcpHandler(createVerifiedMcpServer);
  const nodeHandler = toNodeHandler(handler);
  const http = createHttpServer(async (req, res) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;

    if (pathname === "/healthz") {
      try {
        await callControl("server.status", {});
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

    try {
      await nodeHandler(req, res);
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      if (!res.writableEnded) res.end('{"error":"MCP request failed"}');
    }
  });

  const shutdown = async () => {
    http.close();
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
