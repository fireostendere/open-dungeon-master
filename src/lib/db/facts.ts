export * from '@/lib/db/facts-store';
import * as raw from '@/lib/db/facts-store';
import type { WorldFact } from '@/lib/db/facts-store';
import { getDatabase } from '@/lib/db/core';
import { getCampaignById } from '@/lib/db/campaigns';
import { listSheets } from '@/lib/db/sheets';
import { spatialEnabled } from '@/lib/spatial/service';
import { domainStore, publishEntity, visibleEntities } from '@/lib/spatial/domain';
import { currentPublicationScope, type PublicationScope } from '@/lib/spatial/publication-scope.mjs';

export function insertFact(input: Parameters<typeof raw.insertFact>[0] & { scope?: PublicationScope }): WorldFact {
  return getDatabase().transaction(() => {
    const { scope, ...data } = input;
    return publishEntity('fact', raw.insertFact(data), scope ? { scope } : {});
  })();
}
function mutate(work: () => WorldFact | null) {
  return getDatabase().transaction(() => { const result = work(); return result ? publishEntity('fact', result) : null; })();
}
export function setFactPinned(...args: Parameters<typeof raw.setFactPinned>) { return mutate(() => raw.setFactPinned(...args)); }
export function setFactStatus(...args: Parameters<typeof raw.setFactStatus>) { return mutate(() => raw.setFactStatus(...args)); }
export function updateFactText(...args: Parameters<typeof raw.updateFactText>) { return mutate(() => raw.updateFactText(...args)); }
export function recordExtractedFacts(...args: Parameters<typeof raw.recordExtractedFacts>): WorldFact[] {
  return getDatabase().transaction(() => {
    const before = (getDatabase().prepare('SELECT id FROM world_facts WHERE campaign_id=?').all(args[0]) as { id: string }[])
      .map(({ id }) => raw.getFactById(id)).filter((value): value is WorldFact => value !== null);
    const result = raw.recordExtractedFacts(...args);
    // raw.recordExtractedFacts invokes local SQL helpers. Capture both new
    // facts AND rows superseded by that batch, not just its return value.
    const ids = new Set([...before, ...result].map(fact => fact.id));
    for (const id of ids) {
      const fact = raw.getFactById(id);
      if (fact && JSON.stringify(before.find(value => value.id === id)) !== JSON.stringify(fact)) {
        publishEntity('fact', fact, { scope: currentPublicationScope(args[0]) ?? { kind: 'dm' } });
      }
    }
    return result;
  })();
}
export function registerUnversionedFacts(campaignId: string) {
  if (!spatialEnabled(campaignId)) return;
  const store = domainStore();
  const ids = getDatabase().prepare('SELECT id FROM world_facts WHERE campaign_id=?').all(campaignId) as { id: string }[];
  for (const { id } of ids) if (!store.has(campaignId, 'fact', id)) {
    const value = raw.getFactById(id);
    // Existing private knowledge can be retained; an old source_seq is not
    // permission to expose text edited after location mode was enabled.
    if (value) publishEntity('fact', value, { scope: { kind: 'dm' } });
  }
}
export function listFactsVisibleTo(campaignId: string, ownedCharacterIds: string[], includeDmSecrets: boolean, viewerUserId?: string): WorldFact[] {
  if (!spatialEnabled(campaignId)) return raw.listFactsVisibleTo(campaignId, ownedCharacterIds, includeDmSecrets);
  registerUnversionedFacts(campaignId);
  const owners = [...new Set(listSheets(campaignId).filter(sheet => ownedCharacterIds.includes(sheet.id)).map(sheet => sheet.userId))];
  const userId = viewerUserId ?? (includeDmSecrets ? getCampaignById(campaignId)?.dmUserId : owners.length === 1 ? owners[0] : undefined);
  if (!userId) return [];
  return visibleEntities<WorldFact>(campaignId, userId, 'fact', { limit: 1000 })
    .filter(fact => fact.status === 'active' && (includeDmSecrets || fact.knownBy !== 'dm'));
}
