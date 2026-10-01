import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import {
  activeBeat,
  matchSignal,
  signalFromToolCall,
  tickWaypoints,
  type WaypointSignal,
} from "@/lib/dm/waypoint-logic";

// Ticking the [NOW] beat's waypoints from play (upstream issue #31). The
// narrator's own tool calls name the place, person or item outright, and the
// end of a won fight names the foes, so the server ticks those steps itself
// and complete_beat stays shut until they are done. Matching is by word
// stems (waypoint-logic.ts lexicalMatch). Upstream also matched by local
// MiniLM embeddings and ran a model judge for the rest; this server has no
// model, so a step named differently is ticked by the lead in the arc card.
// Returns the texts ticked, for the tool result.
export function tickWaypointsFrom(campaignId: string, signal: WaypointSignal | null): string[] {
  const arc = signal ? getCampaignById(campaignId)?.storyArc : null;
  const active = arc ? activeBeat(arc) : null;
  if (!signal || !arc || !active) {
    return [];
  }
  const matched = matchSignal(active.beat, signal);
  const next = tickWaypoints(arc, active.number, matched);
  if (next === arc) {
    return [];
  }
  setStoryArc(campaignId, next);
  return matched.map((index) => active.beat.waypoints?.[index]?.text ?? "").filter(Boolean);
}

export function tickWaypointsFromCall(
  campaignId: string,
  name: string,
  rawArguments: string,
  result: Record<string, unknown>,
): string[] {
  return tickWaypointsFrom(campaignId, signalFromToolCall(name, rawArguments, result));
}
