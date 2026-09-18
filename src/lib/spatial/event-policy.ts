import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabase } from '@/lib/db/core';
import { capsFor, getCampaignById, listMembers } from '@/lib/db/campaigns';
import { createEventAccess, decodeEventChunk, ephemeralView, type EventActor, type EventScope, type EventView } from './event-access.mjs';

const scopes = new AsyncLocalStorage<{ campaignId: string; scope: EventScope }>();
// Trusted writer scope; requests must resolve authorization before entering it.
export function withEventScope<T>(campaignId: string, scope: EventScope, work: () => T): T {
  return scopes.run({ campaignId, scope }, work);
}
function enabledState(campaignId: string) {
  const db = getDatabase();
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_campaigns'").get();
  if (!exists) return { enabled: false, startSeq: 0 };
  const row = db.prepare('SELECT start_seq FROM spatial_campaigns WHERE campaign_id=?').get(campaignId) as { start_seq: number } | undefined;
  return { enabled: Boolean(row), startSeq: row?.start_seq ?? 0 };
}
function actorFor(campaignId: string, userId: string, enabled: boolean): EventActor {
  const campaign = getCampaignById(campaignId);
  const member = Boolean(campaign && listMembers(campaignId).some(item => item.userId === userId));
  const db = getDatabase();
  const sheets = member ? db.prepare('SELECT id FROM character_sheets WHERE campaign_id=? AND user_id=?').all(campaignId, userId) as { id: string }[] : [];
  const presence = enabled && member ? db.prepare('SELECT room_id FROM spatial_presence WHERE campaign_id=? AND user_id=?').get(campaignId, userId) as { room_id: string } | undefined : undefined;
  return { userId, member, isDm: member && Boolean(campaign && capsFor(campaign, userId).role === 'dm'),
    ownedCharacterIds: sheets.map(sheet => sheet.id), roomId: presence?.room_id ?? null };
}
export function captureEventAudience(campaignId: string, event: EventView, explicit?: EventScope) {
  const state = enabledState(campaignId);
  if (!state.enabled) return;
  const actors = listMembers(campaignId).map(member => actorFor(campaignId, member.userId, true));
  const inherited = scopes.getStore();
  const scope = explicit ?? (inherited?.campaignId === campaignId ? inherited.scope : undefined);
  createEventAccess(getDatabase()).capture(campaignId, event, actors, scope);
}
function eventInCurrentTimeline(campaignId: string, event: EventView) {
  const row = getDatabase().prepare('SELECT type,payload_json FROM campaign_events WHERE campaign_id=? AND seq=?')
    .get(campaignId, event.seq) as { type: string; payload_json: string } | undefined;
  return row?.type === event.type && row.payload_json === JSON.stringify(event.payload);
}
export function campaignEventProjector(campaignId: string, userId: string) {
  const fresh = () => { const state = enabledState(campaignId); return { state, actor: actorFor(campaignId, userId, state.enabled) }; };
  return {
    assertAccess() { if (!fresh().actor.member) throw new Error('Campaign stream access revoked.'); },
    projectEvent(event: EventView) {
      const { state, actor } = fresh();
      if (!actor.member) throw new Error('Campaign stream access revoked.');
      if (!eventInCurrentTimeline(campaignId, event)) return { seq: event.seq, type: 'stream_checkpoint', payload: {} };
      if (!state.enabled) return event;
      return createEventAccess(getDatabase()).project(campaignId, event, actor, state);
    },
    projectLive(chunk: string) {
      const { state, actor } = fresh();
      if (!actor.member) throw new Error('Campaign stream access revoked.');
      const event = decodeEventChunk(chunk);
      if (!event) return chunk;
      let result: { seq?: number; type: string; payload: unknown } | null;
      if (event.seq !== undefined) {
        // Rewind/cursor-ahead is transport control, not a story disclosure.
        if (event.type === 'campaign_rewound') result = { seq: event.seq, type: event.type, payload: { reason: 'campaign_rewound' } };
        else if (!eventInCurrentTimeline(campaignId, event as EventView)) result = { seq: event.seq, type: 'stream_checkpoint', payload: {} };
        else result = !state.enabled ? event : createEventAccess(getDatabase()).project(campaignId, event as EventView, actor, state);
      } else result = ephemeralView(event.type, event.payload, actor, state.enabled);
      return result ? `${result.seq === undefined ? '' : `id: ${result.seq}\n`}event: ${result.type}\ndata: ${JSON.stringify(result.payload)}\n\n` : null;
    },
  };
}
