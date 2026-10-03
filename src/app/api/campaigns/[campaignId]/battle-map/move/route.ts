import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getFloor } from "@/lib/db/campaigns";
import { getActiveBoard } from "@/lib/db/encounters";
import { getSheetForUser } from "@/lib/db/sheets";
import { viewerFights } from "@/lib/dm/team-round";
import { withFight } from "@/lib/spatial/publication-scope.mjs";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
} from "@/lib/db/battle-maps";
import { buildPlayerMapView, occupiedTiles } from "@/lib/battlemap/view";
import { reachableTiles } from "@/lib/battlemap/movement";
import { movementBudget } from "@/lib/battlemap/movement-budget";
import { tileIndex } from "@/lib/battlemap/types";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { getCampaignById } from "@/lib/db/campaigns";
import { budgetApplies } from "@/lib/dm/action-budget";
import { resolveOpportunityAttacks } from "@/lib/dm/opportunity";
import { spatialEnabled, spatialStore } from "@/lib/spatial/service";
import { boundBattleMapRoom } from "@/lib/spatial/battle-map";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moveSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

// A player moves their own token. Server-authoritative: walls, occupancy,
// and the round's remaining speed budget are enforced here, and moving is
// only allowed on an open floor or the player's own initiative turn.
// Movement never wakes the DM; it reads fresh positions at its next turn.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { user } = context;
  const raw = await request.json().catch(() => ({}));
  const parsed = moveSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid destination." }, { status: 400 });
  }

  // The board, which is a fight or an exploration scene. Every combat rule
  // below is written against a fight and is skipped on a scene. Without
  // rooms a hero moves on the board of the fight they stand in.
  const own = spatialEnabled(campaignId) ? undefined : viewerFights(campaignId, user.id).own?.id ?? null;
  const scoped = <T>(work: () => T): T => (own === undefined ? work() : withFight(campaignId, own, work));
  return scoped(() => withCommittedEffects(() => getDatabase().transaction(() => {
    const roomId = spatialEnabled(campaignId) ? spatialStore().getUserRoom(campaignId, user.id) : undefined;
    const encounter = getActiveBoard(campaignId, roomId);
    const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
    if (!encounter || !map || (roomId !== undefined && boundBattleMapRoom(campaignId, user.id, encounter, map) !== roomId)) {
      return Response.json({ error: "No active battle map." }, { status: 404 });
    }
    const campaign = getCampaignById(campaignId);
    const sheet = getSheetForUser(campaignId, user.id);
    const token = sheet ? getTokenByRef(map.id, sheet.id) : null;
    if (!sheet || !token) {
      return Response.json({ error: "You have no token on this map." }, { status: 400 });
    }
    if (sheet.currentHp <= 0) {
      return Response.json({ error: "You are down and cannot move." }, { status: 409 });
    }

    const floor = getFloor(campaignId);
    if (floor.mode === "initiative") {
    const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
    if (!current || current.kind !== "pc" || current.characterId !== sheet.id) {
      return Response.json(
        { error: `It is ${current?.name || "another combatant"}'s turn to move.` },
        { status: 409 },
      );
    }
    } else if (floor.mode !== "open") {
    return Response.json({ error: "You cannot move right now." }, { status: 409 });
    }
    if (parsed.data.x >= map.width || parsed.data.y >= map.height) {
      return Response.json({ error: "Invalid destination." }, { status: 400 });
    }
    const { x, y } = parsed.data;

  // Grappled/restrained/paralyzed... = speed 0; exhaustion 2+ halves speed
  // and 5+ zeroes it. speedFor applies the class bonuses with their armor
  // gates and the heavy-armor Strength penalty, and the Dash action doubles
  // whatever is left. The server refuses impossible moves.
    const scene = encounter.kind === "scene";
    const turnState =
    !scene && budgetApplies(encounter.turnBudget, sheet.id, encounter.round)
      ? encounter.turnBudget
      : null;
    const movement = movementBudget({
    sheet,
    encumbrance: campaign?.gameSettings.variantRules.encumbrance ?? false,
    movedThisRound: token.movedThisRound,
    dashed: turnState?.dashed ?? false,
    ...(scene ? { sceneBudget: map.width * map.height } : {}),
  });
    const { speed } = movement;
    if (speed <= 0) {
    const cause =
      sheet.conditions.join(", ") ||
      ((sheet.exhaustion ?? 0) >= 5 ? `exhaustion level ${sheet.exhaustion}` : "a condition");
    return Response.json(
      { error: `You cannot move while ${cause} holds you (speed 0).` },
      { status: 409 },
    );
    }
  // A scene has no rounds, so there is no per-round budget to spend: the
  // party walks the board while the DM describes it.
    const budget = movement.remaining;
    const occupied = occupiedTiles(map, listTokens(map.id), token);
    const reach = reachableTiles(map.terrain, map.width, map.height, occupied, token, budget);
    const cost = reach.get(tileIndex(map.width, x, y));
    if (cost === undefined) {
    return Response.json({ error: "You cannot reach that tile this round." }, { status: 400 });
    }

    const from = { x: token.x, y: token.y };
    moveToken(token.id, x, y, scene ? 0 : token.movedThisRound + cost);
    publishBattleMapUpdate(campaignId);

  // Walking out of an enemy's reach is not free. Disengage suppresses it;
  // the budget carries that decision from the take_action tool.
    const opportunity =
    campaign && !scene
      ? resolveOpportunityAttacks(campaign, sheet.id, from, { x, y }, turnState?.disengaged ?? false)
      : { notes: [], downed: false };

  // Fresh self view in the response saves the mover a follow-up fetch.
    return Response.json({
    view: buildPlayerMapView(campaignId, user.id, { encounter }),
    ...(opportunity.notes.length ? { opportunityAttacks: opportunity.notes } : {}),
    });
  })()));
}
