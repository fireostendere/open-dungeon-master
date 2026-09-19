/** A narrow proof, not a general bypass of campaign CAS. Only ordinary speech
 * or OOC in other rooms may be ignored. Every intervening sequence must be
 * accounted for; movement, dice, actions, stealth, command receipts, unknown
 * gaps and anything perceived by the destination audience force a fresh read.
 * Call inside the same synchronous transaction as the narrator write.
 */
export function unrelatedRoomChat(db, { campaignId, dmUserId, roomId, afterSeq, currentSeq, now = new Date().toISOString() }) {
  if (![afterSeq, currentSeq].every(Number.isSafeInteger) || afterSeq < 0 || currentSeq <= afterSeq || currentSeq - afterSeq > 100) return false;
  if (!db.prepare('SELECT 1 FROM spatial_rooms WHERE campaign_id=? AND id=?').get(campaignId, roomId)) return false;
  const rows = db.prepare('SELECT id,seq,room_id,kind,stealth FROM spatial_messages WHERE campaign_id=? AND seq>? AND seq<=? ORDER BY seq')
    .all(campaignId, afterSeq, currentSeq);
  if (rows.length !== currentSeq - afterSeq) return false;
  const audience = new Set(db.prepare('SELECT user_id FROM spatial_presence WHERE campaign_id=? AND room_id=?')
    .all(campaignId, roomId).map(row => row.user_id));
  for (const row of db.prepare("SELECT user_id FROM spatial_observers WHERE campaign_id=? AND source_id=? AND mode='scry' AND expires_at>?").all(campaignId, roomId, now)) audience.add(row.user_id);
  audience.delete(dmUserId);
  for (const [index, row] of rows.entries()) {
    if (row.seq !== afterSeq + index + 1 || row.stealth) return false;
    if (row.kind === 'ooc' && row.room_id === null) continue;
    if (row.kind !== 'say' || !row.room_id || row.room_id === roomId) return false;
    const witnesses = db.prepare('SELECT user_id FROM spatial_receipts WHERE campaign_id=? AND message_id=?').all(campaignId, row.id);
    if (witnesses.some(witness => audience.has(witness.user_id))) return false;
  }
  return true;
}
