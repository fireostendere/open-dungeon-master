import { z } from "zod";
import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { allocateSeq, getFloor, setFloor, type Floor } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { queueSkippedCombatTurn, skipCurrentTurn } from "@/lib/dm/encounter-tools";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { enqueueDmJob } from "@/lib/dm/queue";
import { insertCampaignMessage } from "@/lib/db/messages";
import { combatHandoffState, passCombatTurn } from "@/lib/dm/human-turn-lifecycle";
import { viewerFights } from "@/lib/dm/team-round";
import { withFight } from "@/lib/spatial/publication-scope.mjs";
import { spatialEnabled } from "@/lib/spatial/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the table reads when the lead moves on without the DM.
const FORCED_PASS = {
  en: "The party lead passed the turn on without the DM's resolution.",
  ru: "Лидер отряда передал ход дальше, не дождавшись мастера.",
};

// A person running the table wants the opposite verb too: not only "let
// them go" but "hold it", and "you two, now". `set` takes the floor
// straight there; without it the route keeps its original release-only
// behavior, so nothing that already calls it changes.
const setFloorSchema = z.object({
  set: z.enum(["open", "hold", "spotlight"]).optional(),
  // A held combat turn: hand it to the next actor. Without `force` only a
  // turn the DM has resolved; with it, the escape hatch for a narrator that
  // went silent mid-turn (the submitted action is dropped unresolved).
  passTurn: z.boolean().optional(),
  force: z.boolean().optional(),
  // spotlight only.
  characterIds: z.array(z.string()).max(12).optional(),
  prompt: z.string().trim().max(300).optional(),
  // Without rooms, several fights at once: the one this is about (default:
  // the one the caller stands in or watches).
  encounterId: z.string().uuid().optional(),
});

// Release, layered: a hold opens into its stored next floor (which may be a
// spotlight); a spotlight force-opens. Releasing a partially answered
// spotlight hands the answers so far to the DM; releasing a hold or a fully
// unanswered spotlight wakes nobody (there is nothing to answer).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isLead(context) && !steersStory(context)) return Response.json({ error: "Only the party lead or DM can change the floor." }, { status: 403 });
  const parsed = setFloorSchema.safeParse(await request.json().catch(() => ({})));
  // Without rooms each fight has its own floor (src/lib/db/fight-scope.ts):
  // work on the fight asked for, else the caller's own or watched one.
  const spatial = spatialEnabled(campaignId);
  const fightId = spatial ? undefined
    : viewerFights(campaignId, context.user.id, parsed.success ? parsed.data.encounterId : undefined).shown?.id ?? null;
  const scoped = <T>(work: () => T): T => (fightId === undefined ? work() : withFight(campaignId, fightId, work));
  return scoped(async () => {
    if (context.campaign.gameSettings.globalTurn?.enabled && !getActiveEncounter(campaignId)) {
      return Response.json({ error: "Global-turn pacing owns the floor; use the round control." }, { status: 409 });
    }
    const floor = getFloor(campaignId);
    if (listOpenPendingRolls(campaignId).length) {
      return Response.json({ error: "Resolve pending physical rolls before changing the floor." }, { status: 409 });
    }
    if (floor.mode === "hold" && floor.combat) {
      const handoff = combatHandoffState(campaignId, floor);
      const force = Boolean(parsed.success && parsed.data.force);
      if (!(parsed.success && parsed.data.passTurn) || (handoff.state !== "ready" && !force)) {
        return Response.json({ error: "Combat adjudication is still in progress. Only OOC is available." }, { status: 409 });
      }
      let failure: unknown = null;
      await enqueueDmJob(campaignId, async () => {
        try {
          scoped(() => withCommittedEffects(() => getDatabase().transaction(() => {
            const current = getFloor(campaignId);
            if (current.mode !== "hold" || !current.combat) return;
            if (combatHandoffState(campaignId, current).state !== "ready") {
              // Forced: the DM never resolved it. Say so at the table, then
              // move on as if it had been resolved.
              setFloor(campaignId, { ...current, combat: { ...current.combat, mechanicsResolved: true } });
              const seq = allocateSeq(campaignId);
              const message = insertCampaignMessage({ campaignId, seq, authorType: "system",
                content: FORCED_PASS[context.campaign.gameSettings.language === "en" ? "en" : "ru"] });
              publishWithSeq(campaignId, seq, "message_added", { message });
            }
            passCombatTurn(context.campaign);
          })()));
        } catch (error) { failure = error; }
      });
      if (failure) return Response.json({ error: failure instanceof Error ? failure.message : "Could not pass the turn." }, { status: 409 });
      return Response.json({ ok: true, floor: getFloor(campaignId) });
    }

    const wanted = parsed.success ? parsed.data.set : undefined;
    if (wanted) {
      // Initiative is the encounter's to own; nothing sets the floor into or
      // out of it but the combat engine.
      if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
        return Response.json(
          { error: "The initiative order owns the floor while a fight is running." },
          { status: 409 },
        );
      }
      let next: Floor;
      if (wanted === "open") {
        next = { mode: "open" };
      } else if (wanted === "hold") {
        next = { mode: "hold", next: { mode: "open" } };
      } else {
        const wantedIds = new Set(parsed.data?.characterIds ?? []);
        const userIds = [
          ...new Set(
            listSheets(campaignId)
              .filter((sheet) => wantedIds.has(sheet.id) && !sheet.isCompanion)
              .map((sheet) => sheet.userId),
          ),
        ];
        if (!userIds.length) {
          return Response.json(
            { error: "Pick at least one player character to give the floor to." },
            { status: 400 },
          );
        }
        next = {
          mode: "spotlight",
          userIds,
          prompt: parsed.data?.prompt ?? "",
          respondedUserIds: [],
        };
      }
      setFloor(campaignId, next);
      publishPersisted(campaignId, "floor_changed", { floor: next });
      if (floor.mode === "spotlight" && floor.respondedUserIds.length && !context.campaign.gameSettings.globalTurn?.enabled) {
        publishPersisted(campaignId, "spotlight_ready", { releasedEarly: true });
      }
      return Response.json({ ok: true, floor: next });
    }

    // A team-round hold opens with the next global round (src/lib/dm/team-round.ts).
    if (floor.mode === "hold" && floor.team) {
      return Response.json({ error: "The fight waits for the rest of the party this team round." }, { status: 409 });
    }
    // In combat, "release" means skip the absent player's turn: the pointer
    // advances and the DM plays any intervening enemies.
    if (floor.mode === "initiative") {
      skipCurrentTurn(campaignId);
      return Response.json({ ok: true });
    }
    const next: Floor = floor.mode === "hold" ? floor.next : { mode: "open" };
    setFloor(campaignId, next);
    publishPersisted(campaignId, "floor_changed", { floor: next });
    if (floor.mode === "spotlight" && floor.respondedUserIds.length && !context.campaign.gameSettings.globalTurn?.enabled) {
      publishPersisted(campaignId, "spotlight_ready", { releasedEarly: true });
    }
    queueSkippedCombatTurn(campaignId);
    return Response.json({ ok: true });
  });
}
