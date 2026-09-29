import { z } from "zod";
import { inspectImage } from "@/lib/assets/image";
import { getDatabase } from "@/lib/db/core";
import { getCharacter, updateCharacterPortrait } from "@/lib/db/characters";
import { getCampaignById, setCampaignCover } from "@/lib/db/campaigns";
import { getSheetById, listSheetsForLibraryCharacter, patchSheet } from "@/lib/db/sheets";
import { getNpcById, setNpcPortrait } from "@/lib/db/npcs";
import { mirrorToCampaignSheets } from "@/lib/portrait";
import { publishPersisted } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";
import { MAX_UPLOAD_BYTES, deleteUploadedImageIfUnreferenced, readUploadedImage, writeUploadedImage } from "@/lib/uploads-store";
import type { SheetAttachment } from "@/lib/schemas/sheet";
import type { UploadMimeType } from "@/lib/uploads-store";

export const imageTargetSchema = z.object({
  type: z.enum(["library_character", "sheet", "npc", "campaign"]),
  id: z.string().uuid(),
}).strict();
type ImageTarget = z.infer<typeof imageTargetSchema>;

function targetImage(target: ImageTarget): SheetAttachment | null {
  switch (target.type) {
    case "library_character": {
      const character = getCharacter(target.id);
      if (!character) throw new Error("Library character not found.");
      return character.sheet.portrait ?? null;
    }
    case "sheet": {
      const sheet = getSheetById(target.id);
      if (!sheet) throw new Error("Campaign sheet not found.");
      return sheet.portrait;
    }
    case "npc": {
      const npc = getNpcById(target.id);
      if (!npc) throw new Error("NPC not found.");
      return npc.portraitUrl ? { url: npc.portraitUrl } : null;
    }
    case "campaign": {
      const campaign = getCampaignById(target.id);
      if (!campaign) throw new Error("Campaign not found.");
      return campaign.cover;
    }
  }
}

function replaceImage(target: ImageTarget, image: SheetAttachment | null, expectedUrl?: string | null) {
  return getDatabase().transaction(() => {
    const old = targetImage(target);
    if (expectedUrl !== undefined && (old?.url ?? null) !== expectedUrl) {
      throw new Error("Target image changed; read it again before replacing it.");
    }
    const oldUrls = [old?.url];
    switch (target.type) {
      case "library_character": {
        const character = getCharacter(target.id)!;
        oldUrls.push(...listSheetsForLibraryCharacter(target.id).map((sheet) => sheet.portrait?.url));
        updateCharacterPortrait(character.userId, target.id, image);
        mirrorToCampaignSheets(target.id, image, { overwrite: true });
        break;
      }
      case "sheet": {
        const sheet = patchSheet(target.id, { portrait: image })!;
        publishPersisted(sheet.campaignId, "sheet_updated", { sheet });
        break;
      }
      case "npc": {
        setNpcPortrait(target.id, image?.url ?? "");
        break;
      }
      case "campaign":
        setCampaignCover(target.id, image ? { id: image.id!, url: image.url } : null);
        publishPersisted(target.id, "campaign_updated", { cover: image });
        break;
    }
    return { target, image: targetImage(target), oldUrls };
  })();
}

export async function getTargetImage(target: ImageTarget, includeData = false) {
  const image = targetImage(target);
  if (!image) return { target, image: null, available: false };
  const stored = await readUploadedImage(image.url);
  if (!stored) return { target, image, available: false };
  if (stored.bytes.length > MAX_UPLOAD_BYTES) throw new Error("Image exceeds the 8MB size limit.");
  const inspected = inspectImage(stored.bytes);
  return { target, image, available: true, ...inspected,
    ...(includeData ? { dataBase64: stored.bytes.toString("base64") } : {}) };
}

export async function setTargetImage(input: {
  target: ImageTarget; dataBase64: string; mimeType: UploadMimeType; name?: string; expectedUrl?: string | null;
}) {
  targetImage(input.target); // Reject nonexistent targets before writing any file.
  if (input.dataBase64.length > 4 * Math.ceil(MAX_UPLOAD_BYTES / 3)) throw new Error("Image exceeds the 8MB size limit.");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.toString("base64") !== input.dataBase64) throw new Error("Invalid canonical base64 image data.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("Image exceeds the 8MB size limit.");
  const inspected = inspectImage(bytes);
  if (inspected.mimeType !== input.mimeType) throw new Error("Image MIME type does not match its bytes.");
  const written = await writeUploadedImage(bytes, inspected.mimeType);
  let result;
  try {
    result = replaceImage(input.target, { ...written, name: input.name, type: inspected.mimeType }, input.expectedUrl);
  } catch (error) {
    deleteUploadedImageIfUnreferenced(written.url);
    throw error;
  }
  for (const url of new Set(result.oldUrls)) deleteUploadedImageIfUnreferenced(url);
  return { target: result.target, image: result.image, available: true, ...inspected };
}

export function deleteTargetImage(target: ImageTarget, expectedUrl?: string | null) {
  const result = replaceImage(target, null, expectedUrl);
  for (const url of new Set(result.oldUrls)) deleteUploadedImageIfUnreferenced(url);
  return { target: result.target, image: result.image, available: false };
}

export const expectedImageUrlSchema = z.string().refine(isUploadedImagePath, "Invalid uploaded image path.").nullable().optional();
