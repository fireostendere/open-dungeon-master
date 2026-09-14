import { z } from "zod";
import { ASSET_MIME_TYPES } from "@/lib/assets/image";
import { planCampaignAssets } from "@/lib/assets/planner";
import { getCampaignById } from "@/lib/db/campaigns";
import {
  ART_KINDS,
  ASSET_PROTOCOL_VERSION,
  HARD_ASSET_MAX_BYTES,
  assetHealth,
  attachAsset,
  claimJob,
  configuredAssetMaxBytes,
  createDownloadGrant,
  createPack,
  createUploadGrant,
  deleteAsset,
  deletePack,
  detachAsset,
  failJob,
  getAsset,
  getJob,
  getPack,
  listAssets,
  listJobs,
  listPacks,
  releaseJob,
  setPrimaryAsset,
  submitResult,
  type ArtKind,
  type AssetEntityType,
  type JobStatus,
  type PackStatus,
} from "@/lib/db/asset-pipeline";
import {
  getProgressState,
  listProgressEvents,
  ProgressConflictError,
  syncPartyProgress,
} from "@/lib/db/progress-sync";
import { finishAndSyncParty, resolveProgressSheet, syncProgressLookup } from "@/lib/progress/service";
import { publishPersisted } from "@/lib/events";

export class McpExtendedControlError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export const MCP_EXTENDED_ACTIONS = [
  "assets.plan_campaign",
  "assets.create_pack",
  "assets.get_pack",
  "assets.list_packs",
  "assets.list_jobs",
  "assets.get_job",
  "assets.claim_job",
  "assets.release_job",
  "assets.fail_job",
  "assets.create_upload",
  "assets.submit_result",
  "assets.list_assets",
  "assets.get_asset",
  "assets.attach",
  "assets.detach",
  "assets.set_primary",
  "assets.delete_asset",
  "assets.delete_pack",
  "assets.create_download",
  "assets.health",
  "characters.sync_progress",
  "campaigns.sync_party_progress",
  "campaigns.finish_and_sync_party",
  "progress.status",
  "progress.events",
] as const;

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new McpExtendedControlError(z.prettifyError(parsed.error));
  return parsed.data;
}

function campaignOr404(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) throw new McpExtendedControlError("Campaign not found.", 404);
  return campaign;
}

function publicBaseUrl() {
  const configured = process.env.APP_PUBLIC_URL?.trim() || process.env.ODM_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.ODM_PORT?.trim() || "3005"}`;
}

const id = z.string().trim().min(1).max(128);
const artKind = z.enum(ART_KINDS);
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
const packStatus = z.enum(["planned", "active", "ready", "failed", "cancelled"]);
const jobStatus = z.enum(["planned", "available", "claimed", "uploading", "ready", "failed", "cancelled"]);
const assetMime = z.enum(ASSET_MIME_TYPES);

const jobDraftSchema = z
  .object({
    kind: artKind,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(8_000).optional(),
    suggestedPrompt: z.string().trim().max(16_000).optional(),
    negativePrompt: z.string().trim().max(8_000).optional(),
    aspect: z.string().trim().min(1).max(40).optional(),
    requestedWidth: z.number().int().min(1).max(32_768).nullable().optional(),
    requestedHeight: z.number().int().min(1).max(32_768).nullable().optional(),
    target: z.object({ type: entityType, id }).optional(),
    referenceAssetIds: z.array(id).max(32).optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    metadata: z.unknown().optional(),
    dedupeKey: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

function wrapDomainError(error: unknown): never {
  if (error instanceof McpExtendedControlError) throw error;
  if (error instanceof ProgressConflictError) throw new McpExtendedControlError(error.message, 409);
  const message = error instanceof Error ? error.message : "MCP extended control action failed.";
  if (/not found|unavailable/i.test(message)) throw new McpExtendedControlError(message, 404);
  if (/too large|size limit/i.test(message)) throw new McpExtendedControlError(message, 413);
  if (/claimed|claimable|expired|already|conflict|cannot|refusing|linked|requires confirm|must be|does not belong/i.test(message)) {
    throw new McpExtendedControlError(message, 409);
  }
  if (/invalid|unsupported|required|provide|missing/i.test(message)) throw new McpExtendedControlError(message, 400);
  throw new McpExtendedControlError(message, 400);
}

export async function executeMcpExtendedControl(
  action: string,
  rawParams: unknown,
): Promise<{ handled: false } | { handled: true; result: unknown }> {
  try {
    switch (action) {
      case "assets.plan_campaign": {
        const p = parse(z.object({ campaignId: id }).strict(), rawParams);
        campaignOr404(p.campaignId);
        const result = planCampaignAssets(p.campaignId);
        publishPersisted(p.campaignId, "asset.backlog_planned", {
          packId: result.pack.id,
          planned: result.changes.planned.length,
          reused: result.changes.reused.length,
          totals: result.totals,
        });
        return { handled: true, result };
      }

      case "assets.create_pack": {
        const p = parse(
          z.object({
            campaignId: id,
            title: z.string().trim().min(1).max(200),
            packType: z.string().trim().min(1).max(80),
            style: z.unknown().optional(),
            metadata: z.unknown().optional(),
            jobs: z.array(jobDraftSchema).max(500).optional(),
          }).strict(),
          rawParams,
        );
        campaignOr404(p.campaignId);
        const pack = createPack(p);
        publishPersisted(p.campaignId, "asset.pack_created", { packId: pack.id, packType: pack.packType, jobs: pack.jobs.length });
        return { handled: true, result: { pack } };
      }

      case "assets.get_pack": {
        const p = parse(z.object({ packId: id }).strict(), rawParams);
        const pack = getPack(p.packId);
        if (!pack) throw new McpExtendedControlError("Asset pack not found.", 404);
        return { handled: true, result: { pack } };
      }

      case "assets.list_packs": {
        const p = parse(z.object({ campaignId: id.optional(), status: packStatus.optional() }).strict(), rawParams);
        if (p.campaignId) campaignOr404(p.campaignId);
        return { handled: true, result: { packs: listPacks({ campaignId: p.campaignId, status: p.status as PackStatus | undefined }) } };
      }

      case "assets.list_jobs": {
        const p = parse(z.object({
          campaignId: id.optional(),
          packId: id.optional(),
          status: jobStatus.optional(),
          kind: artKind.optional(),
        }).strict(), rawParams);
        if (p.campaignId) campaignOr404(p.campaignId);
        return {
          handled: true,
          result: { jobs: listJobs({ campaignId: p.campaignId, packId: p.packId, status: p.status as JobStatus | undefined, kind: p.kind as ArtKind | undefined }) },
        };
      }

      case "assets.get_job": {
        const p = parse(z.object({ jobId: id }).strict(), rawParams);
        const job = getJob(p.jobId);
        if (!job) throw new McpExtendedControlError("Asset job not found.", 404);
        return { handled: true, result: { job } };
      }

      case "assets.claim_job": {
        const p = parse(z.object({
          jobId: id,
          workerId: z.string().trim().min(1).max(200),
          leaseSeconds: z.number().int().min(30).max(86_400).optional(),
        }).strict(), rawParams);
        const job = claimJob(p.jobId, p.workerId, p.leaseSeconds);
        publishPersisted(job.campaignId, "asset.job_claimed", { jobId: job.id, packId: job.packId, workerId: p.workerId, claimExpiresAt: job.claimExpiresAt });
        return { handled: true, result: { job } };
      }

      case "assets.release_job": {
        const p = parse(z.object({ jobId: id, workerId: z.string().trim().min(1).max(200) }).strict(), rawParams);
        const job = releaseJob(p.jobId, p.workerId);
        return { handled: true, result: { job } };
      }

      case "assets.fail_job": {
        const p = parse(z.object({
          jobId: id,
          workerId: z.string().trim().min(1).max(200),
          error: z.string().trim().min(1).max(4_000),
        }).strict(), rawParams);
        const job = failJob(p.jobId, p.workerId, p.error);
        publishPersisted(job.campaignId, "asset.job_failed", { jobId: job.id, packId: job.packId, error: p.error });
        return { handled: true, result: { job } };
      }

      case "assets.create_upload": {
        const p = parse(z.object({
          jobId: id,
          workerId: z.string().trim().min(1).max(200),
          expectedMimeType: assetMime.nullable().optional(),
          expectedMaxBytes: z.number().int().min(1).max(HARD_ASSET_MAX_BYTES).nullable().optional(),
          expiresInSeconds: z.number().int().min(60).max(3600).optional(),
        }).strict(), rawParams);
        const grant = createUploadGrant(p);
        return {
          handled: true,
          result: {
            uploadId: grant.uploadId,
            uploadUrl: `${publicBaseUrl()}/api/assets/ingest/${grant.uploadId}`,
            expiresAt: grant.expiresAt,
            maxBytes: grant.maxBytes,
            acceptedMimeTypes: grant.acceptedMimeTypes,
            authorization: { scheme: "Bearer", token: grant.token },
            method: "PUT",
          },
        };
      }

      case "assets.submit_result": {
        const p = parse(z.object({
          jobId: id,
          uploadId: id,
          workerId: z.string().trim().min(1).max(200),
          provider: z.string().trim().max(200).optional(),
          model: z.string().trim().max(300).optional(),
          promptUsed: z.string().max(16_000).optional(),
          revisedPrompt: z.string().max(16_000).optional(),
          seed: z.union([z.string().max(200), z.number().finite()]).nullable().optional(),
          metadata: z.unknown().optional(),
          setPrimary: z.boolean().optional(),
          variantLabel: z.string().trim().max(100).optional(),
        }).strict(), rawParams);
        const result = submitResult(p);
        publishPersisted(result.asset.campaignId, "asset.ready", {
          packId: result.asset.packId,
          jobId: result.asset.jobId,
          assetId: result.asset.id,
          kind: result.asset.kind,
          variantLabel: result.asset.variantLabel,
          primary: result.asset.isPrimary,
          sha256: result.asset.sha256,
          duplicate: result.duplicate,
        });
        return { handled: true, result };
      }

      case "assets.list_assets": {
        const p = parse(z.object({
          campaignId: id.optional(),
          packId: id.optional(),
          jobId: id.optional(),
          kind: artKind.optional(),
        }).strict(), rawParams);
        if (p.campaignId) campaignOr404(p.campaignId);
        return { handled: true, result: { assets: listAssets({ campaignId: p.campaignId, packId: p.packId, jobId: p.jobId, kind: p.kind as ArtKind | undefined }) } };
      }

      case "assets.get_asset": {
        const p = parse(z.object({ assetId: id }).strict(), rawParams);
        const asset = getAsset(p.assetId);
        if (!asset) throw new McpExtendedControlError("Asset not found.", 404);
        return { handled: true, result: { asset } };
      }

      case "assets.attach":
      case "assets.detach": {
        const p = parse(z.object({
          assetId: id,
          entityType,
          entityId: id,
          role: z.string().trim().min(1).max(80).optional(),
          setPrimary: z.boolean().optional(),
        }).strict(), rawParams);
        const links = action === "assets.attach"
          ? attachAsset({ assetId: p.assetId, entityType: p.entityType as AssetEntityType, entityId: p.entityId, role: p.role, setPrimary: p.setPrimary })
          : detachAsset({ assetId: p.assetId, entityType: p.entityType as AssetEntityType, entityId: p.entityId, role: p.role });
        return { handled: true, result: { links } };
      }

      case "assets.set_primary": {
        const p = parse(z.object({
          assetId: id,
          entityType: entityType.optional(),
          entityId: id.optional(),
          role: z.string().trim().min(1).max(80).optional(),
        }).strict().refine((value) => Boolean(value.entityType) === Boolean(value.entityId), {
          message: "entityType and entityId must be supplied together.",
        }), rawParams);
        return { handled: true, result: { asset: setPrimaryAsset({ assetId: p.assetId, entityType: p.entityType as AssetEntityType | undefined, entityId: p.entityId, role: p.role }) } };
      }

      case "assets.delete_asset": {
        const p = parse(z.object({ assetId: id, confirm: z.boolean(), force: z.boolean().optional() }).strict(), rawParams);
        return { handled: true, result: deleteAsset(p.assetId, p.confirm, p.force ?? false) };
      }

      case "assets.delete_pack": {
        const p = parse(z.object({ packId: id, confirm: z.boolean(), deleteAssets: z.boolean().optional() }).strict(), rawParams);
        return { handled: true, result: deletePack(p.packId, p.confirm, p.deleteAssets ?? false) };
      }

      case "assets.create_download": {
        const p = parse(z.object({ assetId: id, expiresInSeconds: z.number().int().min(60).max(3600).optional() }).strict(), rawParams);
        const grant = createDownloadGrant(p.assetId, p.expiresInSeconds);
        return {
          handled: true,
          result: {
            downloadId: grant.downloadId,
            downloadUrl: `${publicBaseUrl()}/api/assets/download/${grant.downloadId}`,
            expiresAt: grant.expiresAt,
            mimeType: grant.mimeType,
            byteSize: grant.byteSize,
            filename: grant.filename,
            authorization: { scheme: "Bearer", token: grant.token },
            method: "GET",
          },
        };
      }

      case "assets.health": {
        const p = parse(z.object({ campaignId: id.optional() }).strict(), rawParams);
        if (p.campaignId) campaignOr404(p.campaignId);
        return { handled: true, result: assetHealth(p.campaignId) };
      }

      case "characters.sync_progress": {
        const p = parse(z.object({
          sheetId: id.optional(),
          campaignId: id.optional(),
          userId: id.optional(),
          username: z.string().trim().min(1).max(80).optional(),
          expectedVersion: z.number().int().min(0).optional(),
        }).strict(), rawParams);
        const result = syncProgressLookup(p);
        publishPersisted(result.campaignId, "progress.changed", {
          sheetId: result.sheetId,
          libraryCharacterId: result.libraryCharacterId,
          revision: result.revision,
          before: result.before,
          after: result.after,
        });
        return { handled: true, result };
      }

      case "campaigns.sync_party_progress": {
        const p = parse(z.object({
          campaignId: id,
          includeCompanions: z.boolean().optional(),
          skipUnlinked: z.boolean().optional(),
        }).strict(), rawParams);
        campaignOr404(p.campaignId);
        const result = syncPartyProgress(p.campaignId, p);
        publishPersisted(p.campaignId, "progress.party_synced", { totals: result.totals, failed: result.failed, skipped: result.skipped });
        return { handled: true, result };
      }

      case "campaigns.finish_and_sync_party": {
        const p = parse(z.object({
          campaignId: id,
          includeCompanions: z.boolean().optional(),
          skipUnlinked: z.boolean().optional(),
          requireAllSynced: z.boolean().optional(),
          confirm: z.boolean(),
        }).strict(), rawParams);
        return { handled: true, result: finishAndSyncParty(p) };
      }

      case "progress.status": {
        const p = parse(z.object({
          sheetId: id.optional(),
          campaignId: id.optional(),
          userId: id.optional(),
          username: z.string().trim().min(1).max(80).optional(),
        }).strict(), rawParams);
        const sheet = resolveProgressSheet(p);
        if (!sheet.libraryCharacterId) throw new McpExtendedControlError("Campaign character is not linked to a library character.", 409);
        return { handled: true, result: getProgressState(sheet.libraryCharacterId) };
      }

      case "progress.events": {
        const p = parse(z.object({
          sheetId: id.optional(),
          campaignId: id.optional(),
          userId: id.optional(),
          username: z.string().trim().min(1).max(80).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }).strict(), rawParams);
        const sheet = resolveProgressSheet(p);
        if (!sheet.libraryCharacterId) throw new McpExtendedControlError("Campaign character is not linked to a library character.", 409);
        return { handled: true, result: { events: listProgressEvents(sheet.libraryCharacterId, p.limit) } };
      }

      default:
        return { handled: false };
    }
  } catch (error) {
    wrapDomainError(error);
  }
}

export function extendControlResult(action: string, result: unknown) {
  if (!result || typeof result !== "object") return result;
  if (action === "server.capabilities" && "actions" in result && Array.isArray((result as { actions: unknown }).actions)) {
    return {
      ...result,
      actions: [...(result as { actions: unknown[] }).actions, ...MCP_EXTENDED_ACTIONS],
      externalAssets: {
        protocolVersion: ASSET_PROTOCOL_VERSION,
        externalAssetPipeline: true,
        binaryUpload: true,
        packs: true,
        jobs: true,
        claims: true,
        claimLeases: true,
        variants: true,
        references: true,
        scopedDownloads: true,
        providerAgnostic: true,
        supportedMimeTypes: [...ASSET_MIME_TYPES],
        maxFileBytes: configuredAssetMaxBytes(),
        artKinds: [...ART_KINDS],
      },
      characterProgressSync: {
        supported: true,
        single: "characters.sync_progress",
        party: "campaigns.sync_party_progress",
        finishCampaign: "campaigns.finish_and_sync_party",
        durableOnly: true,
        optimisticRevision: true,
      },
    };
  }
  if (action === "server.status" && "mcpControlActions" in result) {
    const current = Number((result as { mcpControlActions: unknown }).mcpControlActions) || 0;
    return { ...result, mcpControlActions: current + MCP_EXTENDED_ACTIONS.length, assetProtocolVersion: ASSET_PROTOCOL_VERSION };
  }
  return result;
}
