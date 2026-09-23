import { parsePlayerMessage } from '@/lib/player-message';
import { getDatabase } from '@/lib/db/core';
import { capsFor, getCampaignById, listMembers } from '@/lib/db/campaigns';
import { getCampaignMessage } from '@/lib/db/messages';
import { getSheetForUser } from '@/lib/db/sheets';
import { campaignEventProjector } from '@/lib/spatial/event-policy';
import { actionFingerprint, createActionOutbox, feedConfig, visibleToWholeParty,
  type ActionKind, type ActionSource, type FeedEvent, type OutboxRecord } from './rakobot-outbox.mjs';

// No outbound network I/O, bot token or broad MCP credentials in the game.
// Read both canonical ledgers: spatial room chat deliberately bypasses events.ts.
function actionView(campaignId: string, source: ActionSource, messageId: string, kind: ActionKind) {
  const db = getDatabase();
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.kind !== 'campaign') return null;
  const members = listMembers(campaignId);
  const memberIds = members.map(member => member.userId);
  let userId: string | null = null, content = '', publicToParty = false;
  if (source === 'legacy') {
    const message = getCampaignMessage(messageId);
    if (!message || message.campaignId !== campaignId || message.authorType !== 'player' || !message.userId) return null;
    userId = message.userId; content = message.content;
    const saved = db.prepare('SELECT type,payload_json FROM campaign_events WHERE campaign_id=? AND seq=?')
      .get(campaignId, message.seq) as { type: string; payload_json: string } | undefined;
    if (!saved || saved.type !== 'message_added') return null;
    const payload = JSON.parse(saved.payload_json) as { message?: { id?: string; content?: string } };
    if (payload.message?.id !== messageId || payload.message.content !== content) return null;
    const recipients = memberIds.filter(id => {
      const view = campaignEventProjector(campaignId, id).projectEvent({ seq: message.seq, type: saved.type, payload });
      const projected = view.payload as { message?: { id?: string; content?: string } } | null;
      return view.type === 'message_added' && projected?.message?.id === messageId && projected.message.content === content;
    });
    publicToParty = visibleToWholeParty(memberIds, recipients);
  } else {
    const message = db.prepare('SELECT * FROM spatial_messages WHERE campaign_id=? AND id=?')
      .get(campaignId, messageId) as { kind: string; author_user_id: string | null; content: string; stealth: number; stealth_status: string } | undefined;
    if (!message || message.kind !== kind || !message.author_user_id) return null;
    userId = message.author_user_id; content = message.content;
    const receipts = db.prepare('SELECT user_id FROM spatial_receipts WHERE campaign_id=? AND message_id=?')
      .all(campaignId, messageId) as { user_id: string }[];
    // DM seats can read every room without a receipt. Require every player
    // receipt, not a nonexistent DM receipt; spectators still count as players.
    const playerIds = memberIds.filter(id => capsFor(campaign, id).role !== 'dm');
    publicToParty = visibleToWholeParty(playerIds, receipts.map(row => row.user_id), message.stealth !== 0 || message.stealth_status !== 'none');
  }
  const member = members.find(member => member.userId === userId);
  if (!member || capsFor(campaign, userId).role === 'dm') return null;
  const sheet = getSheetForUser(campaignId, userId);
  if (!sheet) return null;
  return { publicToParty, fingerprint: actionFingerprint(userId, content), event: {
    campaignId, campaignTitle: campaign.title, messageId, playerName: member.username,
    characterName: sheet.name, kind, quote: content,
  } satisfies FeedEvent };
}

/** Must run inside the same transaction as the accepted message. */
export function queuePlayerAction(campaignId: string, source: ActionSource, messageId: string, kind: string): void {
  let config: ReturnType<typeof feedConfig>;
  try { config = feedConfig(); } catch { return; } // Misconfiguration disables export, not the game.
  if (!config?.campaigns.has(campaignId) || (kind !== 'do' && kind !== 'say')) return;
  const view = actionView(campaignId, source, messageId, kind);
  if (!view) return;
  // Keep a denied tombstone too: retries/membership changes cannot retroactively
  // turn a private action into an exportable one.
  createActionOutbox(getDatabase()).enqueue({ campaignId, source, messageId, kind,
    publicAtCreation: view.publicToParty, fingerprint: view.fingerprint });
}

export function projectQueuedAction(row: OutboxRecord, campaigns: Set<string>): FeedEvent | null {
  if (!campaigns.has(row.campaign_id)) return null;
  const view = actionView(row.campaign_id, row.source, row.message_id, row.kind);
  // Recheck before delivery: deleted, edited, rewound or now-restricted actions
  // are skipped. The original text is not retained in a second plaintext queue.
  return view?.publicToParty && view.fingerprint === row.fingerprint ? view.event : null;
}

/** Legacy writes all publish message_added, including narrator autopilot actions.
 * Use the same Do/Say/OOC interpretation as the existing transcript UI. */
export function queueLegacyPlayerEvent(campaignId: string, type: string, payload: unknown): void {
  if (type !== 'message_added' || !payload || typeof payload !== 'object') return;
  const message = (payload as { message?: { id?: unknown; content?: unknown; authorType?: unknown } }).message;
  if (!message || message.authorType !== 'player' || typeof message.id !== 'string' || typeof message.content !== 'string') return;
  queuePlayerAction(campaignId, 'legacy', message.id, parsePlayerMessage(message.content).kind);
}
