import { z } from "zod";
import { allocateSeq, getCampaignById, latestSeq, setCampaignScene, setQuestLog, setStoryArc, type Campaign } from "@/lib/db/campaigns";
import { closeChapterRow, ensureOpenChapter, getOpenChapter, listChapters, setChapterAct, updateChapter } from "@/lib/db/chapters";
import { captureBoundarySnapshot } from "@/lib/db/snapshots-store";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import {
  actRecapFor,
  actTransition,
  activeBeatNumber,
  completeBeat,
  currentAct,
  nextSketchAct,
  normalizeStoryArc,
  recordActRecap,
  romanNumeral,
  sagaIndexOf,
  type StoryArc,
} from "@/lib/dm/arc-logic";
import { gatingWaypoints } from "@/lib/dm/waypoint-logic";
import { assertPlayerFacingText } from "@/lib/dm/narration-guard";

const storyUpdateSchema = z.object({
  arc: z.unknown().optional(),
  scene: z.string().trim().min(1).max(2000).optional(),
  quests: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  chapterTitle: z.string().trim().min(1).max(120).optional(),
  chapterSummary: z.string().trim().min(1).max(8000).optional(),
  chapterHighlights: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
  closeChapter: z.boolean().optional(),
}).strict().refine((args) => Object.keys(args).length > 0, "Provide a story update.");

// The external DM authors the plan and public recap; dice and beat advancement
// still use the ordinary engine actions. This runs inside invoke's transaction.
export function handleUpdateStory(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawArguments || "{}");
    for (const field of ["arc", "quests", "chapterHighlights"]) {
      if (typeof raw[field] === "string") raw[field] = JSON.parse(raw[field] as string);
    }
  } catch { return { error: "Story updates need valid JSON." }; }
  const parsed = storyUpdateSchema.safeParse(raw);
  if (!parsed.success) return { error: z.prettifyError(parsed.error) };
  const args = parsed.data;
  const arc = args.arc === undefined ? null : normalizeStoryArc(args.arc);
  if (args.arc !== undefined && !arc) return { error: "Invalid story arc; provide a premise and at least two beats." };
  if (arc) {
    const before = campaign.storyArc;
    if (before) {
      for (const field of ["stakes", "antagonist", "finale"] as const) {
        if (!Object.hasOwn(args.arc as object, field)) Object.assign(arc, { [field]: before[field] });
      }
      // Referee packets compact these layers, so even an explicit partial array
      // cannot replace their full persisted canon or reopen settled history.
      arc.saga = before.saga;
      arc.cast = before.cast;
      arc.events = before.events;
      arc.subArcs = before.subArcs;
    }
    if (before && (sagaIndexOf(before) !== sagaIndexOf(arc) || before.beats.some((beat, index) => {
      const next = arc.beats[index];
      if (next && (beat.status === "done" || beat.status === "skipped")) next.detail = beat.detail;
      return !next || next.status !== beat.status || next.act !== beat.act ||
        ((beat.status === "done" || beat.status === "skipped") && next.text !== beat.text) ||
        JSON.stringify(next.waypoints ?? []) !== JSON.stringify(beat.waypoints ?? []);
    }))) return { error: "Preserve existing beat order, completed history, statuses and waypoints; use complete_beat to advance play." };
    if (arc.beats.slice(before?.beats.length ?? 0).some((beat) => beat.status === "done" || beat.status === "skipped") ||
      arc.beats.filter((beat) => beat.status === "active").length > 1) {
      return { error: "New beats must remain unplayed, with at most one active beat." };
    }
    if (before) {
      // Reauthoring plans must not reset the engine's world clocks or recaps.
      arc.worldArcs = before.worldArcs;
      arc.actRecaps = before.actRecaps;
    }
  }
  try {
    for (const text of [args.scene, args.chapterTitle, args.chapterSummary, ...(args.quests ?? []), ...(args.chapterHighlights ?? [])]) {
      assertPlayerFacingText(text, "story recap");
    }
  } catch (error) { return { error: error instanceof Error ? error.message : "Invalid public story text." }; }
  const chapter = arc || args.chapterTitle || args.chapterSummary || args.chapterHighlights || args.closeChapter
    ? ensureOpenChapter(campaign.id) : null;
  if (args.closeChapter && !(args.chapterSummary || chapter?.summary)) return { error: "Write a public chapter summary before closing it." };
  if (arc) commitStoryArc(campaign.id, arc);
  if (args.scene !== undefined) setCampaignScene(campaign.id, args.scene);
  if (args.quests !== undefined) setQuestLog(campaign.id, args.quests);
  if (chapter) {
    const updated = updateChapter(chapter.id, {
      title: args.chapterTitle, summary: args.chapterSummary, highlights: args.chapterHighlights,
    })!;
    const activeArc = arc ?? campaign.storyArc;
    const act = activeArc ? currentAct(activeArc) : null;
    const saga = activeArc ? sagaIndexOf(activeArc) : null;
    if (args.closeChapter) {
      const seqEnd = latestSeq(campaign.id);
      const closed = closeChapterRow(updated.id, { ...updated, seqEnd, act, saga })!;
      const opened = setChapterAct(closed.opened.id, act, saga)!;
      publishPersisted(campaign.id, "chapter_closed", { chapter: closed.closed, opened });
      captureBoundarySnapshot(campaign.id, opened.index, seqEnd);
    } else {
      const stamped = setChapterAct(updated.id, act, saga)!;
      publishPersisted(campaign.id, "chapter_updated", { chapter: stamped });
    }
  }
  // Only the fact of an update reaches the public event stream, never DM plans.
  if (args.scene !== undefined || args.quests !== undefined) {
    publishPersisted(campaign.id, "campaign_updated", {
      ...(args.scene === undefined ? {} : { scene: args.scene }),
      ...(args.quests === undefined ? {} : { questLog: args.quests }),
    });
  }
  publishPersisted(campaign.id, "mcp_control", { action: "story_updated" });
  return { ok: true, arcUpdated: Boolean(arc), chapterUpdated: Boolean(chapter), chapterClosed: Boolean(args.closeChapter) };
}

export function handleCompleteBeat(
  campaignId: string,
  rawArguments: string,
  alreadyCompleted: boolean,
): { result: Record<string, unknown>; completed: boolean } {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc) return { result: { error: "This campaign has no story arc yet." }, completed: false };
  if (alreadyCompleted) return { result: { error: "A beat was already completed this turn; let the story breathe." }, completed: false };
  let args: { beat?: unknown; actTitle?: unknown; actRecap?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { result: { error: "Invalid arguments." }, completed: false }; }
  const active = activeBeatNumber(campaign.storyArc);
  const requested = Number(args.beat);
  const beatNumber = Number.isInteger(requested) && requested >= 1 ? requested : active;
  if (beatNumber === null) return { result: { error: "Every beat of the arc is already finished." }, completed: false };
  // The checklist is the gate: a beat whose place, person, item or fight
  // steps are still open is refused with the steps named, so a beat cannot
  // land in the reply that merely reaches its door.
  const gate = gatingWaypoints(campaign.storyArc.beats[beatNumber - 1]).map((waypoint) => waypoint.text);
  if (gate.length) {
    return {
      result: {
        error: `Beat ${beatNumber} still has open waypoints: ${gate.join("; ")}. Steer the party through them first. They tick from your own tools when they happen, matched by name: move_party when the party arrives somewhere, set_npc / npc_reaction / social_check when it meets someone, grant_item or a purchase when it gains a thing, and a won fight against the named foe. The party lead can also tick a step by hand in the arc card.`,
        openWaypoints: gate,
      },
      completed: false,
    };
  }
  const advanced = completeBeat(campaign.storyArc, beatNumber);
  if (!advanced) return { result: { error: `Beat ${beatNumber} is not an open beat.`, ...(active === null ? {} : { activeBeat: active }) }, completed: false };
  commitStoryArc(campaignId, advanced.arc, {
    title: typeof args.actTitle === "string" ? args.actTitle : "",
    recap: typeof args.actRecap === "string" ? args.actRecap : "",
  });
  const nextActive = activeBeatNumber(advanced.arc);
  return {
    result: {
      ok: true, completedBeat: beatNumber,
      ...(nextActive === null
        ? { note: nextSketchAct(advanced.arc) ? "That act is complete and was announced to the table; the next act must be authored externally." : "That was the final authored beat." }
        : { nextBeat: advanced.arc.beats[nextActive - 1].text }),
    },
    completed: true,
  };
}

// ---- Acts, as the table hears them (upstream issue #31) ----

// Every arc edit that can move the story lands here: complete_beat, the MCP
// set_arc and the lead's beat edits. The players never saw acts change while
// the act structure lived only in the secret arc; now an act that ends gets
// an "End of Act" card and a spoiler-free recap in the log, the next act
// gets its own card once it has beats, and the open chapter learns which act
// it is in. `recap` is the author's title and recap for an act this edit
// ends (complete_beat's actTitle/actRecap); without one, a recap the new arc
// carries, then the act's chapter highlights, stand in. Returns the arc as
// stored.
export function commitStoryArc(
  campaignId: string,
  after: StoryArc,
  recap: { title?: string; recap?: string } = {},
): StoryArc {
  const campaign = getCampaignById(campaignId);
  const before = campaign?.storyArc ?? null;
  // set_arc replaces the whole arc, but the recaps are the table's record,
  // not part of the plan an author resends: keep the ones it left out.
  const announced = before?.actRecaps ?? [];
  let next: StoryArc = {
    ...after,
    actRecaps: [
      ...announced.filter((old) => !after.actRecaps.some((entry) => entry.act === old.act && entry.sagaIndex === old.sagaIndex)),
      ...after.actRecaps,
    ],
  };
  const ru = campaign?.gameSettings.language !== "en";
  if (before) {
    // Whether an act ended is judged against what the table was already
    // told, so an author who sends a recap with the edit still gets the card.
    const transition = actTransition(before, { ...next, actRecaps: announced });
    if (transition.ended) {
      const ended = transition.ended;
      const authored = actRecapFor(next, ended.act, ended.sagaIndex);
      const title = (recap.title?.trim() || authored?.title || ended.title).slice(0, 60);
      const text = recap.recap?.trim() || authored?.recap || ended.resolution || chapterRecap(campaignId, ended.act, ended.sagaIndex);
      next = recordActRecap(next, { act: ended.act, sagaIndex: ended.sagaIndex, title, recap: text });
      publishEphemeral(campaignId, "act_card", { id: crypto.randomUUID(), kind: "end", act: ended.act, title });
      const numeral = romanNumeral(ended.act);
      noteAtTable(
        campaignId,
        ru
          ? `Акт ${numeral}${title ? ` «${title}»` : ""} подходит к концу${ended.sagaEnded && ended.sagaTitle ? `, а вместе с ним и сага «${ended.sagaTitle}»` : ""}.${text ? ` ${text}` : ""}`
          : `Act ${numeral}${title ? `, "${title}",` : ""} comes to a close${ended.sagaEnded && ended.sagaTitle ? `, and with it the saga of "${ended.sagaTitle}"` : ""}.${text ? ` ${text}` : ""}`,
      );
    }
    if (transition.began) {
      const began = transition.began;
      const saga = began.act === 1 ? began.sagaTitle : "";
      publishEphemeral(campaignId, "act_card", { id: crypto.randomUUID(), kind: "begin", act: began.act, title: began.title });
      const numeral = romanNumeral(began.act);
      noteAtTable(
        campaignId,
        ru
          ? `Начинается акт ${numeral}${began.title ? ` «${began.title}»` : ""}${saga ? `: сага «${saga}»` : ""}.`
          : `Act ${numeral}${began.title ? `, "${began.title}",` : ""} begins${saga ? `: the saga of "${saga}"` : ""}.`,
      );
    }
  }
  setStoryArc(campaignId, next);
  const open = getOpenChapter(campaignId);
  const act = currentAct(next);
  const sagaIndex = sagaIndexOf(next);
  if (open && (open.act !== act || open.saga !== sagaIndex)) {
    const stamped = setChapterAct(open.id, act, sagaIndex);
    if (stamped) publishPersisted(campaignId, "chapter_updated", { chapter: stamped });
  }
  return next;
}

// No author recap: the act's own chapter highlights, or the last few closed
// chapters' when the act's chapters were sealed before acts were stamped.
function chapterRecap(campaignId: string, act: number, sagaIndex: number): string {
  const closed = listChapters(campaignId).filter((chapter) => chapter.status === "closed");
  const own = closed.filter((chapter) => chapter.act === act && (chapter.saga ?? 1) === sagaIndex);
  return (own.length ? own : closed.slice(-6))
    .map((chapter) => chapter.highlights[0])
    .filter(Boolean)
    .slice(-4)
    .join(" ");
}

function noteAtTable(campaignId: string, content: string) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
