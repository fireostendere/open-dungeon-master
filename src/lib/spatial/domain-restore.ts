import { getDatabase } from '@/lib/db/core';

// The old rewind layer deleted notes by creation sequence but did not undo
// edits or restore deleted notes. Rehydrate their canonical rows from the same
// restored ledger versions used by player reads. Called inside restoreSnapshot.
export function restoreCanonicalDomainRows(campaignId: string) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT v.* FROM spatial_object_versions v WHERE v.campaign_id=?
    AND v.object_type IN ('domain:note','domain:chapter') AND v.version=(SELECT MAX(w.version)
      FROM spatial_object_versions w WHERE w.campaign_id=v.campaign_id AND w.object_type=v.object_type AND w.object_id=v.object_id)`)
    .all(campaignId) as { object_type: string; payload_json: string }[];
  for (const row of rows) {
    const envelope = JSON.parse(row.payload_json) as { format?: string; deleted?: boolean; data?: Record<string, unknown> };
    const data = envelope.data;
    if (envelope.format !== 'odm.domain.v1' || !data || data.campaignId !== campaignId || typeof data.id !== 'string') throw new Error('Invalid domain snapshot.');
    const isNote = row.object_type === 'domain:note';
    const table = isNote ? 'campaign_notes' : 'chapters';
    if (envelope.deleted) { db.prepare(`DELETE FROM ${table} WHERE campaign_id=? AND id=?`).run(campaignId, data.id); continue; }
    if (isNote && !db.prepare('SELECT 1 FROM users WHERE id=?').get(data.authorUserId)) continue;
    const values = isNote ? {
      id: data.id, campaign_id: campaignId, character_id: data.characterId, author_user_id: data.authorUserId,
      author_kind: data.authorKind, visibility: data.visibility, status: data.status, pinned: Number(data.pinned),
      title: data.title, body: data.body, seq: data.seq, created_at: data.createdAt, updated_at: data.updatedAt, embedding: null,
    } : {
      id: data.id, campaign_id: campaignId, chapter_index: data.index, title: data.title, summary: data.summary,
      highlights_json: JSON.stringify(data.highlights ?? []), seq_start: data.seqStart, seq_end: data.seqEnd,
      status: data.status, created_at: data.createdAt, updated_at: data.updatedAt, embedding: null,
    };
    const columns = Object.keys(values);
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${columns.filter(key => key !== 'id').map(key => `${key}=excluded.${key}`).join(',')}`)
      .run(...Object.values(values).map(value => value ?? null));
  }
}
