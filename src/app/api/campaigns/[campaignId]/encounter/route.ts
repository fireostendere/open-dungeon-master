import { capsFor, isErrorResponse, requireMember, requireStoryAuthority } from "@/lib/campaign-api";
import { getFightFloor, getFloor, setFightFloor } from "@/lib/db/campaigns";
import { endEncounter, getActiveEncounter, listActiveFights, listEnemies, patchEnemyHp } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishPersisted } from "@/lib/events";
import { spatialLegacyPolicy } from "@/lib/spatial/legacy-projection";
import { fightSummaries, viewerFights } from "@/lib/dm/team-round";
import { withFight } from "@/lib/spatial/publication-scope.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's projection of the active fight. The shared stream carries
// only the player-safe payload, so a DM (who is allowed the real hit points
// and AC) re-fetches here after every encounter_updated ping, the same
// ping-and-self-fetch pattern the fogged battle map already uses.
import { spatialStore } from "@/lib/spatial/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const caps = capsFor(context);
  const policy = spatialLegacyPolicy({
    campaignId, userId: context.user.id, adjudicates: caps.adjudicates, ownedCharacterIds: [],
  });
  if (policy.scoped) {
    return Response.json({
      encounter: activePublicEncounter(campaignId, {
        enemyNumbers: caps.enemyNumbers,
        viewerUserId: context.user.id,
        roomId: spatialStore().getUserRoom(campaignId, context.user.id),
      }),
    });
  }
  // Without rooms every fight is watchable: the one asked for, else the
  // viewer's own, else the first (src/lib/dm/team-round.ts viewerFights).
  const { own, shown } = viewerFights(campaignId, context.user.id, new URL(request.url).searchParams.get("encounterId"));
  const fights = fightSummaries(campaignId);
  return Response.json({
    encounter: withFight(campaignId, shown?.id ?? null, () => activePublicEncounter(campaignId, {
      enemyNumbers: caps.enemyNumbers,
      viewerUserId: context.user.id,
    })),
    fights,
    // The fight this player stands in, and the floor that is theirs: that
    // fight's, or the table's when they stand outside every fight.
    ownFightId: own?.id ?? null,
    floor: own ? getFightFloor(campaignId, own) : getFloor(campaignId, null),
  });
}

// Lead escape hatch: force-end a wedged encounter. No XP, no outcome
// narration; the fiction is the lead's to patch up with a direction.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // With several fights at once (no rooms) the panel says which one.
  const requested = new URL(request.url).searchParams.get("encounterId");
  const encounter = requested
    ? listActiveFights(campaignId).find((fight) => fight.id === requested) ?? null
    : getActiveEncounter(campaignId);
  if (!encounter) {
    return Response.json({ error: "No active encounter." }, { status: 404 });
  }
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status === "alive") {
      patchEnemyHp(enemy.id, enemy.currentHp, "fled");
    }
  }
  endEncounter(encounter.id, "aborted");
  const floor = getFightFloor(campaignId, encounter);
  if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
    setFightFloor(campaignId, encounter, { mode: "open" });
    publishPersisted(campaignId, "floor_changed", { floor: { mode: "open" }, ...(encounter.roomId ? {} : { encounterId: encounter.id }) });
  }
  publishPersisted(campaignId, "encounter_updated", { encounter: null, endedEncounterId: encounter.id });
  publishBattleMapUpdate(campaignId);
  return Response.json({ ok: true });
}
