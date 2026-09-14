import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const PATCHED = Symbol.for("odm.external-tools-preload.patched");
const REGISTERED = Symbol.for("odm.external-tools-preload.registered");
const CONTROL_URL = process.env.ODM_MCP_CONTROL_URL?.trim() || "http://127.0.0.1:3005/api/internal/mcp";
const TOKEN = process.env.ODM_MCP_TOKEN?.trim() || "";

async function callControl(action, params = {}) {
  if (!TOKEN) throw new Error("ODM_MCP_TOKEN is not configured. The control plane is disabled.");
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

function success(value) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

function failure(error) {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

async function run(action, params) {
  try {
    return success(await callControl(action, params));
  } catch (error) {
    return failure(error);
  }
}

function registerExternalTools(server, originalRegisterTool) {
  originalRegisterTool.call(
    server,
    "odm_assets",
    {
      title: "ODM external assets",
      description:
        "Provider-neutral external art bridge. Plan image intents, accept validated external files, manage references/pinning and inspect health. Planning never invokes an image provider.",
      inputSchema: z.object({
        operation: z.enum([
          "plan",
          "accept",
          "reject",
          "status",
          "pin",
          "unpin",
          "delete",
          "list_refs",
          "add_ref",
          "remove_ref",
          "health",
        ]),
        campaign_id: z.string().min(1).max(128).optional(),
        kind: z.string().trim().min(1).max(64).optional(),
        query: z.string().trim().min(1).max(12000).optional(),
        entity_id: z.string().min(1).max(128).optional(),
        reason: z.string().trim().max(4000).optional(),
        constraints: z.unknown().optional(),
        seed: z.union([z.string().max(200), z.number().finite()]).optional(),
        source_hint: z.string().trim().max(500).optional(),
        provider_hint: z.string().trim().max(200).optional(),
        asset_id: z.string().min(1).max(128).optional(),
        temp_path: z.string().trim().min(1).max(4096).optional(),
        uploaded_file_id: z.string().trim().min(1).max(128).optional(),
        metadata: z.unknown().optional(),
        state: z.enum(["planned", "running", "ready", "failed", "rejected", "deleted"]).optional(),
        force: z.boolean().optional(),
        ref_type: z.enum([
          "campaign",
          "session",
          "character",
          "location",
          "item",
          "encounter",
          "quest",
          "journal_entry",
        ]).optional(),
        ref_id: z.string().min(1).max(128).optional(),
        role: z.string().trim().min(1).max(80).optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "plan":
          return run("assets.plan", {
            campaignId: args.campaign_id,
            kind: args.kind,
            query: args.query,
            entityId: args.entity_id,
            reason: args.reason,
            constraints: args.constraints,
            seed: args.seed,
            sourceHint: args.source_hint,
            providerHint: args.provider_hint,
          });
        case "accept":
          return run("assets.accept", {
            assetId: args.asset_id,
            tempPath: args.temp_path,
            uploadedFileId: args.uploaded_file_id,
            metadata: args.metadata,
          });
        case "reject":
          return run("assets.reject", { assetId: args.asset_id, reason: args.reason });
        case "status":
          return run("assets.status", { assetId: args.asset_id, campaignId: args.campaign_id, state: args.state });
        case "pin":
          return run("assets.pin", { assetId: args.asset_id });
        case "unpin":
          return run("assets.unpin", { assetId: args.asset_id });
        case "delete":
          return run("assets.delete", { assetId: args.asset_id, force: args.force || false });
        case "list_refs":
          return run("assets.list_refs", { assetId: args.asset_id });
        case "add_ref":
          return run("assets.add_ref", {
            assetId: args.asset_id,
            refType: args.ref_type,
            refId: args.ref_id,
            role: args.role,
          });
        case "remove_ref":
          return run("assets.remove_ref", {
            assetId: args.asset_id,
            refType: args.ref_type,
            refId: args.ref_id,
            role: args.role,
          });
        case "health":
          return run("assets.health", { campaignId: args.campaign_id });
      }
    },
  );

  originalRegisterTool.call(
    server,
    "odm_progress",
    {
      title: "ODM character progress",
      description:
        "Versioned synchronization of durable campaign character progression back to the canonical character library, with append-only audit events. Live HP/conditions remain campaign-local.",
      inputSchema: z.object({
        operation: z.enum(["sync", "bulk_sync", "status", "events"]),
        character_id: z.string().min(1).max(128).optional(),
        campaign_id: z.string().min(1).max(128).optional(),
        expected_version: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "sync":
          return run("progress.sync", {
            characterId: args.character_id,
            expectedVersion: args.expected_version,
          });
        case "bulk_sync":
          return run("progress.bulk_sync", { campaignId: args.campaign_id });
        case "status":
          return run("progress.status", { characterId: args.character_id });
        case "events":
          return run("progress.events", { characterId: args.character_id, limit: args.limit || 50 });
      }
    },
  );
}

if (!McpServer.prototype[PATCHED]) {
  const originalRegisterTool = McpServer.prototype.registerTool;
  Object.defineProperty(McpServer.prototype, PATCHED, { value: true });
  McpServer.prototype.registerTool = function patchedRegisterTool(...args) {
    if (!this[REGISTERED]) {
      Object.defineProperty(this, REGISTERED, { value: true });
      registerExternalTools(this, originalRegisterTool);
    }
    return originalRegisterTool.apply(this, args);
  };
}
