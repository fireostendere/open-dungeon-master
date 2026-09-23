import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/core";
import { getCampaignMessage, setMessageNarrationAudioUrl } from "@/lib/db/messages";

export const NARRATION_AUDIO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AudioRow = { campaign_id: string; message_id: string; expires_at: number };

function ensureSchema() {
  getDatabase().exec("CREATE TABLE IF NOT EXISTS campaign_narration_audio (\n" +
    "campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,\n" +
    "message_id TEXT PRIMARY KEY REFERENCES campaign_messages(id) ON DELETE CASCADE,\n" +
    "expires_at INTEGER NOT NULL,\n" +
    "byte_size INTEGER NOT NULL\n" +
    "); CREATE INDEX IF NOT EXISTS idx_campaign_narration_audio_expiry\n" +
    "ON campaign_narration_audio(expires_at);");
}

function filePath(campaignId: string, messageId: string) {
  if (!UUID.test(campaignId) || !UUID.test(messageId)) throw new Error("Invalid narration audio ID.");
  return path.join(process.cwd(), "public", "generated-audio", campaignId, messageId + ".wav");
}

export function storeNarrationAudio(campaignId: string, messageId: string, bytes: Buffer) {
  ensureSchema();
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Narration audio must be between 1 byte and 12 MiB.");
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Narration audio must be a valid WAV file.");
  }
  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId || message.authorType !== "dm") {
    throw new Error("Audio can only be attached to a DM narration in this campaign.");
  }

  const destination = filePath(campaignId, messageId);
  const temporary = destination + "." + randomUUID() + ".tmp";
  const url = "/generated-audio/" + campaignId + "/" + messageId + ".wav";
  const expiresAt = Date.now() + NARRATION_AUDIO_TTL_MS;
  mkdirSync(path.dirname(destination), { recursive: true });
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporary, destination);
    getDatabase().transaction(() => {
      getDatabase().prepare("INSERT INTO campaign_narration_audio " +
        "(campaign_id, message_id, expires_at, byte_size) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(message_id) DO UPDATE SET campaign_id=excluded.campaign_id, " +
        "expires_at=excluded.expires_at, byte_size=excluded.byte_size")
        .run(campaignId, messageId, expiresAt, bytes.length);
      const updated = setMessageNarrationAudioUrl(messageId, url);
      if (!updated) throw new Error("Narration message disappeared during audio upload.");
    })();
  } finally {
    rmSync(temporary, { force: true });
  }

  startNarrationAudioCleanup();
  return {
    message: getCampaignMessage(messageId)!,
    audioUrl: url,
    expiresAt: new Date(expiresAt).toISOString(),
    byteSize: bytes.length,
  };
}

export function hasNarrationAudio(campaignId: string, messageId: string) {
  ensureSchema();
  const row = getDatabase().prepare("SELECT 1 AS present FROM campaign_narration_audio " +
    "WHERE campaign_id=? AND message_id=? AND expires_at>?").get(campaignId, messageId, Date.now());
  return Boolean(row);
}

export function pruneNarrationAudio(now = Date.now()) {
  ensureSchema();
  const db = getDatabase();
  const expired = db.prepare("SELECT campaign_id, message_id FROM campaign_narration_audio " +
    "WHERE expires_at<=?").all(now) as Array<Pick<AudioRow, "campaign_id" | "message_id">>;
  for (const row of expired) {
    rmSync(filePath(row.campaign_id, row.message_id), { force: true });
    db.transaction(() => {
      db.prepare("UPDATE campaign_messages SET narration_audio_url=NULL " +
        "WHERE id=? AND campaign_id=? AND narration_audio_url=?")
        .run(row.message_id, row.campaign_id,
          "/generated-audio/" + row.campaign_id + "/" + row.message_id + ".wav");
      db.prepare("DELETE FROM campaign_narration_audio WHERE campaign_id=? AND message_id=? AND expires_at<=?")
        .run(row.campaign_id, row.message_id, now);
    })();
  }

  // Message deletion cascades the metadata row. Age-only cleanup removes its
  // orphaned WAV on the next pass without touching legacy MP3 narration.
  const root = path.join(process.cwd(), "public", "generated-audio");
  if (!existsSync(root)) return;
  for (const campaign of readdirSync(root, { withFileTypes: true })) {
    if (!campaign.isDirectory() || !UUID.test(campaign.name)) continue;
    const directory = path.join(root, campaign.name);
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".wav") || !UUID.test(file.name.slice(0, -4))) continue;
      const absolute = path.join(directory, file.name);
      if (statSync(absolute).mtimeMs <= now - NARRATION_AUDIO_TTL_MS) rmSync(absolute, { force: true });
    }
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined;
export function startNarrationAudioCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    try { pruneNarrationAudio(); }
    catch (error) { console.error("Narration audio retention cleanup failed.", error); }
  }, 30 * 60 * 1000);
  cleanupTimer.unref?.();
  try { pruneNarrationAudio(); }
  catch (error) { console.error("Narration audio retention cleanup failed.", error); }
}
