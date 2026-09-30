import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import type { GeneratedImage, ImageRequest } from "@/lib/types";
import { normalizeNarrationUnits } from "@/lib/units/narration";
import type { CombatTurnIntent } from "@/lib/dm/combat-turn-intent";

const NON_OOC = "lower(ltrim(content, char(9) || char(10) || char(13) || ' ')) NOT LIKE '(ooc)%'";

export type CampaignMessage = {
  id: string;
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId: string | null;
  characterId: string | null;
  content: string;
  combatTurn?: CombatTurnIntent;
  imageRequest?: ImageRequest;
  generatedImage?: GeneratedImage;
  narrationAudioUrl?: string;
  // Set on DM messages that moved the party somewhere new; the chat renders
  // that location's map inline (the map itself lives on the locations row).
  locationId?: string;
  // Narration rerolls: every prose variant of this message the lead has
  // generated, oldest first, with variants[0] the prose originally published.
  // Absent until the first reroll; content always mirrors the selected entry.
  variants?: string[];
  variantIndex?: number;
  // The dm_turns row this message came from, serving two features. On a DM
  // narration it is the turn a reroll replays the stored conversation of. On
  // the "DM ran into a problem" system notice it is the turn the lead can
  // retry, and it is cleared the moment a retry is claimed, which is what
  // makes the banner disappear for every client at once. Absent on messages
  // written before either feature existed.
  dmTurnId?: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  campaign_id: string;
  seq: number;
  author_type: "player" | "dm" | "system";
  user_id: string | null;
  character_id: string | null;
  content: string;
  combat_turn_json: string | null;
  image_request_json: string | null;
  generated_image_json: string | null;
  narration_audio_url: string | null;
  location_id: string | null;
  variants_json: string | null;
  variant_index: number | null;
  dm_turn_id: string | null;
  created_at: string;
};

function mapMessage(row: MessageRow): CampaignMessage {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    seq: row.seq,
    authorType: row.author_type,
    userId: row.user_id,
    characterId: row.character_id,
    content: row.content,
    combatTurn: parseJson<CombatTurnIntent | undefined>(row.combat_turn_json, undefined),
    imageRequest: parseJson<ImageRequest | undefined>(row.image_request_json, undefined),
    generatedImage: parseJson<GeneratedImage | undefined>(row.generated_image_json, undefined),
    narrationAudioUrl: row.narration_audio_url ?? undefined,
    locationId: row.location_id ?? undefined,
    variants: parseJson<string[] | undefined>(row.variants_json, undefined),
    variantIndex: row.variant_index ?? undefined,
    dmTurnId: row.dm_turn_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertCampaignMessage(input: {
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId?: string | null;
  characterId?: string | null;
  content: string;
  combatTurn?: CombatTurnIntent;
  imageRequest?: ImageRequest;
  locationId?: string;
  dmTurnId?: string;
}): CampaignMessage {
  const settings = getDatabase().prepare(`SELECT game_settings_json FROM campaigns WHERE id = ?`).get(input.campaignId) as { game_settings_json?: string } | undefined;
  const content = input.authorType === "dm" && parseJson<{ unitSystem?: string }>(settings?.game_settings_json, {}).unitSystem !== "imperial"
    ? normalizeNarrationUnits(input.content)
    : input.content;
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_messages (
          id, campaign_id, seq, author_type, user_id, character_id, content,
          combat_turn_json, image_request_json, location_id, dm_turn_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.seq,
      input.authorType,
      input.userId ?? null,
      input.characterId ?? null,
      content,
      input.combatTurn ? JSON.stringify(input.combatTurn) : null,
      input.imageRequest ? JSON.stringify(input.imageRequest) : null,
      input.locationId ?? null,
      input.dmTurnId ?? null,
      nowIso(),
    );
  touchCampaign(input.campaignId);

  const message = getCampaignMessage(id);
  if (!message) {
    throw new Error("Failed to insert campaign message.");
  }
  return message;
}

export function getCampaignMessage(messageId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE id = ?`)
    .get(messageId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

/**
 * Remove one visible transcript message without rewinding game mechanics.
 *
 * Pins and human-DM beat copies are derived from the message text, so keeping
 * them would make a deleted passage continue to influence narrator context.
 * Rolls and moderation reports intentionally survive: dice are game state and
 * reports are an audit record. The caller publishes message_deleted.
 */
export function deleteCampaignMessage(campaignId: string, messageId: string): CampaignMessage | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM campaign_messages WHERE id = ? AND campaign_id = ?`)
    .get(messageId, campaignId) as MessageRow | undefined;
  if (!row) return null;

  db.transaction(() => {
    db.prepare(`DELETE FROM campaign_pins WHERE campaign_id = ? AND message_id = ?`).run(campaignId, messageId);
    db.prepare(`DELETE FROM dm_beats WHERE campaign_id = ? AND message_id = ?`).run(campaignId, messageId);
    db.prepare(`UPDATE rolls SET message_id = NULL WHERE campaign_id = ? AND message_id = ?`).run(campaignId, messageId);
    const deleted = db
      .prepare(`DELETE FROM campaign_messages WHERE id = ? AND campaign_id = ?`)
      .run(messageId, campaignId);
    if (deleted.changes !== 1) throw new Error("Failed to delete campaign message.");
    touchCampaign(campaignId);
  })();

  return mapMessage(row);
}

// Messages inside a seq span (chapter transcripts), ascending.
export function listMessagesInSeqRange(
  campaignId: string,
  seqStart: number,
  seqEnd: number,
): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? AND seq >= ? AND seq <= ? AND ${NON_OOC} ORDER BY seq ASC`,
    )
    .all(campaignId, seqStart, seqEnd) as MessageRow[];
  return rows.map(mapMessage);
}

// How many messages exist at or below a seq (compaction watermark resets).
export function countMessagesUpToSeq(campaignId: string, seq: number): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ? AND seq <= ?`)
    .get(campaignId, seq) as { n: number };
  return row.n;
}

// The newest transcript row of any kind, OOC and system notices included.
export function latestMessage(campaignId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq DESC LIMIT 1`)
    .get(campaignId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Most recent `limit` messages in ascending seq order.
export function listRecentMessages(campaignId: string, limit = 100): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT * FROM campaign_messages WHERE campaign_id = ? AND ${NON_OOC} ORDER BY seq DESC LIMIT ?
        ) ORDER BY seq ASC
      `,
    )
    .all(campaignId, limit) as MessageRow[];
  return rows.map(mapMessage);
}

export function listMessagesBefore(campaignId: string, beforeSeq: number, limit = 100): CampaignMessage[] {
  const rows = getDatabase().prepare(`
    SELECT * FROM (
    SELECT * FROM campaign_messages WHERE campaign_id = ? AND seq < ? AND ${NON_OOC} ORDER BY seq DESC LIMIT ?
    ) ORDER BY seq ASC
  `).all(campaignId, beforeSeq, limit) as MessageRow[];
  return rows.map(mapMessage);
}

export function listAllMessages(campaignId: string): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? AND ${NON_OOC} ORDER BY seq ASC`)
    .all(campaignId) as MessageRow[];
  return rows.map(mapMessage);
}

// A window of the seq-ascending transcript: offset is an index into that
// ordering, matching the compaction engine's coveredCount semantics.
export function listMessagesPage(
  campaignId: string,
  offset: number,
  limit: number,
): CampaignMessage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?`,
    )
    .all(campaignId, limit, offset) as MessageRow[];
  return rows.map(mapMessage);
}

export function countMessages(campaignId: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM campaign_messages WHERE campaign_id = ?`)
    .get(campaignId) as { count: number };
  return row.count;
}

// Attaches an image request to a message already in the transcript. The AI
// path sets this at insert time, because its picture and its narration land
// together; a human DM narrates first and illustrates after, so the request
// has to be able to arrive later. The caller publishes message_updated.
export function setMessageImageRequest(messageId: string, request: ImageRequest) {
  const result = getDatabase()
    .prepare(`UPDATE campaign_messages SET image_request_json = ? WHERE id = ?`)
    .run(JSON.stringify(request), messageId);
  return result.changes > 0;
}

export function setMessageGeneratedImage(messageId: string, image: GeneratedImage) {
  const result = getDatabase()
    .prepare(`UPDATE campaign_messages SET generated_image_json = ? WHERE id = ?`)
    .run(JSON.stringify(image), messageId);
  return result.changes > 0;
}

export function setMessageNarrationAudioUrl(messageId: string, url: string | null) {
  const result = getDatabase()
    .prepare("UPDATE campaign_messages SET narration_audio_url = ? WHERE id = ?")
    .run(url, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

// Retry claim: drops a halted notice's link to its DM turn so the retry
// banner stops being offered. Conditional on the turn id, so it doubles as a
// second guard against two leads retrying the same turn (better-sqlite3 is
// synchronous, so only one caller can see changes > 0). The caller publishes
// message_updated.
export function clearMessageDmTurn(messageId: string, dmTurnId: string): CampaignMessage | null {
  const result = getDatabase()
    .prepare(`UPDATE campaign_messages SET dm_turn_id = NULL WHERE id = ? AND dm_turn_id = ?`)
    .run(messageId, dmTurnId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

// The halted notice pointing at a turn, if it is still offering a retry.
export function findMessageForDmTurn(dmTurnId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM campaign_messages WHERE dm_turn_id = ? ORDER BY seq DESC LIMIT 1`)
    .get(dmTurnId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Lore-check accept: replaces a message's text in place (the lead applying
// an approved consistency rewrite). The caller publishes message_updated.
export function updateMessageContent(messageId: string, content: string): CampaignMessage | null {
  const row = getDatabase().prepare(`SELECT author_type, campaign_id, game_settings_json FROM campaign_messages JOIN campaigns ON campaigns.id = campaign_messages.campaign_id WHERE campaign_messages.id = ?`).get(messageId) as { author_type: string; game_settings_json?: string } | undefined;
  const normalized = row?.author_type === "dm" && parseJson<{ unitSystem?: string }>(row.game_settings_json, {}).unitSystem !== "imperial" ? normalizeNarrationUnits(content) : content;
  const result = getDatabase()
    .prepare(
      // Clearing the reroll takes keeps content === variants[variant_index]:
      // an accepted rewrite supersedes every take, and browsing back to one
      // afterwards would silently undo the fix.
      `UPDATE campaign_messages SET content = ?, variants_json = NULL, variant_index = NULL WHERE id = ?`,
    )
    .run(normalized, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

// The newest DM narration in the campaign. Rerolls are offered on this
// message only: an older one has already been read, reacted to, and built on.
export function getLatestDmMessage(campaignId: string): CampaignMessage | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' ORDER BY seq DESC LIMIT 1`,
    )
    .get(campaignId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

// Narration reroll: stores the variant set and which one stands, keeping
// content in sync with the selection in one statement so no reader can see
// a message whose text disagrees with its own variant index.
export function setMessageVariants(
  messageId: string,
  variants: string[],
  index: number,
): CampaignMessage | null {
  const row = getDatabase().prepare(`SELECT author_type, game_settings_json FROM campaign_messages JOIN campaigns ON campaigns.id = campaign_messages.campaign_id WHERE campaign_messages.id = ?`).get(messageId) as { author_type: string; game_settings_json?: string } | undefined;
  const normalized = row?.author_type === "dm" && parseJson<{ unitSystem?: string }>(row.game_settings_json, {}).unitSystem !== "imperial" ? variants.map(value => normalizeNarrationUnits(value)) : variants;
  const selected = normalized[index];
  if (selected === undefined) {
    return null;
  }
  const result = getDatabase()
    .prepare(
      `UPDATE campaign_messages SET variants_json = ?, variant_index = ?, content = ? WHERE id = ?`,
    )
    .run(JSON.stringify(normalized), index, selected, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}
