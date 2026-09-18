import { campaignSeats, getCampaignById, getGlobalTurnState, listMembers, setGlobalTurnState, setMemberSkipTurns } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm } from "@/lib/dm/viewer";
import { requestUtilityMessage } from "@/lib/dm/model";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { GlobalTurnState } from "@/lib/campaign-types";

// In-memory timer references to fire turn completion exactly on deadline
const activeTurnTimers = new Map<string, NodeJS.Timeout>();

export function scheduleGlobalTurnTimer(campaignId: string, deadlineIso: string | null) {
  const existing = activeTurnTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    activeTurnTimers.delete(campaignId);
  }
  if (!deadlineIso) return;

  const msRemaining = Math.max(500, new Date(deadlineIso).getTime() - Date.now());
  // Do not schedule excessively distant timers (max 2 hours in memory)
  if (msRemaining > 2 * 60 * 60 * 1000) return;

  const timer = setTimeout(() => {
    activeTurnTimers.delete(campaignId);
    void resolveGlobalTurn(campaignId).catch((err) =>
      console.error(`[global-turn] Failed to resolve turn on timer for ${campaignId}:`, err)
    );
  }, msRemaining);

  // Do not keep process open because of timer
  timer.unref?.();
  activeTurnTimers.set(campaignId, timer);
}

export function cancelGlobalTurnTimer(campaignId: string) {
  const existing = activeTurnTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    activeTurnTimers.delete(campaignId);
  }
}

/**
 * Validates and records player action in the global turn.
 * Enforces RAW: maximum 1 do and 1 say per hero per global turn.
 */
export function recordGlobalTurnAction(
  campaignId: string,
  sheetId: string,
  userId: string,
  kind: "do" | "say" | "ooc",
): { allowed: boolean; error?: string; state?: GlobalTurnState } {
  if (kind === "ooc") {
    return { allowed: true };
  }

  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return { allowed: false, error: "Campaign not found." };
  }

  const globalTurnSettings = campaign.gameSettings.globalTurn;
  if (!globalTurnSettings?.enabled) {
    return { allowed: true };
  }

  const state = getGlobalTurnState(campaignId);
  const usage = state.actionsByCharacter[sheetId] ?? { actionsCount: 0, phrasesCount: 0, updatedAt: new Date().toISOString() };

  if (kind === "do" && usage.actionsCount >= 1) {
    return {
      allowed: false,
      error: "В этом ходе вы уже совершили действие. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }

  if (kind === "say" && usage.phrasesCount >= 1) {
    return {
      allowed: false,
      error: "В этом ходе вы уже произнесли фразу. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }

  // Update hero action counts
  const nextUsage = {
    actionsCount: kind === "do" ? usage.actionsCount + 1 : usage.actionsCount,
    phrasesCount: kind === "say" ? usage.phrasesCount + 1 : usage.phrasesCount,
    lastActionKind: kind,
    updatedAt: new Date().toISOString(),
  };

  const nextActions = {
    ...state.actionsByCharacter,
    [sheetId]: nextUsage,
  };

  const now = Date.now();
  let firstActionAt = state.firstActionAt;
  let deadlineAt = state.deadlineAt;
  let phase: GlobalTurnState["phase"] = state.phase;
  let quorumReachedAt = state.quorumReachedAt;

  // First action in round starts the collection timer (N minutes)
  if (!firstActionAt) {
    firstActionAt = new Date(now).toISOString();
    const collectionMs = globalTurnSettings.turnCollectionMinutes * 60 * 1000;
    deadlineAt = new Date(now + collectionMs).toISOString();
    phase = "active";
  }

  // Check quorum of responded players
  const sheets = listSheets(campaignId);
  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);
  const members = listMembers(campaignId);

  const respondedCount = playerSheets.filter((s) => {
    const u = nextActions[s.id];
    if (u && (u.actionsCount > 0 || u.phrasesCount > 0)) return true;
    const m = members.find((mem) => mem.userId === s.userId);
    return Boolean(m && m.skipTurnsCount > 0);
  }).length;

  const totalPlayers = Math.max(1, playerSheets.length);
  const quorumTarget = Math.min(totalPlayers, globalTurnSettings.quorumPlayers);

  // If quorum reached, accelerate deadline to (now + Z minutes grace delay)
  if (respondedCount >= quorumTarget && deadlineAt) {
    const graceDelayMs = globalTurnSettings.quorumDelayMinutes * 60 * 1000;
    const quorumDeadline = new Date(now + graceDelayMs).toISOString();
    if (!quorumReachedAt) {
      quorumReachedAt = new Date(now).toISOString();
    }
    if (new Date(quorumDeadline).getTime() < new Date(deadlineAt).getTime()) {
      deadlineAt = quorumDeadline;
      phase = "quorum_delay";
    }
  }

  // If ALL players have acted, finish promptly
  const allAnswered = respondedCount >= totalPlayers;
  if (allAnswered) {
    phase = "resolving";
  }

  const updatedState: GlobalTurnState = {
    roundNumber: state.roundNumber,
    phase,
    firstActionAt,
    deadlineAt,
    quorumReachedAt,
    actionsByCharacter: nextActions,
  };

  setGlobalTurnState(campaignId, updatedState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: updatedState });

  if (allAnswered) {
    // Resolve immediately on next tick
    setTimeout(() => {
      void resolveGlobalTurn(campaignId).catch((err) =>
        console.error(`[global-turn] Immediate resolve failed for ${campaignId}:`, err)
      );
    }, 1000);
  } else if (deadlineAt) {
    scheduleGlobalTurnTimer(campaignId, deadlineAt);
  }

  return { allowed: true, state: updatedState };
}

/**
 * Fallback in-character action generator when LLM is offline or not configured.
 */
function defaultClassAction(sheet: CharacterSheet): string {
  const cls = (sheet.class || "").toLowerCase();
  if (cls.includes("fighter") || cls.includes("barbarian") || cls.includes("воин") || cls.includes("варвар")) {
    return `*Крепче сжимает оружие и встает в боевую стойку, прикрывая союзников.* "Держитесь позади меня, я готов ко всему."`;
  }
  if (cls.includes("paladin") || cls.includes("паладин")) {
    return `*Поднимает щит со священным символом и встает на защиту отряда.* "Свет защитит нас. Будьте бдительны."`;
  }
  if (cls.includes("rogue") || cls.includes("плут") || cls.includes("следопыт") || cls.includes("ranger")) {
    return `*Прижимается к укрытию и осматривает тени в поисках скрытых угроз.* "Тише... следите за флангами."`;
  }
  if (cls.includes("wizard") || cls.includes("sorcerer") || cls.includes("warlock") || cls.includes("маг") || cls.includes("волшебник") || cls.includes("колдун") || cls.includes("чародей")) {
    return `*Фокусирует взгляд на окружении, держа руку на магическом фокусе.* "Я чувствую напряжение в воздухе. Будьте осторожны."`;
  }
  if (cls.includes("cleric") || cls.includes("druid") || cls.includes("жрец") || cls.includes("друид")) {
    return `*Шепчет тихую молитву о защите, готовый исцелить раненых.* "Да хранят нас боги в этот час."`;
  }
  if (cls.includes("bard") || cls.includes("бард")) {
    return `*С лёгкой полуулыбкой держит инструмент наготове, подбадривая соратников.* "Ну что, друзья, покажем, на что мы способны!"`;
  }
  return `*Внимательно следит за развитием событий, готовый в любой момент поддержать соратников.*`;
}

/**
 * Generates an in-character action and speech using Doppelganger logic.
 */
export async function generateDoppelgangerAction(
  campaign: Campaign,
  sheet: CharacterSheet,
): Promise<string> {
  const recentMsgs = listRecentMessages(campaign.id, 5)
    .map((m) => `[${m.authorType}]: ${m.content}`)
    .join("\n");

  const prompt = `Ты отыгрываешь персонажа D&D 5e на автопилоте (скилл Доппельгангер).
Персонаж: ${sheet.name}
Раса и класс: ${sheet.race} ${sheet.class}, Уровень: ${sheet.level}
Мировоззрение: ${sheet.alignment || "Нейтральный"}
Предыстория / черты: ${sheet.background || "Приключенец"}
Текущее HP: ${sheet.currentHp}/${sheet.maxHp}

Последние события за столом:
${recentMsgs || "Отряд ожидает действий."}

Задача: Напиши ОДНО короткое, характерное действие персонажа и/или ОДНУ реплику в прямом эфире.
Формат ответа: только текст в свободной форме (например: *Действие* "Реплика").
Не пиши meta-комментариев и пояснений.`;

  try {
    const res = await requestUtilityMessage(
      campaign.settings,
      [{ role: "user", content: prompt }],
      { maxOutputTokens: 150, temperature: 0.7 },
    );
    const content = typeof res.message?.content === "string" ? res.message.content.trim() : "";
    if (content.length > 0) {
      return content;
    }
  } catch {
    // Fall back gracefully
  }

  return defaultClassAction(sheet);
}

/**
 * Resolves the global turn round:
 * - Executes autopilot (Doppelganger) turns for idle players
 * - Decrements skip turn counters
 * - Advances round counter
 * - Notifies DM / triggers narration
 */
export async function resolveGlobalTurn(campaignId: string): Promise<GlobalTurnState | null> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return null;

  cancelGlobalTurnTimer(campaignId);

  const state = getGlobalTurnState(campaignId);
  const sheets = listSheets(campaignId);
  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);
  const members = listMembers(campaignId);

  // 1. Run Autopilot / Skip logic for idle players
  for (const sheet of playerSheets) {
    const usage = state.actionsByCharacter[sheet.id];
    const hasActed = Boolean(usage && (usage.actionsCount > 0 || usage.phrasesCount > 0));
    const member = members.find((m) => m.userId === sheet.userId);

    if (!hasActed && member) {
      if (member.skipTurnsCount > 0) {
        // Player skipped turn
        const remaining = member.skipTurnsCount - 1;
        setMemberSkipTurns(campaignId, member.userId, remaining);

        const seq = allocateSeq(campaignId);
        const msg = insertCampaignMessage({
          campaignId,
          seq,
          authorType: "player",
          userId: member.userId,
          characterId: sheet.id,
          content: `*${sheet.name} пропускает этот ход.*`,
        });
        publishWithSeq(campaignId, seq, "message_added", { message: msg });
      } else if (member.autopilot) {
        // Doppelganger Autopilot turn
        try {
          const actionContent = await generateDoppelgangerAction(campaign, sheet);
          const seq = allocateSeq(campaignId);
          const msg = insertCampaignMessage({
            campaignId,
            seq,
            authorType: "player",
            userId: member.userId,
            characterId: sheet.id,
            content: actionContent,
          });
          publishWithSeq(campaignId, seq, "message_added", { message: msg });
        } catch (err) {
          console.error(`[autopilot] Failed to generate turn for ${sheet.name}:`, err);
        }
      }
    }
  }

  // 2. Prepare next round state
  const nextRoundNumber = state.roundNumber + 1;
  const nextState: GlobalTurnState = {
    roundNumber: nextRoundNumber,
    phase: "waiting",
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };

  setGlobalTurnState(campaignId, nextState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: nextState });
  publishPersisted(campaignId, "global_turn_resolved", {
    resolvedRound: state.roundNumber,
    nextRound: nextRoundNumber,
  });

  // 3. Wake DM narration
  const covering = coverInEffect(
    campaign.gameSettings.dmMode,
    campaign.gameSettings.dmAssist,
    campaign.dmCover,
  );
  const humanDm = hasHumanDm(campaignSeats(campaign)) && !covering;

  if (humanDm) {
    publishPersisted(campaignId, "global_turn_ended", {
      roundNumber: state.roundNumber,
      message: "Все действия раунда собраны. Мастер может взять слово.",
    });
  } else {
    requestDmTurn(campaignId);
  }

  return nextState;
}
