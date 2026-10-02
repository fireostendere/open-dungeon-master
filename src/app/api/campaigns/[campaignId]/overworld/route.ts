import { z } from "zod";
import { createHash } from "node:crypto";
import { notifySpatialChange, subscribeSpatialChanges, waitForPrivateUpdate } from "@/lib/spatial/updates.mjs";
import {
  capsFor,
  isErrorResponse,
  requireStoryAuthority,
  requireMember,
} from "@/lib/campaign-api";
import { insertKnownLocation, renameLocation } from "@/lib/db/locations";
import {
  overworldView,
  regenerateOverworld,
  setOverworldAnchor,
  setOverworldBackdrop,
  setOverworldLabels,
  setOverworldNotes,
  setOverworldParty,
  setOverworldPaths,
  setOverworldPins,
  paintOverworldTerrain,
} from "@/lib/db/overworld";
import { OVERWORLD_SIZE_LIMITS } from "@/lib/overworld/features";
import { normalizeOverworldParams } from "@/lib/overworld/logic";
import { isUploadedImagePath } from "@/lib/uploads";
import {
  MAX_BRUSH_RADIUS,
  MAX_STROKES,
  OVERWORLD_BRUSHES,
} from "@/lib/overworld/paint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The overworld view lives in the rim (overworldView) so the Azgaar import
// route can answer with the same shape.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const wait = Number(new URL(request.url).searchParams.get("waitMs") ?? 0);
  if (!Number.isSafeInteger(wait) || wait < 0 || wait > 20_000) {
    return Response.json({ error: "Invalid waitMs." }, { status: 400 });
  }
  const load = async () => {
    // A map stays open while people move or lose access. Re-authorize every
    // wakeup, and compare only this viewer's freshly scoped projection.
    const context = await requireMember(campaignId);
    if (isErrorResponse(context)) return context;
    if (request.headers.has("x-odm-expected-user") && request.headers.get("x-odm-expected-user") !== context.user.id) {
      return Response.json({ error: "The signed-in account changed. Reload before continuing." }, { status: 409 });
    }
    const body = JSON.stringify(overworldView(campaignId, capsFor(context).steersStory, context.user.id));
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-store", Vary: "Cookie, X-ODM-Expected-User", "Content-Type": "application/json" };
    return request.headers.get("if-none-match") === etag
      ? new Response(null, { status: 304, headers }) : new Response(body, { headers });
  };
  try {
    return await waitForPrivateUpdate({ load, signal: request.signal,
      waitMs: request.headers.has("if-none-match") ? wait : 0,
      subscribe: (listener: () => void) => subscribeSpatialChanges(campaignId, listener) });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    throw error;
  }
}

const xySchema = z.object({ x: z.number(), y: z.number() });

const patchSchema = z.object({
  regenerate: z.boolean().optional(),
  // A named seed makes the preview and the map the table ends up with the
  // same map; without one a reroll is a fresh roll, as it always was.
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  params: z.unknown().optional(),
  // The size the next roll is made at. Read only with `regenerate`, because
  // resizing IS a reroll: the noise field has no edges to extend.
  width: z.number().int().min(OVERWORLD_SIZE_LIMITS.minWidth).max(OVERWORLD_SIZE_LIMITS.maxWidth).optional(),
  height: z.number().int().min(OVERWORLD_SIZE_LIMITS.minHeight).max(OVERWORLD_SIZE_LIMITS.maxHeight).optional(),
  // Roads, rivers, borders and labels, each sent whole like pins. Shapes are
  // checked by the feature normalizer, which is also what a bundle and an
  // Azgaar file go through.
  paths: z.array(z.unknown()).max(200).optional(),
  labels: z.array(z.unknown()).max(200).optional(),
  // An /api/upload path, or "" to take the picture away.
  backdropPath: z.string().max(300).optional(),
  pins: z
    .array(
      z.object({
        id: z.string().max(80).default(""),
        x: z.number(),
        y: z.number(),
        label: z.string().max(60),
      }),
    )
    .max(40)
    .optional(),
  // null clears the marker, which is the honest state for a party in transit.
  partyXy: xySchema.nullable().optional(),
  anchor: z.object({ locationId: z.string().min(1) }).merge(xySchema).optional(),
  rename: z.object({ locationId: z.string().min(1), name: z.string().trim().min(1).max(80) }).optional(),
  notes: z.string().max(4_000).optional(),
  // Hand-painting the region. Applied before anything else in the handler,
  // because a stroke that widens a lake changes what an anchor drag in the
  // same request is dragging onto.
  strokes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        brush: z.enum(OVERWORLD_BRUSHES),
        radius: z.number().int().min(0).max(MAX_BRUSH_RADIUS).optional(),
      }),
    )
    .max(MAX_STROKES)
    .optional(),
  // Places the DM knows about but the party has not reached: they render as
  // ghost markers until someone walks in.
  places: z
    .array(z.object({ name: z.string().trim().min(1).max(80), blurb: z.string().max(300).default("") }))
    .max(8)
    .optional(),
});

// Authoring controls. Everything here belongs to whoever steers the story.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid overworld update." }, { status: 400 });
  }
  const patch = parsed.data;
  // Painting first: a refused paint is the DM's picture being rejected, and
  // they should hear about it instead of it being buried under whatever else
  // the same request happened to carry.
  let stranded: Array<{ id: string; name: string }> = [];
  if (patch.strokes?.length) {
    const painted = paintOverworldTerrain(campaignId, patch.strokes);
    if ("error" in painted) {
      return Response.json({ error: painted.error }, { status: 400 });
    }
    stranded = painted.stranded.map((anchor) => ({ id: anchor.id, name: anchor.name }));
  }
  if (patch.regenerate) {
    regenerateOverworld(campaignId, {
      seed: patch.seed,
      params: patch.params === undefined ? undefined : normalizeOverworldParams(patch.params),
      width: patch.width,
      height: patch.height,
    });
  }
  if (patch.backdropPath !== undefined) {
    if (patch.backdropPath !== "" && !isUploadedImagePath(patch.backdropPath)) {
      return Response.json({ error: "That is not an uploaded image." }, { status: 400 });
    }
    setOverworldBackdrop(campaignId, patch.backdropPath);
  }
  if (patch.paths) {
    setOverworldPaths(campaignId, patch.paths);
  }
  if (patch.labels) {
    setOverworldLabels(campaignId, patch.labels);
  }
  if (patch.places) {
    for (const place of patch.places) {
      insertKnownLocation({
        campaignId,
        name: place.name,
        layoutDescription: place.blurb,
      });
    }
  }
  if (patch.rename) {
    const renamed = renameLocation(campaignId, patch.rename.locationId, patch.rename.name);
    if (!renamed) {
      return Response.json({ error: "That name is already taken here." }, { status: 409 });
    }
  }
  if (patch.pins) {
    setOverworldPins(campaignId, patch.pins);
  }
  if (patch.partyXy !== undefined) {
    setOverworldParty(campaignId, patch.partyXy);
  }
  if (patch.anchor) {
    setOverworldAnchor(campaignId, patch.anchor.locationId, {
      x: patch.anchor.x,
      y: patch.anchor.y,
    });
  }
  if (patch.notes !== undefined) {
    setOverworldNotes(campaignId, patch.notes);
  }
  // `stranded` names the places the paint left standing in sea or on a peak.
  // Reported, never moved: setOverworldAnchor accepts both on the grounds
  // that a DM who puts a lighthouse on a reef means it.
  notifySpatialChange(campaignId);
  return Response.json({ ...overworldView(campaignId, true, context.user.id), stranded });
}
