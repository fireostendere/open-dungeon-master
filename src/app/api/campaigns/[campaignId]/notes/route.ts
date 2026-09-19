import { z } from "zod";
import { isErrorResponse, steersStory, requireMember, requireVoice } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertNote, listNotesVisibleTo } from "@/lib/db/notes";
import { NotePrivacyError } from "@/lib/spatial/note-privacy";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, X-ODM-Actor" };
const createSchema = z.object({
  characterId: z.string().max(80).optional(), visibility: z.enum(["public", "private"]),
  title: z.string().trim().max(120).default(""), body: z.string().trim().min(1).max(2000),
  roomId: z.string().uuid().optional(), global: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  const expected = request.headers.get("X-ODM-Actor");
  if (expected !== null && expected !== context.user.id) return Response.json({ error: "Signed-in user changed." }, { status: 409, headers });
  const roomId = new URL(request.url).searchParams.get("roomId");
  const notes = listNotesVisibleTo(campaignId, context.user.id, steersStory(context));
  return Response.json({ notes: roomId ? notes.filter(note => note.roomId === roomId) : notes }, { headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const initial = await requireVoice(campaignId);
  if (isErrorResponse(initial)) return initial;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid note." }, { status: 400, headers });
  // Body parsing awaited; repeat mutable authorization before the write.
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) return context;
  const expected = request.headers.get("X-ODM-Actor") ?? initial.user.id;
  if (expected !== context.user.id) return Response.json({ error: "Signed-in user changed." }, { status: 409, headers });
  const input = parsed.data;
  let characterId: string | null = null;
  if (input.characterId) {
    const sheet = getSheetById(input.characterId);
    if (!sheet || sheet.campaignId !== campaignId) return Response.json({ error: "Character not found." }, { status: 404, headers });
    characterId = sheet.id;
  }
  const suggestion = !characterId && input.visibility === "public" && !steersStory(context);
  try {
    const note = insertNote({ campaignId, characterId, authorUserId: context.user.id,
      visibility: input.visibility, status: suggestion ? "pending" : "active", title: input.title, body: input.body,
      seq: allocateSeq(campaignId),
      // The established Party note UI explicitly promises global sharing.
      // Location-note UI supplies roomId instead; never change its audience on approval.
      audience: input.roomId ? { roomId: input.roomId, global: input.global }
        : input.visibility === "public" ? { global: input.global ?? true } : undefined,
    });
    if (note.visibility === "public" && note.status === "active") publishPersisted(campaignId, "note_updated", { note });
    else if (suggestion) publishPersisted(campaignId, "note_suggested", { noteId: note.id, authorUserId: note.authorUserId });
    return Response.json({ note }, { headers });
  } catch (error) {
    if (error instanceof NotePrivacyError) return Response.json({ error: error.message }, { status: error.status, headers });
    throw error;
  }
}
