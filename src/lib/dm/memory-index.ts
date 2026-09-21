import { listChapters } from "@/lib/db/chapters";
import { listMessagesInSeqRange } from "@/lib/db/messages";
import { listNpcs } from "@/lib/db/npcs";
import { chunkScenes } from "@/lib/dm/scene-logic";
import { computeIdf, lexicalScore } from "@/lib/dm/fusion-logic";
import { detectWitnesses } from "@/lib/dm/witness-logic";

// Long-term recall without an embedding model. Closed chapters are selected
// lexically from title/summary, then their verbatim transcript is chunked and
// ranked with the same IDF-weighted lexical scorer.
export type RecalledScene = {
  chapterIndex: number;
  seqStart: number;
  seqEnd: number;
  text: string;
  similarity: number;
  witnesses: string[];
};

const CHAPTER_LIMIT = 3;
const SCENE_LIMIT = 3;

export async function searchScenes(
  campaignId: string,
  query: string,
): Promise<RecalledScene[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const closed = listChapters(campaignId).filter(
    (chapter) => chapter.status === "closed" && chapter.seqEnd !== null,
  );
  if (!closed.length) return [];

  const chapterTexts = closed.map((chapter) => `${chapter.title} ${chapter.summary}`);
  const chapterIdf = computeIdf(chapterTexts);
  const picked = closed
    .map((chapter, index) => ({
      chapter,
      score: lexicalScore(trimmed, chapterTexts[index], chapterIdf),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.chapter.index - a.chapter.index)
    .slice(0, CHAPTER_LIMIT);

  if (!picked.length) return [];

  const roster = listNpcs(campaignId).map((npc) => ({
    name: npc.name,
    aliases: npc.aliases,
  }));
  const candidates = picked.flatMap(({ chapter }) => {
    const messages = listMessagesInSeqRange(
      campaignId,
      chapter.seqStart,
      chapter.seqEnd!,
    );
    return chunkScenes(messages).map((scene) => ({
      chapterIndex: chapter.index,
      seqStart: scene.seqStart,
      seqEnd: scene.seqEnd,
      text: scene.text,
      witnesses: detectWitnesses(scene.text, roster),
    }));
  });
  if (!candidates.length) return [];

  const sceneIdf = computeIdf(candidates.map((scene) => scene.text));
  return candidates
    .map((scene) => ({
      ...scene,
      similarity: lexicalScore(trimmed, scene.text, sceneIdf),
    }))
    .filter((scene) => scene.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || b.seqEnd - a.seqEnd)
    .slice(0, SCENE_LIMIT);
}
