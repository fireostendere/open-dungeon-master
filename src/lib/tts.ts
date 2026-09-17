import { existsSync, mkdirSync, readdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { publishPersisted } from "@/lib/events";
import { publishMediaStatus } from "@/lib/dm/images";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueMediaJob } from "@/lib/media-queue";
import { TTS_VOICES } from "@/lib/tts-voices";
import { configValue, getGlobalConfig } from "@/lib/app-config";

const CHUNK_CHAR_LIMIT = 1_800;

function stripForSpeech(text: string): string {
  return stripToolText(text)
    .replace(/\[roll:[^\]]+\]/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkSentences(text: string): string[] {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHAR_LIMIT) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function kokoroSpeech(input: string, voice: string): Promise<Buffer> {
  const base = configValue(getGlobalConfig().speech.kokoroUrl, "KOKORO_URL", "http://127.0.0.1:8880");
  const response = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", voice, input, response_format: "mp3" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Kokoro TTS failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export function narrationAudioPath(campaignId: string, messageId: string): string {
  return path.join(process.cwd(), "public", "generated-audio", campaignId, `${messageId}.mp3`);
}

// Render without publishing or changing the filesystem. Durable jobs commit
// their output reference/event separately under their SQLite lease.
export async function renderNarrationSpeech(text: string, voice: string): Promise<Buffer | null> {
  const speech = stripForSpeech(text);
  if (!speech) return null;
  const buffers: Buffer[] = [];
  for (const chunk of chunkSentences(speech)) buffers.push(await kokoroSpeech(chunk, voice));
  return Buffer.concat(buffers);
}

function writeAudioAtomically(file: string, audio: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, audio, { flag: "wx", mode: 0o600, flush: true });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeNarrationAudio(campaignId: string, messageId: string, audio: Buffer): void {
  writeAudioAtomically(narrationAudioPath(campaignId, messageId), audio);
}

// Manual/legacy renders retain the existing lane and progress-event contract.
export function enqueueNarrationAudio(campaignId: string, messageId: string, text: string, voice: string) {
  if (!stripForSpeech(text)) return Promise.resolve();
  publishMediaStatus(campaignId, "tts", messageId, "queued");
  return enqueueMediaJob(`tts ${messageId}`, async () => {
    publishMediaStatus(campaignId, "tts", messageId, "generating");
    try {
      const audio = await renderNarrationSpeech(text, voice);
      if (!audio) return;
      writeNarrationAudio(campaignId, messageId, audio);
      publishPersisted(campaignId, "tts_ready", {
        messageId, url: `/generated-audio/${campaignId}/${messageId}.mp3`,
      });
    } catch (error) {
      publishMediaStatus(campaignId, "tts", messageId, "failed");
      throw error;
    }
  }, "tts");
}

export function listNarrationAudio(campaignId: string): Record<string, string> {
  const directory = path.join(process.cwd(), "public", "generated-audio", campaignId);
  if (!existsSync(directory)) return {};
  const audio: Record<string, string> = {};
  for (const file of readdirSync(directory)) {
    if (file.endsWith(".mp3")) audio[file.slice(0, -".mp3".length)] = `/generated-audio/${campaignId}/${file}`;
  }
  return audio;
}

const PREVIEW_LINE = "The tavern door creaks open. Roll for initiative, adventurer.";
const previewRenders = new Map<string, Promise<string>>();

export function isPreviewableVoice(voice: string): boolean {
  return TTS_VOICES.some((entry) => entry.id === voice);
}

export function voicePreviewPath(voice: string): string {
  return path.join(process.cwd(), "public", "generated-audio", "previews", `${voice}.mp3`);
}

export function renderVoicePreview(voice: string): Promise<string> {
  if (!isPreviewableVoice(voice)) return Promise.reject(new Error(`Unknown voice: ${voice}`));
  const file = voicePreviewPath(voice);
  if (existsSync(file)) return Promise.resolve(file);
  const inFlight = previewRenders.get(voice);
  if (inFlight) return inFlight;
  const render = (async () => {
    const audio = await kokoroSpeech(PREVIEW_LINE, voice);
    writeAudioAtomically(file, audio);
    return file;
  })().finally(() => { previewRenders.delete(voice); });
  previewRenders.set(voice, render);
  return render;
}
