import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { touchCampaign } from "@/lib/db/campaigns";
import type { GeneratedImage, ImageRequest } from "@/lib/types";

export type CampaignMessage = {
  id: string;
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId: string | null;
  characterId: string | null;
  content: string;
  imageRequest?: ImageRequest;
  generatedImage?: GeneratedImage;
  locationId?: string;
  variants?: string[];
  variantIndex?: number;
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
  image_request_json: string | null;
  generated_image_json: string | null;
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
    imageRequest: parseJson<ImageRequest | undefined>(row.image_request_json, undefined),
    generatedImage: parseJson<GeneratedImage | undefined>(row.generated_image_json, undefined),
    locationId: row.location_id ?? undefined,
    variants: parseJson<string[] | undefined>(row.variants_json, undefined),
    variantIndex: row.variant_index ?? undefined,
    dmTurnId: row.dm_turn_id ?? undefined,
    createdAt: row.created_at,
  };
}

type CampaignLanguage = "en" | "ru" | "pl";

function campaignLanguage(campaignId: string): CampaignLanguage {
  const row = getDatabase()
    .prepare("SELECT game_settings_json FROM campaigns WHERE id = ?")
    .get(campaignId) as { game_settings_json?: string | null } | undefined;
  const settings = parseJson<{ language?: unknown }>(row?.game_settings_json ?? null, {});
  return settings.language === "ru" || settings.language === "pl" ? settings.language : "en";
}

// Server-generated transcript messages are game events, not authored prose.
// Localize them at the persistence boundary so every writer (combat, retry,
// fallback DM) follows the campaign narration language and the web client never
// has to guess which English service strings should be translated.
function localizeServiceContent(
  campaignId: string,
  authorType: "player" | "dm" | "system",
  content: string,
): string {
  if (authorType === "player") return content;
  const language = campaignLanguage(campaignId);
  if (language === "en") return content;

  let match = /^It is now (.+)'s turn \(round (\d+)\)\.$/.exec(content);
  if (match) return language === "ru" ? `Теперь ход ${match[1]} (раунд ${match[2]}).` : `Teraz kolej ${match[1]} (runda ${match[2]}).`;

  match = /^(.+) ends their turn\.(?: It is now (.+)'s turn\.)?$/.exec(content);
  if (match) {
    const next = match[2]
      ? language === "ru" ? ` Теперь ход ${match[2]}.` : ` Teraz kolej ${match[2]}.`
      : "";
    return language === "ru" ? `${match[1]} завершает ход.${next}` : `${match[1]} kończy turę.${next}`;
  }

  match = /^The party lead skipped (.+)'s turn\.(?: It is now (.+)'s turn\.)?$/.exec(content);
  if (match) {
    const next = match[2]
      ? language === "ru" ? ` Теперь ход ${match[2]}.` : ` Teraz kolej ${match[2]}.`
      : "";
    return language === "ru" ? `Лидер группы пропустил ход ${match[1]}.${next}` : `Lider drużyny pominął turę ${match[1]}.${next}`;
  }

  match = /^Skipped enemy turns resolve automatically: (.+)$/.exec(content);
  if (match) return language === "ru" ? `Пропущенные ходы врагов разрешены автоматически: ${match[1]}` : `Pominięte tury wrogów rozstrzygnięto automatycznie: ${match[1]}`;

  match = /^(.+)'s turn resolves automatically: (.+)$/.exec(content);
  if (match) return language === "ru" ? `Ход ${match[1]} разрешён автоматически: ${match[2]}` : `Tura ${match[1]} została rozstrzygnięta automatycznie: ${match[2]}`;

  if (content === "The moment hangs there, waiting on the party's next move.") {
    return language === "ru"
      ? "Мгновение замирает в ожидании следующего действия группы."
      : "Chwila zamiera w oczekiwaniu na następny ruch drużyny.";
  }
  if (content.includes("The Dungeon Master hit an internal error")) {
    return language === "ru"
      ? "Ведущий столкнулся с внутренней ошибкой и остановил этот ход."
      : "Mistrz Gry napotkał błąd wewnętrzny i przerwał tę turę.";
  }
  if (content.includes("The Dungeon Master could not reach the model backend")) {
    return language === "ru"
      ? "Ведущий не смог подключиться к серверу модели."
      : "Mistrz Gry nie mógł połączyć się z serwerem modelu.";
  }
  return content;
}

export function insertCampaignMessage(input: {
  campaignId: string;
  seq: number;
  authorType: "player" | "dm" | "system";
  userId?: string | null;
  characterId?: string | null;
  content: string;
  imageRequest?: ImageRequest;
  locationId?: string;
  dmTurnId?: string;
}): CampaignMessage {
  const id = crypto.randomUUID();
  const content = localizeServiceContent(input.campaignId, input.authorType, input.content);
  getDatabase()
    .prepare(
      `
        INSERT INTO campaign_messages (
          id, campaign_id, seq, author_type, user_id, character_id, content,
          image_request_json, location_id, dm_turn_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.imageRequest ? JSON.stringify(input.imageRequest) : null,
      input.locationId ?? null,
      input.dmTurnId ?? null,
      nowIso(),
    );
  touchCampaign(input.campaignId);
  const message = getCampaignMessage(id);
  if (!message) throw new Error("Failed to insert campaign message.");
  return message;
}

export function getCampaignMessage(messageId: string): CampaignMessage | null {
  const row = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE id = ?`).get(messageId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function listMessagesInSeqRange(campaignId: string, seqStart: number, seqEnd: number): CampaignMessage[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC`).all(campaignId, seqStart, seqEnd) as MessageRow[];
  return rows.map(mapMessage);
}

export function countMessagesUpToSeq(campaignId: string, seq: number): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ? AND seq <= ?`).get(campaignId, seq) as { n: number };
  return row.n;
}

export function listRecentMessages(campaignId: string, limit = 100): CampaignMessage[] {
  const rows = getDatabase().prepare(`SELECT * FROM (SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC`).all(campaignId, limit) as MessageRow[];
  return rows.map(mapMessage);
}

export function listAllMessages(campaignId: string): CampaignMessage[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq ASC`).all(campaignId) as MessageRow[];
  return rows.map(mapMessage);
}

export function listMessagesPage(campaignId: string, offset: number, limit: number): CampaignMessage[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?`).all(campaignId, limit, offset) as MessageRow[];
  return rows.map(mapMessage);
}

export function countMessages(campaignId: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM campaign_messages WHERE campaign_id = ?`).get(campaignId) as { count: number };
  return row.count;
}

export function setMessageImageRequest(messageId: string, request: ImageRequest) {
  const result = getDatabase().prepare(`UPDATE campaign_messages SET image_request_json = ? WHERE id = ?`).run(JSON.stringify(request), messageId);
  return result.changes > 0;
}

export function setMessageGeneratedImage(messageId: string, image: GeneratedImage) {
  const result = getDatabase().prepare(`UPDATE campaign_messages SET generated_image_json = ? WHERE id = ?`).run(JSON.stringify(image), messageId);
  return result.changes > 0;
}

export function clearMessageDmTurn(messageId: string, dmTurnId: string): CampaignMessage | null {
  const result = getDatabase().prepare(`UPDATE campaign_messages SET dm_turn_id = NULL WHERE id = ? AND dm_turn_id = ?`).run(messageId, dmTurnId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

export function findMessageForDmTurn(dmTurnId: string): CampaignMessage | null {
  const row = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE dm_turn_id = ? ORDER BY seq DESC LIMIT 1`).get(dmTurnId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function updateMessageContent(messageId: string, content: string): CampaignMessage | null {
  const result = getDatabase().prepare(`UPDATE campaign_messages SET content = ?, variants_json = NULL, variant_index = NULL WHERE id = ?`).run(content, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}

export function getLatestDmMessage(campaignId: string): CampaignMessage | null {
  const row = getDatabase().prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' ORDER BY seq DESC LIMIT 1`).get(campaignId) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function setMessageVariants(messageId: string, variants: string[], index: number): CampaignMessage | null {
  const selected = variants[index];
  if (selected === undefined) return null;
  const result = getDatabase().prepare(`UPDATE campaign_messages SET variants_json = ?, variant_index = ?, content = ? WHERE id = ?`).run(JSON.stringify(variants), index, selected, messageId);
  return result.changes > 0 ? getCampaignMessage(messageId) : null;
}
