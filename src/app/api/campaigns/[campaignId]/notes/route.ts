import { z } from 'zod';
import { isErrorResponse, steersStory, requireMember, requireVoice } from '@/lib/campaign-api';
import { allocateSeq } from '@/lib/db/campaigns';
import { insertNote, listNotesVisibleTo } from '@/lib/db/notes';
import { NotePrivacyError } from '@/lib/spatial/note-privacy';
import { publicationScopeSchema } from '@/lib/spatial/domain-api';
import { getSheetById } from '@/lib/db/sheets';
import { publishPersisted } from '@/lib/events';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie, X-ODM-Actor, X-ODM-Expected-User'};
const createSchema=z.object({characterId:z.string().max(80).optional(),visibility:z.enum(['public','private']),
  title:z.string().trim().max(120).default(''),body:z.string().trim().min(1).max(2000),
  roomId:z.string().uuid().optional(),global:z.boolean().optional(),scope:publicationScopeSchema.optional()});
function changed(request:Request,userId:string){return ['X-ODM-Actor','X-ODM-Expected-User'].some(name=>request.headers.has(name)&&request.headers.get(name)!==userId);}
const identityError=()=>Response.json({error:'Signed-in user changed.',code:'identity_changed'},{status:409,headers});
export async function GET(request:Request,{params}:{params:Promise<{campaignId:string}>}){
  const {campaignId}=await params,context=await requireMember(campaignId);if(isErrorResponse(context))return context;
  if(changed(request,context.user.id))return identityError();
  const roomId=new URL(request.url).searchParams.get('roomId'),notes=listNotesVisibleTo(campaignId,context.user.id,steersStory(context));
  return Response.json({notes:roomId?notes.filter(note=>note.roomId===roomId):notes},{headers});
}
export async function POST(request:Request,{params}:{params:Promise<{campaignId:string}>}){
  const {campaignId}=await params,initial=await requireVoice(campaignId);if(isErrorResponse(initial))return initial;
  const parsed=createSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return Response.json({error:'Invalid note.'},{status:400,headers});
  const context=await requireVoice(campaignId);if(isErrorResponse(context))return context;
  if(initial.user.id!==context.user.id||changed(request,context.user.id))return identityError();
  const input=parsed.data;
  let characterId:string|null=null;
  if(input.characterId){const sheet=getSheetById(input.characterId);if(!sheet||sheet.campaignId!==campaignId)return Response.json({error:'Character not found.'},{status:404,headers});characterId=sheet.id;}
  const suggestion=!characterId&&input.visibility==='public'&&!steersStory(context);
  try{
    if(input.scope&&(input.roomId!==undefined||input.global!==undefined))throw new NotePrivacyError('Use one publication scope format.',400);
    const note=insertNote({campaignId,characterId,authorUserId:context.user.id,visibility:input.visibility,
      status:suggestion?'pending':'active',title:input.title,body:input.body,seq:allocateSeq(campaignId),
      audience:input.scope?{scope:input.scope,actorUserId:context.user.id}:input.roomId?{roomId:input.roomId,global:input.global,actorUserId:context.user.id}
        :input.visibility==='public'?{global:input.global??true,actorUserId:context.user.id}:undefined});
    if(note.visibility==='public'&&note.status==='active')publishPersisted(campaignId,'note_updated',{note});
    else if(suggestion)publishPersisted(campaignId,'note_suggested',{noteId:note.id,authorUserId:note.authorUserId});
    return Response.json({note},{headers});
  }catch(error){if(error instanceof NotePrivacyError)return Response.json({error:error.message},{status:error.status,headers});throw error;}
}
