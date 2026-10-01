import { getCampaignById, listMembers, type Campaign } from "@/lib/db/campaigns";
import { listChapters, type Chapter } from "@/lib/db/chapters";
import { actRecapFor, actTitle, romanNumeral, sagaIndexOf } from "@/lib/dm/arc-logic";
import { listAllMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { isOocMessage } from "@/lib/campaign-types";

// A serializer-independent view of a campaign's story, gathered once from the
// database and then handed to the HTML/ODT/DOCX renderers. Player-safe by
// construction: it never reads the DM outline, story arc, or private notes.

export type TranscriptLine = {
  speaker: string;
  kind: "dm" | "player";
  text: string;
};

export type StoryChapter = {
  index: number;
  // Set on the first chapter of each act: "Act II: The Drowned Road" and the
  // spoiler-free recap recorded when that act ended, so the document carries
  // the saga's shape, not a flat run of chapters.
  actHeading?: string;
  actRecap?: string;
  // Full heading text, e.g. "Chapter 1: The Sunless Road" or the in-progress
  // label for the open chapter.
  heading: string;
  status: "open" | "closed";
  summary: string;
  highlights: string[];
  transcript: TranscriptLine[];
};

export type StoryDocument = {
  title: string;
  premise: string;
  meta: {
    theme: string;
    difficulty: string;
    startingLevel: number;
    status: string;
    exportedAt: string;
  };
  questLog: string[];
  chapters: StoryChapter[];
};

// Reads every player-safe narrative source for a campaign and folds it into a
// StoryDocument. The caller is responsible for membership authorization.
export function buildStoryDocument(campaignId: string): StoryDocument | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }

  const chapters = listChapters(campaignId);
  const messages = listAllMessages(campaignId);

  // Name resolution for transcript attribution.
  const memberNames = new Map(listMembers(campaignId).map((m) => [m.userId, m.username]));
  const sheetNames = new Map(listSheets(campaignId).map((s) => [s.id, s.name]));

  const acts = actHeadings(campaign, chapters);
  const storyChapters: StoryChapter[] = chapters.map((chapter) => {
    const seqEnd = chapter.seqEnd ?? Number.MAX_SAFE_INTEGER;
    const transcript: TranscriptLine[] = messages
      .filter(
        (message) =>
          message.seq >= chapter.seqStart &&
          message.seq <= seqEnd &&
          message.authorType !== "system" &&
          !isOocMessage(message) &&
          message.content.trim().length > 0,
      )
      .map((message) => ({
        kind: message.authorType === "dm" ? "dm" : "player",
        speaker:
          message.authorType === "dm"
            ? "Dungeon Master"
            : (message.characterId && sheetNames.get(message.characterId)) ||
              (message.userId && memberNames.get(message.userId)) ||
              "Adventurer",
        text: message.content.trim(),
      }));

    const title = chapter.title?.trim();
    const heading =
      chapter.status === "open"
        ? `Chapter ${chapter.index} (in progress)`
        : `Chapter ${chapter.index}: ${title || "Untitled"}`;

    return {
      index: chapter.index,
      ...acts.get(chapter.id),
      heading,
      status: chapter.status,
      summary: chapter.summary ?? "",
      highlights: chapter.highlights ?? [],
      transcript,
    };
  });

  return {
    title: campaign.title,
    premise: campaign.description ?? "",
    meta: {
      theme: campaign.theme ?? "",
      difficulty: campaign.difficulty,
      startingLevel: campaign.startingLevel,
      status: campaign.status,
      exportedAt: new Date().toISOString(),
    },
    questLog: campaign.questLog ?? [],
    chapters: storyChapters,
  };
}

// The act heading for the first chapter of each act, keyed by chapter id.
// Player-safe: the names the table was shown and the recaps it heard, never
// the DM's milestones. The word follows the table's language.
export function actHeadings(
  campaign: Campaign,
  chapters: Chapter[],
): Map<string, { actHeading: string; actRecap?: string }> {
  const arc = campaign.storyArc;
  const word = campaign.gameSettings.language === "en" ? "Act" : "Акт";
  const out = new Map<string, { actHeading: string; actRecap?: string }>();
  let lastKey = "";
  for (const chapter of chapters) {
    const act = chapter.act;
    const saga = chapter.saga ?? 1;
    if (!act || `${saga}:${act}` === lastKey) {
      continue;
    }
    lastKey = `${saga}:${act}`;
    const recap = arc ? actRecapFor(arc, act, saga) : null;
    const title = recap?.title || (arc && saga === sagaIndexOf(arc) ? actTitle(arc, act) : "");
    out.set(chapter.id, {
      actHeading: `${word} ${romanNumeral(act)}${title ? `: ${title}` : ""}`,
      ...(recap?.recap ? { actRecap: recap.recap } : {}),
    });
  }
  return out;
}

// A url/filename-safe slug of the campaign title.
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "campaign"
  );
}

export function exportFilename(doc: StoryDocument, ext: "html" | "odt" | "docx"): string {
  return `${slugify(doc.title)}-story.${ext}`;
}

// Escapes text for insertion into HTML or XML text/attribute nodes. ODF and
// OOXML are both XML, so the same five-entity escape serves all three formats.
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
