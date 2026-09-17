import { existsSync, statSync } from "node:fs";
import { afterCommit } from "@/lib/db/commit-effects";
import {
  claimDmMediaJob, completeDmMediaJob, failDmMediaJob, insertDmMediaIntent,
  pruneCompletedDmMediaJobs, renewDmMediaLease, type DmMediaIntent, type DmMediaJob,
} from "@/lib/db/dm-media-jobs";
import { getCampaignById } from "@/lib/db/campaigns";
import { getCampaignMessage, setMessageGeneratedImage } from "@/lib/db/messages";
import { getLocation, setLocationMap } from "@/lib/db/locations";
import { generateStoryImage, imageProducerReady } from "@/lib/image-generate";
import { publishMediaStatus } from "@/lib/dm/images";
import { presetFor } from "@/lib/worlds/preset";
import { enqueueMediaJob, type MediaLane } from "@/lib/media-queue";
import { narrationAudioPath, renderNarrationSpeech, writeNarrationAudio } from "@/lib/tts";
import { publishPersisted } from "@/lib/events";

declare global {
  var __odmDurableMediaTimer: ReturnType<typeof setInterval> | undefined;
  var __odmDurableMediaLanes: Partial<Record<MediaLane, Promise<void>>> | undefined;
}

export function enqueueDmMediaIntent(campaignId: string, intent: DmMediaIntent): string {
  const id = insertDmMediaIntent(campaignId, intent);
  afterCommit(() => { startDmMediaRunner(); });
  return id;
}

function audioExists(campaignId: string, messageId: string) {
  const file = narrationAudioPath(campaignId, messageId);
  return existsSync(file) && statSync(file).isFile() && statSync(file).size > 0;
}

// Network work happens before the committing callback. Both before and after
// generation we verify the target still belongs to this campaign and has not
// been superseded by a manual edit, another render or a layout change.
async function prepareOutput(job: DmMediaJob): Promise<() => void> {
  const { campaignId, intent } = job;
  const campaign = getCampaignById(campaignId);
  if (!campaign) return () => {};
  if (intent.kind === "map") {
    const current = () => {
      const location = getLocation(intent.targetId);
      return location?.campaignId === campaignId && location.name === intent.name &&
        location.layoutDescription === intent.layout && (location.mapImage?.id ?? null) === intent.previousImageId
        ? location : null;
    };
    if (!current() || !campaign.gameSettings.mapsEnabled) return () => {};
    if (!imageProducerReady(campaign.settings.imageBackend, campaign.settings)) throw new Error("Map producer is not configured.");
    const preset = presetFor(campaign.gameSettings);
    const prompt = ["top-down illustrated game map", preset.mapStyle,
      "labeled areas, clear pathways, no text captions", intent.name, intent.layout]
      .filter(Boolean).join(", ");
    const image = await generateStoryImage(campaign.settings, { prompt, mode: campaign.settings.imageMode, aspect: "landscape" });
    return () => {
      if (current() && setLocationMap(intent.targetId, image)) {
        publishPersisted(campaignId, "location_map_ready", { locationId: intent.targetId, image });
      }
    };
  }
  const current = () => {
    const message = getCampaignMessage(intent.targetId);
    return message?.campaignId === campaignId ? message : null;
  };
  const message = current();
  if (!message) return () => {};
  if (intent.kind === "image") {
    if (message.generatedImage || !message.imageRequest?.prompt || !campaign.settings.imageGenerationEnabled) return () => {};
    if (!imageProducerReady(campaign.settings.imageBackend, campaign.settings)) throw new Error("Image producer is not configured.");
    const request = message.imageRequest;
    const image = await generateStoryImage(campaign.settings, {
      prompt: request.prompt!, mode: request.mode ?? campaign.settings.imageMode,
      aspect: request.aspect ?? campaign.settings.aspect,
    });
    return () => {
      const fresh = current();
      if (fresh && !fresh.generatedImage && JSON.stringify(fresh.imageRequest) === JSON.stringify(request) && setMessageGeneratedImage(intent.targetId, image)) {
        publishPersisted(campaignId, "image_ready", { messageId: intent.targetId, image });
      }
    };
  }
  if (!campaign.gameSettings.ttsEnabled) return () => {};
  const audio = audioExists(campaignId, intent.targetId) ? null : await renderNarrationSpeech(message.content, intent.voice);
  return () => {
    const fresh = current();
    if (!fresh || fresh.content !== message.content) return;
    if (audio && !audioExists(campaignId, intent.targetId)) writeNarrationAudio(campaignId, intent.targetId, audio);
    if (audioExists(campaignId, intent.targetId)) publishPersisted(campaignId, "tts_ready", {
      messageId: intent.targetId, url: `/generated-audio/${campaignId}/${intent.targetId}.mp3`,
    });
  };
}

async function runLane(lane: MediaLane): Promise<void> {
  for (;;) {
    const job = claimDmMediaJob(lane);
    if (!job) return;
    const heartbeat = setInterval(() => {
      try { renewDmMediaLease(job); } catch (error) { console.error("[dm-media] lease renewal failed", error); }
    }, 30_000);
    heartbeat.unref?.();
    try {
      let apply: (() => void) | undefined;
      let failure: unknown;
      // Respect the existing global GPU/TTS lanes, including manual renders.
      // That queue deliberately swallows rejection for fire-and-forget callers;
      // capture it explicitly here so a durable job can retry instead.
      await enqueueMediaJob(`durable ${job.id}`, async () => {
        publishMediaStatus(job.campaignId, job.intent.kind, job.intent.targetId, "generating");
        try { apply = await prepareOutput(job); }
        catch (error) { failure = error; throw error; }
      }, lane);
      if (failure) throw failure;
      if (!apply) throw new Error("Media producer returned no completion callback.");
      completeDmMediaJob(job, apply);
    } catch (error) {
      console.error("[dm-media] durable job failed", job.id, error);
      if (failDmMediaJob(job, "Media generation failed; inspect the server log or reconfigure the producer.")) {
        publishMediaStatus(job.campaignId, job.intent.kind, job.intent.targetId, "failed");
      }
    } finally { clearInterval(heartbeat); }
  }
}

export async function runDmMediaJobsOnce(): Promise<void> {
  const lanes = (globalThis.__odmDurableMediaLanes ??= {});
  await Promise.all((["gpu", "tts"] as const).map((lane) => {
    if (!lanes[lane]) lanes[lane] = runLane(lane).catch((error) => {
      console.error("[dm-media] runner failed", error);
    }).finally(() => { delete lanes[lane]; });
    return lanes[lane];
  }));
  pruneCompletedDmMediaJobs();
}

export function startDmMediaRunner(): void {
  if (!globalThis.__odmDurableMediaTimer) {
    const timer = setInterval(() => { void runDmMediaJobsOnce().catch((error) => console.error("[dm-media] tick failed", error)); }, 60_000);
    timer.unref?.();
    globalThis.__odmDurableMediaTimer = timer;
  }
  void runDmMediaJobsOnce().catch((error) => console.error("[dm-media] startup failed", error));
}

export function stopDmMediaRunner(): void {
  if (globalThis.__odmDurableMediaTimer) clearInterval(globalThis.__odmDurableMediaTimer);
  globalThis.__odmDurableMediaTimer = undefined;
}
