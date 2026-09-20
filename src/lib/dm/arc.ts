import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import { activeBeatNumber, completeBeat, nextSketchAct } from "@/lib/dm/arc-logic";

export function handleCompleteBeat(
  campaignId: string,
  rawArguments: string,
  alreadyCompleted: boolean,
): { result: Record<string, unknown>; completed: boolean } {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc) return { result: { error: "This campaign has no story arc yet." }, completed: false };
  if (alreadyCompleted) return { result: { error: "A beat was already completed this turn; let the story breathe." }, completed: false };
  let args: { beat?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { result: { error: "Invalid arguments." }, completed: false }; }
  const active = activeBeatNumber(campaign.storyArc);
  const requested = Number(args.beat);
  const beatNumber = Number.isInteger(requested) && requested >= 1 ? requested : active;
  if (beatNumber === null) return { result: { error: "Every beat of the arc is already finished." }, completed: false };
  const advanced = completeBeat(campaign.storyArc, beatNumber);
  if (!advanced) return { result: { error: `Beat ${beatNumber} is not an open beat.`, ...(active === null ? {} : { activeBeat: active }) }, completed: false };
  setStoryArc(campaignId, advanced.arc);
  const nextActive = activeBeatNumber(advanced.arc);
  return {
    result: {
      ok: true, completedBeat: beatNumber,
      ...(nextActive === null
        ? { note: nextSketchAct(advanced.arc) ? "That act is complete; the next act must be authored externally." : "That was the final authored beat." }
        : { nextBeat: advanced.arc.beats[nextActive - 1].text }),
    },
    completed: true,
  };
}
