export * from '@/lib/db/chapters-store';
import * as raw from '@/lib/db/chapters-store';
import type { Chapter } from '@/lib/db/chapters-store';
import { getDatabase } from '@/lib/db/core';
import { spatialEnabled } from '@/lib/spatial/service';
import { domainStore, publishEntity, visibleEntities } from '@/lib/spatial/domain';

export function ensureOpenChapter(campaignId: string): Chapter {
  return getDatabase().transaction(() => publishEntity('chapter', raw.ensureOpenChapter(campaignId)))();
}
export function closeChapterRow(...args: Parameters<typeof raw.closeChapterRow>) {
  return getDatabase().transaction(() => {
    const result = raw.closeChapterRow(...args);
    if (result) { publishEntity('chapter', result.closed); publishEntity('chapter', result.opened); }
    return result;
  })();
}
export function setChapterAct(...args: Parameters<typeof raw.setChapterAct>) {
  return getDatabase().transaction(() => {
    const result = raw.setChapterAct(...args);
    return result ? publishEntity('chapter', result) : null;
  })();
}
export function updateChapter(...args: Parameters<typeof raw.updateChapter>) {
  return getDatabase().transaction(() => {
    const result = raw.updateChapter(...args);
    return result ? publishEntity('chapter', result) : null;
  })();
}
export function listChaptersVisibleTo(campaignId: string, userId: string): Chapter[] {
  if (!spatialEnabled(campaignId)) return raw.listChapters(campaignId);
  const store = domainStore();
  for (const value of raw.listChapters(campaignId)) if (!store.has(campaignId, 'chapter', value.id)) {
    publishEntity('chapter', value, { scope: { kind: 'dm' } });
  }
  return visibleEntities<Chapter>(campaignId, userId, 'chapter', { limit: 1000 }).sort((a, b) => a.index - b.index);
}
