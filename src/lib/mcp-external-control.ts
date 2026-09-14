import { z } from "zod";
import { getCampaignById } from "@/lib/db/campaigns";
import {
  acceptAsset,
  addAssetRef,
  deleteAsset,
  healthAssetStore,
  listAssetRefs,
  listAssets,
  pinAsset,
  planAsset,
  rejectAsset,
  removeAssetRef,
  type AssetRefType,
  type AssetState,
} from "@/lib/db/odm-assets";
import {
  bulkSyncCampaignProgress,
  getProgressState,
  listProgressEvents,
  ProgressConflictError,
  syncCharacterProgress,
} from "@/lib/db/progress-sync";
import { getSheetById } from "@/lib/db/sheets";
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
  "assets.plan",
  "assets.accept",
  "assets.reject",
  "assets.status",
  "assets.pin",
  "assets.unpin",
  "assets.delete",
  "assets.list_refs",
  "assets.add_ref",
  "assets.remove_ref",
  "assets.health",
  "progress.sync",
  "progress.bulk_sync",
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

const id = z.string().trim().min(1).max(128);
const assetState = z.enum(["planned", "running", "ready", "failed", "rejected", "deleted"]);
const refType = z.enum([
  "campaign",
  "session",
  "character",
  "location",
  "item",
  "encounter",
  "quest",
  "journal_entry",
]);

function wrapDomainError(error: unknown): never {
  if (error instanceof McpExtendedControlError) throw error;
  if (error instanceof ProgressConflictError) throw new McpExtendedControlError(error.message, 409);
  const message = error instanceof Error ? error.message : "MCP extended control action failed.";
  if (/not found/i.test(message)) throw new McpExtendedControlError(message, 404);
  if (/conflict|cannot|refusing|outside|invalid|unsupported|required|provide exactly/i.test(message)) {
    throw new McpExtendedControlError(message, 409);
  }
  throw new McpExtendedControlError(message, 400);
}

export async function executeMcpExtendedControl(
  action: string,
  rawParams: unknown,
): Promise<{ handled: false } | { handled: true; result: unknown }> {
  try {
    switch (action) {
      case "assets.plan": {
        const p = parse(
          z
            .object({
              campaignId: id,
              kind: z.string().trim().min(1).max(64),
              query: z.string().trim().min(1).max(12_000),
              entityId: id.nullish(),
              reason: z.string().trim().max(4_000).nullish(),
              constraints: z.unknown().optional(),
              seed: z.union([z.string().max(200), z.number().finite()]).nullish(),
              sourceHint: z.string().trim().max(500).nullish(),
              providerHint: z.string().trim().max(200).nullish(),
              pendingTtlMs: z.number().int().min(60_000).max(86_400_000).optional(),
            })
            .strict(),
          rawParams,
        );
        campaignOr404(p.campaignId);
        const result = planAsset(p);
        publishPersisted(p.campaignId, "asset.planned", {
          assetId: result.asset.id,
          kind: result.asset.kind,
          entityId: result.asset.entityId,
          requestKey: result.asset.requestKey,
          reused: result.reused,
        });
        return { handled: true, result };
      }

      case "assets.accept": {
        const p = parse(
          z
            .object({
              assetId: id,
              tempPath: z.string().trim().min(1).max(4_096).nullish(),
              uploadedFileId: z.string().trim().min(1).max(128).nullish(),
              metadata: z.unknown().optional(),
            })
            .strict(),
          rawParams,
        );
        const asset = acceptAsset(p);
        publishPersisted(asset.campaignId, "asset.ready", {
          assetId: asset.id,
          kind: asset.kind,
          sha256: asset.sha256,
          relativePath: asset.relativePath,
        });
        return { handled: true, result: { asset } };
      }

      case "assets.reject": {
        const p = parse(z.object({ assetId: id, reason: z.string().trim().max(4_000).nullish() }).strict(), rawParams);
        const asset = rejectAsset(p.assetId, p.reason);
        publishPersisted(asset.campaignId, "asset.rejected", { assetId: asset.id, reason: asset.error });
        return { handled: true, result: { asset } };
      }

      case "assets.status": {
        const p = parse(
          z
            .object({
              assetId: id.optional(),
              campaignId: id.optional(),
              state: assetState.optional(),
            })
            .strict()
            .refine((value) => Boolean(value.assetId) !== Boolean(value.campaignId), {
              message: "Provide exactly one of assetId or campaignId.",
            }),
          rawParams,
        );
        if (p.campaignId) campaignOr404(p.campaignId);
        return {
          handled: true,
          result: { assets: listAssets({ assetId: p.assetId, campaignId: p.campaignId, state: p.state as AssetState | undefined }) },
        };
      }

      case "assets.pin":
      case "assets.unpin": {
        const p = parse(z.object({ assetId: id }).strict(), rawParams);
        const asset = pinAsset(p.assetId, action === "assets.pin");
        return { handled: true, result: { asset } };
      }

      case "assets.delete": {
        const p = parse(z.object({ assetId: id, force: z.boolean().default(false) }).strict(), rawParams);
        const asset = deleteAsset(p.assetId, p.force);
        publishPersisted(asset.campaignId, "asset.deleted", { assetId: asset.id, force: p.force });
        return { handled: true, result: { asset } };
      }

      case "assets.list_refs": {
        const p = parse(z.object({ assetId: id }).strict(), rawParams);
        return { handled: true, result: { refs: listAssetRefs(p.assetId) } };
      }

      case "assets.add_ref":
      case "assets.remove_ref": {
        const p = parse(
          z
            .object({
              assetId: id,
              refType,
              refId: id,
              role: z.string().trim().min(1).max(80).optional(),
            })
            .strict(),
          rawParams,
        );
        const refs = action === "assets.add_ref"
          ? addAssetRef({ ...p, refType: p.refType as AssetRefType })
          : removeAssetRef({ ...p, refType: p.refType as AssetRefType });
        return { handled: true, result: { refs } };
      }

      case "assets.health": {
        const p = parse(z.object({ campaignId: id.optional() }).strict(), rawParams);
        if (p.campaignId) campaignOr404(p.campaignId);
        return { handled: true, result: healthAssetStore(p.campaignId) };
      }

      case "progress.sync": {
        const p = parse(
          z.object({ characterId: id, expectedVersion: z.number().int().min(0).optional() }).strict(),
          rawParams,
        );
        const sheet = getSheetById(p.characterId);
        if (!sheet) throw new McpExtendedControlError("Campaign character sheet not found.", 404);
        const result = syncCharacterProgress(p.characterId, p.expectedVersion);
        publishPersisted(result.campaignId, "progress.changed", {
          characterId: result.sheetId,
          libraryCharacterId: result.libraryCharacterId,
          revision: result.revision,
          delta: result.delta,
        });
        return { handled: true, result };
      }

      case "progress.bulk_sync": {
        const p = parse(z.object({ campaignId: id }).strict(), rawParams);
        campaignOr404(p.campaignId);
        const result = bulkSyncCampaignProgress(p.campaignId);
        publishPersisted(p.campaignId, "progress.bulk_synced", {
          campaignId: p.campaignId,
          synced: result.synced.length,
          errors: result.errors,
        });
        return { handled: true, result };
      }

      case "progress.status": {
        const p = parse(z.object({ characterId: id }).strict(), rawParams);
        const sheet = getSheetById(p.characterId);
        if (!sheet) throw new McpExtendedControlError("Campaign character sheet not found.", 404);
        if (!sheet.libraryCharacterId) throw new McpExtendedControlError("Campaign character is not linked to a library character.", 409);
        return { handled: true, result: getProgressState(sheet.libraryCharacterId) };
      }

      case "progress.events": {
        const p = parse(z.object({ characterId: id, limit: z.number().int().min(1).max(200).default(50) }).strict(), rawParams);
        const sheet = getSheetById(p.characterId);
        if (!sheet) throw new McpExtendedControlError("Campaign character sheet not found.", 404);
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
    };
  }
  if (action === "server.status" && "mcpControlActions" in result) {
    const current = Number((result as { mcpControlActions: unknown }).mcpControlActions) || 0;
    return { ...result, mcpControlActions: current + MCP_EXTENDED_ACTIONS.length };
  }
  return result;
}
