import { z } from "zod";
import { CAMPAIGN_DIFFICULTIES, isOocMessage } from "@/lib/campaign-types";
import {
  createCampaign,
  deleteCampaign,
  getCampaignById,
  joinByInviteCode,
  listMembers,
  publicCampaign,
  regenerateInviteCode,
  setCampaignScene,
  setCampaignStatus,
  setDmMode,
  setDmOutline,
  setPartyLead,
  setQuestLog,
  setStoryArc,
  updateCampaignInfo,
  updateGameSettings,
  updateStorySettings,
} from "@/lib/db/campaigns";
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  instantiateIntoCampaign,
  listCharactersForUser,
  updateCharacter,
} from "@/lib/db/characters";
import { getDatabase } from "@/lib/db/core";
import { maskStorySettings } from "@/lib/db/settings";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getUserById, getUserByUsername, listUsers, type User } from "@/lib/db/users";
import { normalizeStoryArc } from "@/lib/dm/arc-logic";
import { listEventsSince, publishPersisted } from "@/lib/events";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { createSheetSchema, fullPatchSheetSchema } from "@/lib/schemas/sheet";
import type { StorySettings } from "@/lib/types";
import { getGlobalConfig } from "@/lib/db/app-settings";
import {
  listLlmProfiles,
  getLlmProfile,
  applyLlmProfileToGlobal,
  applyLlmProfileToCampaign,
} from "@/lib/db/llm-profiles";
import { maskLlmProfile } from "@/lib/schemas/llm-profile";
import { performProviderAction } from "@/lib/provider-auth/actions";
import { ProviderError, requireVerifiedProfile } from "@/lib/provider-auth/core.mjs";

function maskEndpointUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "******";
    return u.toString();
  } catch {
    return raw;
  }
}

export class McpControlError extends Error {
  readonly status: number;
  constructor(
    message: string,
    status = 400,
  ) {
    super(message);
    this.status = status;
  }
}

const userRefSchema = z
  .object({
    userId: z.string().uuid().optional(),
    username: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const storySettingsPatchSchema = z
  .object({
    world: z.string().max(12_000).optional(),
    style: z.string().max(8_000).optional(),
    textProvider: z.string().max(40).optional(),
    localTextModel: z.string().max(120).optional(),
    customBaseUrl: z.string().max(500).optional(),
    customModel: z.string().max(200).optional(),
    customApiKey: z.string().max(400).optional(),
    utilityProvider: z.string().max(40).optional(),
    utilityModel: z.string().max(200).optional(),
    utilityBaseUrl: z.string().max(500).optional(),
    utilityApiKey: z.string().max(400).optional(),
    imageMode: z.enum(["fast", "slow"]).optional(),
    imageBackend: z.enum(["mflux-hs", "sdnq-hs", "comfyui", "openai", "dashscope"]).optional(),
    comfyUrl: z.string().max(500).optional(),
    comfyCheckpoint: z.string().max(300).optional(),
    imageModel: z.string().max(200).optional(),
    imageBaseUrl: z.string().max(500).optional(),
    imageApiKey: z.string().max(400).optional(),
    aspect: z.enum(["square", "portrait", "landscape"]).optional(),
    imageGenerationEnabled: z.boolean().optional(),
    autoImages: z.boolean().optional(),
    proseSize: z
      .enum(["tiny", "xsmall", "small", "medium", "large", "xlarge", "xxlarge", "huge", "giant"])
      .optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new McpControlError(z.prettifyError(parsed.error));
  }
  return parsed.data;
}

function campaignOr404(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    throw new McpControlError("Campaign not found.", 404);
  }
  return campaign;
}

function userOr404(ref: { userId?: string; username?: string }, allowDefault = false): User {
  let user: User | null = null;
  if (ref.userId) {
    user = getUserById(ref.userId);
  } else if (ref.username) {
    user = getUserByUsername(ref.username);
  } else if (allowDefault) {
    const configuredId = process.env.ODM_MCP_OWNER_USER_ID?.trim();
    const configuredName = process.env.ODM_MCP_OWNER_USERNAME?.trim();
    if (configuredId) user = getUserById(configuredId);
    if (!user && configuredName) user = getUserByUsername(configuredName);
    if (!user) {
      const admins = listUsers().filter((candidate) => candidate.isAdmin);
      if (admins.length === 1) user = admins[0];
    }
  }
  if (!user) {
    throw new McpControlError(
      allowDefault
        ? "User could not be resolved. Pass userId/username, or configure ODM_MCP_OWNER_USER_ID / ODM_MCP_OWNER_USERNAME."
        : "User not found.",
      404,
    );
  }
  return user;
}

function mcpCampaign(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
  return {
    ...publicCampaign(campaign),
    settings: maskStorySettings(campaign.settings),
    dmOutline: campaign.dmOutline,
    storyArc: campaign.storyArc,
  };
}

function listAllCampaigns(kind: "campaign" | "workshop" | "all") {
  const rows = getDatabase()
    .prepare(
      `SELECT id FROM campaigns ${kind === "all" ? "" : "WHERE kind = ?"} ORDER BY updated_at DESC`,
    )
    .all(...(kind === "all" ? [] : [kind])) as Array<{ id: string }>;
  return rows
    .map((row) => getCampaignById(row.id))
    .filter((campaign): campaign is NonNullable<typeof campaign> => campaign !== null)
    .map((campaign) => mcpCampaign(campaign));
}

export const MCP_CONTROL_ACTIONS = [
  "server.status",
  "server.capabilities",
  "users.list",
  "campaigns.list",
  "campaigns.get",
  "campaigns.create",
  "campaigns.update",
  "campaigns.delete",
  "campaigns.set_status",
  "campaigns.regenerate_invite",
  "campaigns.members",
  "campaigns.join_user",
  "campaigns.set_lead",
  "campaigns.update_game_settings",
  "campaigns.update_story_settings",
  "campaigns.set_dm_mode",
  "campaigns.set_scene",
  "campaigns.set_quest_log",
  "campaigns.set_outline",
  "campaigns.set_story_arc",
  "campaigns.events",
  "campaigns.announce",
  "characters.list",
  "characters.get",
  "characters.create",
  "characters.update",
  "characters.delete",
  "characters.instantiate",
  "sheets.list",
  "sheets.get",
  "sheets.patch",
  "models.status",
  "models.list",
  "models.test_and_connect",
  "models.apply",
  "models.switch_remote",
] as const;

export type McpControlAction = (typeof MCP_CONTROL_ACTIONS)[number];

export async function executeMcpControl(action: string, rawParams: unknown): Promise<unknown> {
  switch (action as McpControlAction) {
    case "server.status": {
      parse(z.object({}).strict(), rawParams);
      const db = getDatabase();
      db.prepare("SELECT 1").get();
      const users = db.prepare("SELECT COUNT(*) AS count FROM users WHERE id NOT LIKE 'comp\\_%' ESCAPE '\\'").get() as {
        count: number;
      };
      const campaigns = db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE kind = 'campaign'").get() as {
        count: number;
      };
      return {
        ok: true,
        service: "open-dungeon-master",
        uptimeSeconds: Math.floor(process.uptime()),
        database: "ok",
        users: users.count,
        campaigns: campaigns.count,
        mcpControlActions: MCP_CONTROL_ACTIONS.length,
      };
    }

    case "server.capabilities":
      parse(z.object({}).strict(), rawParams);
      return { actions: MCP_CONTROL_ACTIONS };

    case "users.list":
      parse(z.object({}).strict(), rawParams);
      return { users: listUsers() };

    case "campaigns.list": {
      const params = parse(
        z.object({ kind: z.enum(["campaign", "workshop", "all"]).default("campaign") }).strict(),
        rawParams,
      );
      return { campaigns: listAllCampaigns(params.kind) };
    }

    case "campaigns.get": {
      const params = parse(z.object({ campaignId: z.string().uuid() }).strict(), rawParams);
      return { campaign: mcpCampaign(campaignOr404(params.campaignId)) };
    }

    case "campaigns.create": {
      const params = parse(
        z
          .object({
            owner: userRefSchema.default({}),
            title: z.string().trim().min(1).max(80),
            description: z.string().trim().max(500).default(""),
            theme: z.string().trim().max(120).default(""),
            maxPlayers: z.number().int().min(1).max(8).default(5),
            startingLevel: z.number().int().min(1).max(20).default(1),
            difficulty: z.enum(CAMPAIGN_DIFFICULTIES).default("normal"),
            kind: z.enum(["campaign", "workshop"]).default("campaign"),
            gameSettings: gameSettingsSchema.partial().default({}),
          })
          .strict(),
        rawParams,
      );
      const owner = userOr404(params.owner, true);
      const campaign = createCampaign(owner.id, {
        title: params.title,
        description: params.description,
        theme: params.theme,
        maxPlayers: params.maxPlayers,
        startingLevel: params.startingLevel,
        difficulty: params.difficulty,
        kind: params.kind,
        gameSettings: params.gameSettings,
      });
      publishPersisted(campaign.id, "mcp_control", { action: "campaign_created" });
      return { campaign: mcpCampaign(campaign), owner: { id: owner.id, username: owner.username } };
    }

    case "campaigns.update": {
      const params = parse(
        z
          .object({
            campaignId: z.string().uuid(),
            patch: z
              .object({
                title: z.string().trim().min(1).max(80).optional(),
                description: z.string().trim().max(500).optional(),
                theme: z.string().trim().max(120).optional(),
                maxPlayers: z.number().int().min(1).max(8).optional(),
                startingLevel: z.number().int().min(1).max(20).optional(),
                difficulty: z.enum(CAMPAIGN_DIFFICULTIES).optional(),
              })
              .strict(),
          })
          .strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      updateCampaignInfo(params.campaignId, params.patch);
      publishPersisted(params.campaignId, "mcp_control", { action: "campaign_updated" });
      return { campaign: mcpCampaign(campaignOr404(params.campaignId)) };
    }

    case "campaigns.delete": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), confirm: z.literal(true) }).strict(),
        rawParams,
      );
      const campaign = campaignOr404(params.campaignId);
      const summary = { id: campaign.id, title: campaign.title };
      deleteCampaign(params.campaignId);
      return { deleted: summary };
    }

    case "campaigns.set_status": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), status: z.enum(["lobby", "active", "ended"]) }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      setCampaignStatus(params.campaignId, params.status);
      publishPersisted(params.campaignId, "mcp_control", { action: "status_changed", status: params.status });
      return { campaign: mcpCampaign(campaignOr404(params.campaignId)) };
    }

    case "campaigns.regenerate_invite": {
      const params = parse(z.object({ campaignId: z.string().uuid() }).strict(), rawParams);
      campaignOr404(params.campaignId);
      const inviteCode = regenerateInviteCode(params.campaignId);
      if (!inviteCode) throw new McpControlError("Could not regenerate invite code.", 500);
      return { campaignId: params.campaignId, inviteCode };
    }

    case "campaigns.members": {
      const params = parse(z.object({ campaignId: z.string().uuid() }).strict(), rawParams);
      campaignOr404(params.campaignId);
      return { members: listMembers(params.campaignId) };
    }

    case "campaigns.join_user": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), user: userRefSchema }).strict(),
        rawParams,
      );
      const campaign = campaignOr404(params.campaignId);
      const user = userOr404(params.user);
      const joined = joinByInviteCode(user.id, campaign.inviteCode);
      if ("error" in joined) throw new McpControlError(joined.error);
      publishPersisted(params.campaignId, "mcp_control", { action: "member_joined", userId: user.id });
      return { campaign: mcpCampaign(joined.campaign), user: { id: user.id, username: user.username } };
    }

    case "campaigns.set_lead": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), user: userRefSchema }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const user = userOr404(params.user);
      if (!setPartyLead(params.campaignId, user.id)) {
        throw new McpControlError("The selected user is not a member of this campaign.");
      }
      publishPersisted(params.campaignId, "mcp_control", { action: "lead_changed", userId: user.id });
      return { campaign: mcpCampaign(campaignOr404(params.campaignId)) };
    }

    case "campaigns.update_game_settings": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), patch: gameSettingsSchema.partial() }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const settings = updateGameSettings(params.campaignId, params.patch);
      if (!settings) throw new McpControlError("Campaign not found.", 404);
      publishPersisted(params.campaignId, "mcp_control", { action: "game_settings_changed" });
      return { gameSettings: settings };
    }

    case "campaigns.update_story_settings": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), patch: storySettingsPatchSchema }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const settings = updateStorySettings(params.campaignId, params.patch as Partial<StorySettings>);
      if (!settings) throw new McpControlError("Campaign not found.", 404);
      publishPersisted(params.campaignId, "mcp_control", { action: "story_settings_changed" });
      return { settings: maskStorySettings(settings) };
    }

    case "campaigns.set_dm_mode": {
      const params = parse(
        z
          .object({
            campaignId: z.string().uuid(),
            mode: z.enum(["ai", "human", "assisted"]),
            actor: userRefSchema.optional(),
          })
          .strict(),
        rawParams,
      );
      const campaign = campaignOr404(params.campaignId);
      const actor = params.actor ? userOr404(params.actor) : getUserById(campaign.leadUserId);
      if (!actor) throw new McpControlError("Campaign lead user not found.", 404);
      const result = setDmMode(params.campaignId, params.mode, actor.id);
      if (!result) throw new McpControlError("Could not update DM mode.", 500);
      publishPersisted(params.campaignId, "mcp_control", {
        action: "dm_mode_changed",
        mode: params.mode,
        dmUserId: result.dmUserId,
      });
      return result;
    }

    case "campaigns.set_scene": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), scene: z.string().max(2_000) }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      setCampaignScene(params.campaignId, params.scene);
      publishPersisted(params.campaignId, "mcp_control", { action: "scene_changed" });
      return { scene: params.scene };
    }

    case "campaigns.set_quest_log": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), quests: z.array(z.string().trim().min(1).max(500)).max(20) }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      setQuestLog(params.campaignId, params.quests);
      publishPersisted(params.campaignId, "mcp_control", { action: "quest_log_changed" });
      return { quests: campaignOr404(params.campaignId).questLog };
    }

    case "campaigns.set_outline": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), outline: z.string().max(8_000) }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      setDmOutline(params.campaignId, params.outline);
      publishPersisted(params.campaignId, "mcp_control", { action: "dm_outline_changed" });
      return { dmOutline: campaignOr404(params.campaignId).dmOutline };
    }

    case "campaigns.set_story_arc": {
      const params = parse(
        z.object({ campaignId: z.string().uuid(), arc: z.unknown() }).strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const arc = normalizeStoryArc(params.arc);
      if (!arc) throw new McpControlError("Invalid story arc.");
      setStoryArc(params.campaignId, arc);
      publishPersisted(params.campaignId, "mcp_control", { action: "story_arc_changed" });
      return { storyArc: campaignOr404(params.campaignId).storyArc };
    }

    case "campaigns.events": {
      const params = parse(
        z
          .object({
            campaignId: z.string().uuid(),
            afterSeq: z.number().int().min(0).default(0),
            limit: z.number().int().min(1).max(500).default(100),
          })
          .strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const events = listEventsSince(params.campaignId, params.afterSeq, params.limit);
      return {
        events: events.filter(
          (event) =>
            !(
              event.type === "message_added" &&
              isOocMessage((event.payload as { message?: { content?: string } })?.message)
            ),
        ),
      };
    }

    case "campaigns.announce": {
      const params = parse(
        z
          .object({
            campaignId: z.string().uuid(),
            message: z.string().trim().min(1).max(1_000),
            level: z.enum(["info", "warning"]).default("info"),
          })
          .strict(),
        rawParams,
      );
      campaignOr404(params.campaignId);
      const seq = publishPersisted(params.campaignId, "mcp_notice", {
        message: params.message,
        level: params.level,
      });
      return { seq };
    }

    case "characters.list": {
      const params = parse(
        z.object({ owner: userRefSchema.default({}), role: z.enum(["pc", "companion"]).optional() }).strict(),
        rawParams,
      );
      const user = userOr404(params.owner, true);
      return { owner: { id: user.id, username: user.username }, characters: listCharactersForUser(user.id, params.role) };
    }

    case "characters.get": {
      const params = parse(z.object({ characterId: z.string().uuid() }).strict(), rawParams);
      const character = getCharacter(params.characterId);
      if (!character) throw new McpControlError("Character not found.", 404);
      return { character };
    }

    case "characters.create": {
      const params = parse(
        z
          .object({
            owner: userRefSchema.default({}),
            level: z.number().int().min(1).max(20),
            role: z.enum(["pc", "companion"]).default("pc"),
            workshopId: z.string().max(100).default(""),
            sheet: createSheetSchema,
          })
          .strict(),
        rawParams,
      );
      const user = userOr404(params.owner, true);
      return { character: createCharacter(user.id, params.level, params.sheet, params.role, params.workshopId) };
    }

    case "characters.update": {
      const params = parse(
        z.object({ characterId: z.string().uuid(), level: z.number().int().min(1).max(20), sheet: createSheetSchema }).strict(),
        rawParams,
      );
      const existing = getCharacter(params.characterId);
      if (!existing) throw new McpControlError("Character not found.", 404);
      const character = updateCharacter(existing.userId, existing.id, params.level, params.sheet);
      if (!character) throw new McpControlError("Character update failed.", 500);
      return { character };
    }

    case "characters.delete": {
      const params = parse(
        z.object({ characterId: z.string().uuid(), confirm: z.literal(true) }).strict(),
        rawParams,
      );
      const character = getCharacter(params.characterId);
      if (!character) throw new McpControlError("Character not found.", 404);
      if (!deleteCharacter(character.userId, character.id)) throw new McpControlError("Character delete failed.", 500);
      return { deleted: { id: character.id, name: character.name } };
    }

    case "characters.instantiate": {
      const params = parse(
        z
          .object({
            characterId: z.string().uuid(),
            campaignId: z.string().uuid(),
            targetLevel: z.number().int().min(1).max(20).optional(),
          })
          .strict(),
        rawParams,
      );
      const character = getCharacter(params.characterId);
      if (!character) throw new McpControlError("Character not found.", 404);
      const campaign = campaignOr404(params.campaignId);
      const sheet = instantiateIntoCampaign(
        character.id,
        campaign.id,
        character.userId,
        params.targetLevel ?? campaign.startingLevel,
      );
      if ("error" in sheet) throw new McpControlError(sheet.error);
      publishPersisted(campaign.id, "mcp_control", { action: "character_instantiated", sheetId: sheet.id });
      return { sheet };
    }

    case "sheets.list": {
      const params = parse(z.object({ campaignId: z.string().uuid() }).strict(), rawParams);
      campaignOr404(params.campaignId);
      return { sheets: listSheets(params.campaignId) };
    }

    case "sheets.get": {
      const params = parse(z.object({ sheetId: z.string().uuid() }).strict(), rawParams);
      const sheet = getSheetById(params.sheetId);
      if (!sheet) throw new McpControlError("Sheet not found.", 404);
      return { sheet };
    }

    case "sheets.patch": {
      const params = parse(
        z.object({ sheetId: z.string().uuid(), patch: fullPatchSheetSchema }).strict(),
        rawParams,
      );
      const existing = getSheetById(params.sheetId);
      if (!existing) throw new McpControlError("Sheet not found.", 404);
      const sheet = patchSheet(params.sheetId, params.patch);
      if (!sheet) throw new McpControlError("Sheet patch failed.", 500);
      publishPersisted(existing.campaignId, "mcp_control", { action: "sheet_patched", sheetId: params.sheetId });
      return { sheet };
    }

    case "models.status": {
      const params = parse(
        z.object({ campaignId: z.string().uuid().optional() }).strict(),
        rawParams,
      );
      const globalConfig = getGlobalConfig();
      const profiles = listLlmProfiles();
      let campaignTarget = null;
      if (params.campaignId) {
        const campaign = campaignOr404(params.campaignId);
        campaignTarget = {
          campaignId: campaign.id,
          title: campaign.title,
          textProvider: campaign.settings.textProvider,
          localTextModel: campaign.settings.localTextModel,
          customModel: campaign.settings.customModel,
          customBaseUrl: campaign.settings.customBaseUrl ? maskEndpointUrl(campaign.settings.customBaseUrl) : "",
        };
      }
      return {
        global: {
          provider: globalConfig.text.provider,
          model: globalConfig.text.customModel,
          baseUrl: globalConfig.text.customBaseUrl ? maskEndpointUrl(globalConfig.text.customBaseUrl) : "",
          thinking: globalConfig.text.thinking,
        },
        campaign: campaignTarget,
        profiles,
        runtimeDefaults: {
          defaultLocalUrl: "http://127.0.0.1:11434/v1",
        },
      };
    }

    case "models.list": {
      const params = parse(
        z
          .object({
            provider: z.enum(["qwen-local", "qwen", "gemini", "chatgpt"]).default("qwen-local"),
            baseUrl: z.string().max(500).optional(),
            apiKey: z.string().max(400).optional(),
            region: z.enum(["international", "china", "token-plan"]).optional(),
          })
          .strict(),
        rawParams,
      );
      try {
        const res = (await performProviderAction("mcp-control", {
          action: "models",
          provider: params.provider,
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          region: params.region,
        })) as { models?: unknown[] };
        return { models: res.models ?? [] };
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          throw new McpControlError(err.code, err.status);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new McpControlError(`Failed to list models: ${message}`, 502);
      }
    }

    case "models.test_and_connect": {
      const params = parse(
        z
          .object({
            provider: z.enum(["qwen-local", "qwen", "gemini", "chatgpt"]).default("qwen-local"),
            model: z.string().trim().min(1).max(200),
            baseUrl: z.string().max(500).optional(),
            apiKey: z.string().max(400).optional(),
            region: z.enum(["international", "china", "token-plan"]).optional(),
            apply: z.boolean().default(true),
            campaignId: z.string().uuid().optional(),
          })
          .strict(),
        rawParams,
      );
      try {
        const connectResult = (await performProviderAction("mcp-control", {
          action: "connect",
          provider: params.provider,
          model: params.model,
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          region: params.region,
          apply: params.apply && !params.campaignId,
        })) as {
          profile?: { id: string };
          report?: { ok: boolean; stages?: Record<string, { ok: boolean; ms?: number; detail?: string }> };
          applied?: boolean;
        };

        let campaignApplied = false;
        if (params.campaignId && connectResult.profile?.id && connectResult.report?.ok) {
          const campaign = campaignOr404(params.campaignId);
          applyLlmProfileToCampaign(connectResult.profile.id, campaign.id);
          campaignApplied = true;
        }

        return {
          ...connectResult,
          campaignApplied,
          target: params.campaignId ? "campaign" : params.apply ? "global" : "profile_saved",
        };
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          throw new McpControlError(err.code, err.status);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new McpControlError(`Model connection probe failed: ${message}`, 502);
      }
    }

    case "models.apply": {
      const params = parse(
        z
          .object({
            profileId: z.string().uuid(),
            campaignId: z.string().uuid().optional(),
          })
          .strict(),
        rawParams,
      );
      const profile = getLlmProfile(params.profileId);
      if (!profile) throw new McpControlError("Profile not found.", 404);
      try {
        requireVerifiedProfile(profile);
      } catch (err: unknown) {
        if (err instanceof ProviderError) throw new McpControlError(err.code, err.status);
        throw err;
      }
      if (params.campaignId) {
        const campaign = campaignOr404(params.campaignId);
        applyLlmProfileToCampaign(profile.id, campaign.id);
        return {
          profile: maskLlmProfile(profile),
          applied: true,
          target: "campaign",
          campaignId: campaign.id,
        };
      } else {
        if (!applyLlmProfileToGlobal(profile.id)) {
          throw new McpControlError("Failed to apply profile globally.", 409);
        }
        return {
          profile: maskLlmProfile(profile),
          applied: true,
          target: "global",
        };
      }
    }

    case "models.switch_remote": {
      const params = parse(
        z
          .object({
            remoteUrl: z.string().trim().min(1).max(500),
            model: z.string().trim().min(1).max(200),
            apiKey: z.string().max(400).optional(),
            apply: z.boolean().default(true),
            campaignId: z.string().uuid().optional(),
          })
          .strict(),
        rawParams,
      );
      try {
        const connectResult = (await performProviderAction("mcp-control", {
          action: "connect",
          provider: "qwen-local",
          model: params.model,
          baseUrl: params.remoteUrl,
          apiKey: params.apiKey,
          apply: params.apply && !params.campaignId,
        })) as {
          profile?: { id: string };
          report?: { ok: boolean; stages?: Record<string, { ok: boolean; ms?: number; detail?: string }> };
          applied?: boolean;
        };

        let campaignApplied = false;
        if (params.campaignId && connectResult.profile?.id && connectResult.report?.ok) {
          const campaign = campaignOr404(params.campaignId);
          applyLlmProfileToCampaign(connectResult.profile.id, campaign.id);
          campaignApplied = true;
        }

        return {
          ...connectResult,
          campaignApplied,
          target: params.campaignId ? "campaign" : params.apply ? "global" : "profile_saved",
        };
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          throw new McpControlError(err.code, err.status);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new McpControlError(`Switching to remote model failed: ${message}`, 502);
      }
    }

    default:
      throw new McpControlError(`Unknown MCP control action: ${action}`, 404);
  }
}
