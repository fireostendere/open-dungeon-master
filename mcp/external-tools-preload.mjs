import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { callControl, withMcpCancellation } from "./control-client.mjs";
import { registerDmPolicy } from "./dm-policy.mjs";

const PATCHED = Symbol.for("odm.external-tools-preload.patched");
const REGISTERED = Symbol.for("odm.external-tools-preload.registered");
const NARRATOR_ONLY = /^(1|true)$/i.test(process.env.ODM_MCP_NARRATOR_ONLY?.trim() || "");
function success(value) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent };
}

function failure(error) {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
}

async function run(action, params) {
  try {
    return success(await callControl(action, params));
  } catch (error) {
    return failure(error);
  }
}

const artKind = z.enum([
  "campaign_cover",
  "party_group",
  "character_portrait",
  "npc_portrait",
  "character_fullbody",
  "npc_fullbody",
  "location_art",
  "scene_art",
  "world_map",
  "regional_map",
  "dungeon_map",
  "battlemap",
  "item_art",
  "item_card",
  "handout",
  "token",
  "chapter_cover",
  "session_recap",
  "generic",
]);
const entityType = z.enum([
  "campaign",
  "character",
  "npc",
  "scene",
  "location",
  "map",
  "chapter",
  "item",
  "session",
  "encounter",
  "quest",
  "handout",
  "generic",
]);
const jobStatus = z.enum(["planned", "available", "claimed", "uploading", "ready", "failed", "cancelled"]);
const packStatus = z.enum(["planned", "active", "ready", "failed", "cancelled"]);

function registerExternalTools(server, originalRegisterTool) {
  registerDmPolicy(server, withMcpCancellation);
  const register = (name, config, callback) => originalRegisterTool.call(server, name, config, withMcpCancellation(callback));
  register(
    "odm_assets",
    {
      title: "ODM external asset pipeline",
      description:
        "Provider-neutral art packs/jobs for external image agents. Plan a campaign backlog, claim work with a lease, request scoped binary upload/download grants, submit variants and attach ready assets to game entities.",
      inputSchema: z.object({
        operation: z.enum([
          "plan_campaign",
          "create_pack",
          "get_pack",
          "list_packs",
          "list_jobs",
          "get_job",
          "claim_job",
          "release_job",
          "fail_job",
          "create_upload",
          "submit_result",
          "list_assets",
          "get_asset",
          "attach",
          "detach",
          "set_primary",
          "delete_asset",
          "delete_pack",
          "create_download",
          "health",
        ]),
        campaign_id: z.string().min(1).max(128).optional(),
        pack_id: z.string().min(1).max(128).optional(),
        job_id: z.string().min(1).max(128).optional(),
        asset_id: z.string().min(1).max(128).optional(),
        upload_id: z.string().min(1).max(128).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        pack_type: z.string().trim().min(1).max(80).optional(),
        style: z.unknown().optional(),
        jobs: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
        metadata: z.unknown().optional(),
        status: z.union([jobStatus, packStatus]).optional(),
        kind: artKind.optional(),
        worker_id: z.string().trim().min(1).max(200).optional(),
        lease_seconds: z.number().int().min(30).max(86400).optional(),
        error: z.string().trim().min(1).max(4000).optional(),
        expected_mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
        expected_max_bytes: z.number().int().min(1).max(67108864).optional(),
        expires_in_seconds: z.number().int().min(60).max(3600).optional(),
        provider: z.string().trim().max(200).optional(),
        model: z.string().trim().max(300).optional(),
        prompt_used: z.string().max(16000).optional(),
        revised_prompt: z.string().max(16000).optional(),
        seed: z.union([z.string().max(200), z.number().finite()]).optional(),
        set_primary: z.boolean().optional(),
        variant_label: z.string().trim().max(100).optional(),
        entity_type: entityType.optional(),
        entity_id: z.string().min(1).max(128).optional(),
        role: z.string().trim().min(1).max(80).optional(),
        confirm: z.boolean().optional(),
        force: z.boolean().optional(),
        delete_assets: z.boolean().optional(),
      }),
    },
    async (args) => {
      switch (args.operation) {
        case "plan_campaign":
          return run("assets.plan_campaign", { campaignId: args.campaign_id });
        case "create_pack":
          return run("assets.create_pack", {
            campaignId: args.campaign_id,
            title: args.title,
            packType: args.pack_type,
            style: args.style,
            jobs: args.jobs,
            metadata: args.metadata,
          });
        case "get_pack":
          return run("assets.get_pack", { packId: args.pack_id });
        case "list_packs":
          return run("assets.list_packs", { campaignId: args.campaign_id, status: args.status });
        case "list_jobs":
          return run("assets.list_jobs", { campaignId: args.campaign_id, packId: args.pack_id, status: args.status, kind: args.kind });
        case "get_job":
          return run("assets.get_job", { jobId: args.job_id });
        case "claim_job":
          return run("assets.claim_job", { jobId: args.job_id, workerId: args.worker_id, leaseSeconds: args.lease_seconds });
        case "release_job":
          return run("assets.release_job", { jobId: args.job_id, workerId: args.worker_id });
        case "fail_job":
          return run("assets.fail_job", { jobId: args.job_id, workerId: args.worker_id, error: args.error });
        case "create_upload":
          return run("assets.create_upload", {
            jobId: args.job_id,
            workerId: args.worker_id,
            expectedMimeType: args.expected_mime_type,
            expectedMaxBytes: args.expected_max_bytes,
            expiresInSeconds: args.expires_in_seconds,
          });
        case "submit_result":
          return run("assets.submit_result", {
            jobId: args.job_id,
            uploadId: args.upload_id,
            workerId: args.worker_id,
            provider: args.provider,
            model: args.model,
            promptUsed: args.prompt_used,
            revisedPrompt: args.revised_prompt,
            seed: args.seed,
            metadata: args.metadata,
            setPrimary: args.set_primary,
            variantLabel: args.variant_label,
          });
        case "list_assets":
          return run("assets.list_assets", { campaignId: args.campaign_id, packId: args.pack_id, jobId: args.job_id, kind: args.kind });
        case "get_asset":
          return run("assets.get_asset", { assetId: args.asset_id });
        case "attach":
          return run("assets.attach", { assetId: args.asset_id, entityType: args.entity_type, entityId: args.entity_id, role: args.role, setPrimary: args.set_primary });
        case "detach":
          return run("assets.detach", { assetId: args.asset_id, entityType: args.entity_type, entityId: args.entity_id, role: args.role });
        case "set_primary":
          return run("assets.set_primary", { assetId: args.asset_id, entityType: args.entity_type, entityId: args.entity_id, role: args.role });
        case "delete_asset":
          return run("assets.delete_asset", { assetId: args.asset_id, confirm: args.confirm, force: args.force });
        case "delete_pack":
          return run("assets.delete_pack", { packId: args.pack_id, confirm: args.confirm, deleteAssets: args.delete_assets });
        case "create_download":
          return run("assets.create_download", { assetId: args.asset_id, expiresInSeconds: args.expires_in_seconds });
        case "health":
          return run("assets.health", { campaignId: args.campaign_id });
      }
    },
  );

  register(
    "odm_progress",
    {
      title: "ODM character progression",
      description:
        "Synchronize durable live-sheet progression back to the character library, synchronize a whole party, or finish a campaign only after the requested sync policy succeeds. Temporary combat state is intentionally not copied to the library.",
      inputSchema: z.object({
        operation: z.enum(["sync_character", "sync_party", "finish_and_sync_party", "status", "events"]),
        sheet_id: z.string().min(1).max(128).optional(),
        campaign_id: z.string().min(1).max(128).optional(),
        user_id: z.string().min(1).max(128).optional(),
        username: z.string().trim().min(1).max(80).optional(),
        expected_version: z.number().int().min(0).optional(),
        include_companions: z.boolean().optional(),
        skip_unlinked: z.boolean().optional(),
        require_all_synced: z.boolean().optional(),
        confirm: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (args) => {
      const lookup = {
        sheetId: args.sheet_id,
        campaignId: args.campaign_id,
        userId: args.user_id,
        username: args.username,
      };
      switch (args.operation) {
        case "sync_character":
          return run("characters.sync_progress", { ...lookup, expectedVersion: args.expected_version });
        case "sync_party":
          return run("campaigns.sync_party_progress", {
            campaignId: args.campaign_id,
            includeCompanions: args.include_companions,
            skipUnlinked: args.skip_unlinked,
          });
        case "finish_and_sync_party":
          return run("campaigns.finish_and_sync_party", {
            campaignId: args.campaign_id,
            includeCompanions: args.include_companions,
            skipUnlinked: args.skip_unlinked,
            requireAllSynced: args.require_all_synced,
            confirm: args.confirm,
          });
        case "status":
          return run("progress.status", lookup);
        case "events":
          return run("progress.events", { ...lookup, limit: args.limit || 50 });
      }
    },
  );
}

export const PRELOAD_TOOLS = Object.freeze(["odm_assets", "odm_progress"]);

export function verifyPreloadInstalled(server) {
  const registered = Object.keys(server._registeredTools || {});
  const missing = PRELOAD_TOOLS.filter((name) => !registered.includes(name));
  if (missing.length > 0) {
    throw new Error(`Preload verification failed: missing [${missing.join(", ")}]. Registered: [${registered.join(", ")}]`);
  }
  return true;
}

if (!McpServer.prototype[PATCHED]) {
  const originalRegisterTool = McpServer.prototype.registerTool;
  Object.defineProperty(McpServer.prototype, PATCHED, { value: true });
  McpServer.prototype.registerTool = function patchedRegisterTool(...args) {
    if (!this[REGISTERED]) {
      Object.defineProperty(this, REGISTERED, { value: true });
      if (NARRATOR_ONLY) registerDmPolicy(this, withMcpCancellation);
      else registerExternalTools(this, originalRegisterTool);
    }
    // Extend the existing public schema at its mandatory registration boundary.
    // The callback in server.mjs forwards these fields unchanged to the scoped
    // app handler; no second narrator tool or private SDK registry is created.
    if (args[0] === "odm_narrator") {
      args[1] = {
        ...args[1],
        description: "Campaign-scoped external DM. Drain read before each story write. Persist a unique commandId and the complete request; an identical retry only recovers its receipt. Never retry with changed arguments or a new expectedSeq. end_turn commits initiative once; narration does not advance it. send_whisper replies must name args.replyToWhisperIds. See narrator.connect for the current contract.",
        inputSchema: args[1].inputSchema.extend({
          commandId: z.string().uuid().optional(),
          turnId: z.string().uuid().optional(),
          expectedVersion: z.number().int().min(0).optional(),
          timelineEpoch: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          afterAskSeq: z.number().int().min(0).optional(),
          askLimit: z.number().int().min(1).max(50).optional(),
          paged: z.boolean().optional(), pageCursor: z.string().max(500).optional(),
          maxBytes: z.number().int().min(4096).max(131072).optional(),
          projection: z.enum(["full", "live"]).optional(),
        }),
      };
    }
    return originalRegisterTool.apply(this, args);
  };
}
