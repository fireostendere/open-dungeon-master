import { spatialEnabled, runSpatialCommand, SpatialError } from "@/lib/spatial/service";
import { z } from "zod";
import { enforcePlayerIngress } from "@/lib/ingress-budget";
import { isErrorResponse, requireVoice } from "@/lib/campaign-api";
import {
  allocateSeq,
  campaignSeats,
  canAct,
  claimRecap,
  getFloor,
  setFloor,
  type Floor,
} from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { requestDmTurn } from "@/lib/dm/loop";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm } from "@/lib/dm/viewer";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runResumeRecap } from "@/lib/dm/recap";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { recordGlobalTurnAction } from "@/lib/dm/global-turn-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/action-tools";
import { validateCombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  kind: z.enum(["do", "say", "ooc"]).default("do"),
  combatTurn: z.object({
    encounterId: z.string().uuid(),
    round: z.number().int().min(1),
    turnIndex: z.number().int().min(0),
    choices: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("attack"), targetEnemyId: z.string().uuid(), weapon: z.string().trim().min(1).max(80) }),
      z.object({ type: z.literal("dodge") }),
      z.object({ type: z.literal("resource"), resource: z.string().trim().min(1).max(80), targetCharacterId: z.string().uuid().optional() }),
      z.object({ type: z.literal("item"), item: z.string().trim().min(1).max(80), targetCharacterId: z.string().uuid().optional() }),
    ])).max(8),
    prose: z.string().trim().max(1200).optional(),
  }).strict().optional(),
}).strict()
  .refine((value) => Boolean(value.content || value.combatTurn), "An action needs content or a combat turn.")
  .refine((value) => !value.combatTurn || value.kind === "do", "Combat turns must be actions.");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const sheet = getSheetForUser(campaignId, user.id);
  if (!sheet) {
    return Response.json({ error: "You need a character to act." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  const limited = enforcePlayerIngress(campaignId, user.id, "action");
  if (limited) return limited;
  const { kind } = parsed.data;

  if (spatialEnabled(campaignId)) {
    if (kind !== "ooc") return Response.json({ error: "Choose a location and send through location-chat." }, { status: 409 });
    try {
      const result = runSpatialCommand(campaignId, user.id, {
        operation: "send", requestId: crypto.randomUUID(), kind: "ooc", content: parsed.data.content,
      });
      return Response.json({ messageId: (result.message as { id: string }).id }, { status: 202 });
    } catch (error) {
      if (error instanceof SpatialError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  // Floor control: during a spotlight only the named players may act (ooc is
  // always allowed); the floor releases once ALL of them have answered.
  // During a hold nobody may act until the lead releases. This read-modify-
  // write must stay await-free so it is atomic in Node.
  const floor = getFloor(campaignId);
  if (!canAct(floor, user.id, kind)) {
    if (floor.mode === "hold") {
      return Response.json(
        {
          error: "The party lead has not opened responses yet. Use OOC for table talk.",
          floor,
        },
        { status: 409 },
      );
    }
    if (floor.mode === "initiative") {
      return Response.json(
        {
          error: `It is ${floor.currentName || "another character"}'s turn in the initiative order. Use OOC for table talk.`,
          floor,
        },
        { status: 409 },
      );
    }
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter(
              (entry) =>
                floor.userIds.includes(entry.userId) &&
                !floor.respondedUserIds.includes(entry.userId),
            )
            .map((entry) => entry.name)
            .join(", ")
        : "";
    return Response.json(
      {
        error: waitingOn
          ? `The DM is waiting on ${waitingOn}. Use OOC for table talk.`
          : "It is not your moment to act.",
        floor,
      },
      { status: 409 },
    );
  }
  const encounter = getActiveEncounter(campaignId);
  if (kind !== "ooc" && encounter) {
    const actor = encounter.order[encounter.turnIndex];
    if (!encounter.orderReady || floor.mode !== "initiative" || actor?.kind !== "pc" || actor.characterId !== sheet.id || listOpenPendingRolls(campaignId).length) {
      return Response.json({ error: "Wait for your combat turn and pending rolls. OOC remains available." }, { status: 409 });
    }
  }
  let combatContent: string | null = null;
  let combatGate: Extract<Floor, { mode: "hold" }>["combat"] | undefined;
  if (parsed.data.combatTurn) {
    const intent = parsed.data.combatTurn;
    if (kind !== "do" || floor.mode !== "initiative" || !encounter || !encounter.orderReady ||
      intent.encounterId !== encounter.id || intent.round !== encounter.round || intent.turnIndex !== encounter.turnIndex) {
      return Response.json({ error: "This combat turn is stale. Refresh the encounter." }, { status: 409 });
    }
    const current = encounter.order[encounter.turnIndex];
    if (!current || current.kind !== "pc" || current.characterId !== sheet.id) {
      return Response.json({ error: "It is not your initiative turn." }, { status: 409 });
    }
    const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
    if (!budget) return Response.json({ error: "This combat turn is no longer available." }, { status: 409 });
    const publicEncounter = activePublicEncounter(campaignId);
    const allies = listSheets(campaignId).filter((entry) => !entry.deathSaves?.dead);
    const visibleEnemies = publicEncounter?.enemies.filter((enemy) => enemy.status === "alive") ?? [];
    const result = validateCombatTurnIntent(intent, sheet, new Set(visibleEnemies.map((enemy) => enemy.id)), new Set(allies.map((entry) => entry.id)), budget, {
      language: campaign.gameSettings.language ?? "ru",
      names: new Map([...allies, ...visibleEnemies].map((entry) => [entry.id, entry.name])),
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    combatContent = result.content;
    combatGate = { encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, characterId: sheet.id, requiresEndTurn: true, mechanicsResolved: false };
  }
  let spotlightStillWaiting = false;
  if (kind !== "ooc" && floor.mode === "spotlight") {
    const responded =
      floor.userIds.includes(user.id) && !floor.respondedUserIds.includes(user.id)
        ? [...floor.respondedUserIds, user.id]
        : floor.respondedUserIds;
    const allAnswered = floor.userIds.every((id) => responded.includes(id));
    const nextFloor: Floor = allAnswered
      ? { mode: "open" }
      : { ...floor, respondedUserIds: responded };
    if (allAnswered || responded !== floor.respondedUserIds) {
      setFloor(campaignId, nextFloor);
      publishPersisted(campaignId, "floor_changed", { floor: nextFloor });
    }
    spotlightStillWaiting = !allAnswered;
  }

  // Global turn pacing: enforce maximum 1 do and 1 say per hero per turn
  // Initiative already has a per-combatant action budget; global collection
  // pacing must not consume or reject combat turns.
  const turnResult = encounter?.orderReady ? { allowed: true } : recordGlobalTurnAction(campaignId, sheet.id, user.id, kind);
  if (!turnResult.allowed) {
    return Response.json({ error: turnResult.error ?? "Действие недоступно в этом ходе." }, { status: 409 });
  }

  const content =
      combatContent ?? (kind === "say"
      ? `"${parsed.data.content}"`
      : kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content!);

  const isFirstAction = countMessages(campaignId) === 0;

  // Returning after a long break: enqueue a "Previously..." recap before
  // this action's DM turn (claimRecap makes it at most once per gap).
  const lastMessages = listRecentMessages(campaignId, 1);
  const lastMessage = lastMessages[lastMessages.length - 1];
  const RECAP_IDLE_MS = 6 * 60 * 60 * 1000;
  // Assisted mode, DM stepped away: the AI answers for the counted stretch
  // they handed over, so the branch below is the one that already exists for
  // an AI-run table rather than a third path.
  const covering = coverInEffect(
    campaign.gameSettings.dmMode,
    campaign.gameSettings.dmAssist,
    campaign.dmCover,
  );
  const humanDm = hasHumanDm(campaignSeats(campaign)) && !covering;
  if (
    !humanDm &&
    lastMessage &&
    Date.now() - new Date(lastMessage.createdAt).getTime() > RECAP_IDLE_MS &&
    claimRecap(campaignId, lastMessage.seq)
  ) {
    enqueueDmJob(campaignId, () => runResumeRecap(campaignId));
  }

  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "player",
    userId: user.id,
    characterId: sheet.id,
    content,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  // Non-OOC combat input is exclusive until a DM narration completes. A
  // bundle additionally requires explicit end_turn, so prose cannot advance
  // initiative by guessing the player's intent.
  if (kind !== "ooc" && floor.mode === "initiative") {
    const gate = combatGate ?? {
      encounterId: floor.encounterId, round: floor.round, turnIndex: encounter?.turnIndex ?? 0,
      characterId: sheet.id, requiresEndTurn: false, mechanicsResolved: false,
    };
    const held: Floor = { mode: "hold", next: floor, combat: gate };
    setFloor(campaignId, held);
    publishPersisted(campaignId, "floor_changed", { floor: held });
  }

  // OOC table talk does not wake the DM; everything else requests a
  // narration turn, except while a spotlight still waits on other players:
  // the single coalesced turn fires with the last answer and reads all the
  // queued messages. Requests coalesce: rapid actions share one turn (plus
  // at most one follow-up for actions landing mid-turn) instead of stacking.
  //
  // With a person in the DM seat there is no turn to wake. The action is an
  // intent: it sits in the DM's queue until they adjudicate it, and all the
  // table sees is that it landed. The message row and the floor bookkeeping
  // above are identical either way, which is what keeps one transcript.
  // Initiative owns its own progression; global collection must neither
  // suppress this wake nor compete with its action accounting.
  const globalTurnActive = Boolean(campaign.gameSettings?.globalTurn?.enabled) && !encounter?.orderReady;
  if (!globalTurnActive && ((kind !== "ooc" && !spotlightStillWaiting) || isFirstAction)) {
    if (humanDm) {
      publishPersisted(campaignId, "dm_intent_queued", {
        messageId: message.id,
        userId: user.id,
        characterId: sheet.id,
        seq,
      });
    } else {
      // Under a running cover, requestDmTurn itself spends one of the DM's
      // handed-over answers per enqueued turn (and none on a coalesced one),
      // so a burst of actions costs the DM one answer and not five.
      requestDmTurn(campaignId);
    }
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
