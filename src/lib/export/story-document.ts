export * from '@/lib/export/legacy-story-document';
import * as legacy from '@/lib/export/legacy-story-document';
import type { StoryDocument, StoryChapter, TranscriptLine } from '@/lib/export/legacy-story-document';
import { actHeadings } from '@/lib/export/legacy-story-document';
import { getCampaignById, listMembers } from '@/lib/db/campaigns';
import { listAllMessages } from '@/lib/db/messages';
import { listChaptersVisibleTo } from '@/lib/db/chapters';
import { spatialContext, spatialEnabled, spatialStore } from '@/lib/spatial/service';
import { DomainError } from '@/lib/spatial/domain';

export function buildStoryDocument(campaignId: string, viewerUserId?: string): StoryDocument | null {
  if (!spatialEnabled(campaignId)) return legacy.buildStoryDocument(campaignId);
  if (!viewerUserId) throw new DomainError('An authenticated viewer is required for a spatial export.', 403);
  const campaign = getCampaignById(campaignId);
  if (!campaign) return null;
  const { actor } = spatialContext(campaignId, viewerUserId);
  const store = spatialStore(); const view = store.view(actor);
  if (!view.enabled) throw new DomainError('Location mode changed. Retry the export.', 409);
  const names = new Map(listMembers(campaignId).map(member => [member.userId, member.username]));
  const oldMessages = listAllMessages(campaignId).filter(message => message.seq < view.startSeq);
  const visible = listChaptersVisibleTo(campaignId, viewerUserId);
  const acts = actHeadings(campaign, visible);
  const chapters: StoryChapter[] = visible.map((chapter, index) => ({
    index: index + 1,
    ...acts.get(chapter.id),
    heading: chapter.title || `Chapter ${chapter.index}`,
    status: chapter.status,
    summary: chapter.summary,
    highlights: chapter.highlights,
    transcript: oldMessages.filter(message => message.seq >= chapter.seqStart && message.seq <= (chapter.seqEnd ?? view.startSeq - 1)
      && message.authorType !== 'system' && !/^\s*\(ooc\)/i.test(message.content)).map(message => ({
      kind: message.authorType === 'dm' ? 'dm' : 'player',
      speaker: message.authorType === 'dm' ? 'Dungeon Master' : names.get(message.userId ?? '') ?? 'Adventurer',
      text: message.content,
    })),
  }));
  let total = 0;
  for (const room of view.rooms) {
    const transcript: TranscriptLine[] = [];
    let beforeSeq: number | undefined;
    do {
      const page = store.messages(actor, { roomId: room.id, beforeSeq, limit: 100 });
      transcript.unshift(...page.messages.map(message => ({
        kind: message.kind === 'say' || message.kind === 'do' ? 'player' as const : 'dm' as const,
        speaker: message.kind === 'say' || message.kind === 'do' ? names.get(message.authorUserId ?? '') ?? 'Adventurer' : 'Dungeon Master',
        text: message.content,
      })));
      total += page.messages.length;
      if (total > 15000) throw new DomainError('Export exceeds the message budget. Export a smaller campaign archive.', 413);
      beforeSeq = page.nextBefore ?? undefined;
    } while (beforeSeq !== undefined);
    if (transcript.length) chapters.push({ index: chapters.length + 1, heading: room.name, status: 'open', summary: '', highlights: [], transcript });
  }
  const doc: StoryDocument = {
    title: campaign.title, premise: campaign.description ?? '',
    meta: { theme: campaign.theme ?? '', difficulty: campaign.difficulty, startingLevel: campaign.startingLevel,
      status: campaign.status, exportedAt: new Date().toISOString() },
    questLog: actor.isDm ? campaign.questLog : [], chapters,
  };
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > 16 * 1024 * 1024) throw new DomainError('Export exceeds the size budget.', 413);
  return doc;
}
