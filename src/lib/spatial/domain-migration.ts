import { getDatabase } from '@/lib/db/core';
import * as notes from '@/lib/db/notes-store';
import * as facts from '@/lib/db/facts-store';
import * as chapters from '@/lib/db/chapters-store';
import { publishEntity } from '@/lib/spatial/domain';
import { listSheets } from '@/lib/db/sheets';
import type { PublicationScope } from '@/lib/spatial/publication-scope.mjs';

// Called ONLY in the transaction that first enables location mode. It takes
// immutable copies while the legacy visibility rules are still unambiguous.
// Existing spatial campaigns are NOT retroactively migrated from timestamps:
// those rows may already contain unseen edits and require explicit disclosure.
export function capturePreSpatialEntities(campaignId: string) {
  const db = getDatabase();
  for (const row of db.prepare('SELECT id FROM campaign_notes WHERE campaign_id=?').all(campaignId) as { id: string }[]) {
    const value = notes.getNoteById(row.id);
    if (value) publishEntity('note', value, { scope: value.visibility === 'public' ? { kind: 'global' } : { kind: 'dm' } });
  }
  const sheets = listSheets(campaignId);
  for (const row of db.prepare('SELECT id FROM world_facts WHERE campaign_id=?').all(campaignId) as { id: string }[]) {
    const value = facts.getFactById(row.id);
    if (!value) continue;
    const known = value.knownBy;
    const scope: PublicationScope = known === 'party' ? { kind: 'global' } : known === 'dm' ? { kind: 'dm' }
      : { kind: 'users', userIds: [...new Set(sheets.filter(sheet => known.includes(sheet.id)).map(sheet => sheet.userId))] };
    publishEntity('fact', value, { scope });
  }
  for (const value of chapters.listChapters(campaignId)) publishEntity('chapter', value, { scope: { kind: 'global' } });
}
