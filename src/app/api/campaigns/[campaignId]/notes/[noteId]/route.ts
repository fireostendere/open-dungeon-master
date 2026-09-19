import { z } from 'zod';
import { isErrorResponse, steersStory, requireMember, requireVoice } from '@/lib/campaign-api';
import { deleteNote, getNoteById, getNoteVisibleTo, updateNote, type Note } from '@/lib/db/notes';
import { NotePrivacyError, canMutateSpatialNote } from '@/lib/spatial/note-privacy';
import { publicationScopeSchema } from '@/lib/spatial/domain-api';
import { getSheetById } from '@/lib/db/sheets';
import { publishPersisted } from '@/lib/events';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{campaignId:string;noteId:string}>};
const headers={'Cache-Control':'private, no-store',Vary:'Cookie, X-ODM-Actor, X-ODM-Expected-User'};
const patchSchema=z.object({title:z.string().trim().max(120).optional(),body:z.string().trim().min(1).max(2000).optional(),
  pinned:z.boolean().optional(),status:z.literal('active').optional(),roomId:z.string().uuid().optional(),global:z.boolean().optional(),scope:publicationScopeSchema.optional()});
const missing=()=>Response.json({error:'Note not found.'},{status:404,headers});
const changed=(request:Request,userId:string)=>['X-ODM-Actor','X-ODM-Expected-User'].some(name=>request.headers.has(name)&&request.headers.get(name)!==userId);
const identityError=()=>Response.json({error:'Signed-in user changed.',code:'identity_changed'},{status:409,headers});
function isCharacterOwner(note:Note,userId:string){return Boolean(note.characterId&&getSheetById(note.characterId)?.userId===userId);}
export async function GET(request:Request,{params}:Context){
  const {campaignId,noteId}=await params,context=await requireMember(campaignId);if(isErrorResponse(context))return context;
  if(changed(request,context.user.id))return identityError();
  const note=getNoteVisibleTo(campaignId,noteId,context.user.id,steersStory(context));return note?Response.json({note},{headers}):missing();
}
export async function PATCH(request:Request,{params}:Context){
  const {campaignId,noteId}=await params,initial=await requireVoice(campaignId);if(isErrorResponse(initial))return initial;
  const parsed=patchSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return Response.json({error:'Invalid note update.'},{status:400,headers});
  const context=await requireVoice(campaignId);if(isErrorResponse(context))return context;
  if(initial.user.id!==context.user.id||changed(request,context.user.id))return identityError();
  const note=getNoteById(noteId),lead=steersStory(context);
  if(!note||note.campaignId!==campaignId||!getNoteVisibleTo(campaignId,noteId,context.user.id,lead))return missing();
  if(!canMutateSpatialNote(campaignId,noteId,context.user.id))return Response.json({error:"Return to the note's location before changing it."},{status:403,headers});
  const author=note.authorUserId===context.user.id,campaignPublic=!note.characterId&&note.visibility==='public';
  if(!author&&!(lead&&campaignPublic))return Response.json({error:'You cannot edit this note.'},{status:403,headers});
  const {roomId,global,scope,...patch}=parsed.data;
  if(patch.pinned!==undefined&&(!lead||!campaignPublic||note.status!=='active'))return Response.json({error:'Only the party lead can pin party notes.'},{status:403,headers});
  if(patch.status!==undefined&&(!lead||note.status!=='pending'))return Response.json({error:'Only the party lead can approve suggestions.'},{status:403,headers});
  try{
    if(scope&&(roomId!==undefined||global!==undefined))throw new NotePrivacyError('Use one publication scope format.',400);
    const updated=updateNote(noteId,patch,scope?{scope,actorUserId:context.user.id}:roomId!==undefined||global!==undefined?{roomId,global,actorUserId:context.user.id}:undefined);
    if(!updated)return missing();if(updated.visibility==='public'&&updated.status==='active')publishPersisted(campaignId,'note_updated',{note:updated});
    return Response.json({note:updated},{headers});
  }catch(error){if(error instanceof NotePrivacyError)return Response.json({error:error.message},{status:error.status,headers});throw error;}
}
export async function DELETE(request:Request,{params}:Context){
  const {campaignId,noteId}=await params,context=await requireVoice(campaignId);if(isErrorResponse(context))return context;
  if(changed(request,context.user.id))return identityError();
  const note=getNoteById(noteId),lead=steersStory(context);
  if(!note||note.campaignId!==campaignId||!getNoteVisibleTo(campaignId,noteId,context.user.id,lead))return missing();
  if(!canMutateSpatialNote(campaignId,noteId,context.user.id))return Response.json({error:"Return to the note's location before changing it."},{status:403,headers});
  const author=note.authorUserId===context.user.id;
  if(!author&&!(note.visibility==='public'&&(lead||note.status==='active'&&isCharacterOwner(note,context.user.id))))return Response.json({error:'You cannot delete this note.'},{status:403,headers});
  deleteNote(noteId);if(note.visibility==='public')publishPersisted(campaignId,'note_deleted',{noteId:note.id,characterId:note.characterId});
  return Response.json({ok:true},{headers});
}
