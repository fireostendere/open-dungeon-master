import { capsFor, isErrorResponse, requireMember } from '@/lib/campaign-api';
import { capsFor as campaignCapsFor, getCampaignForUser, latestSeq } from '@/lib/db/campaigns';
import { createCampaignStream } from '@/lib/campaign-stream';
import { campaignEventProjector } from '@/lib/spatial/event-policy';
import { listEventsSince, sseChunk, subscribeRaw } from '@/lib/events';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{campaignId:string}>}){
  const {campaignId}=await params,context=await requireMember(campaignId);
  if(isErrorResponse(context))return context;
  const role=capsFor(context).role,url=new URL(request.url);
  const rawCursor=request.headers.get('last-event-id')??url.searchParams.get('lastSeq')??'0',afterSeq=Number(rawCursor);
  if(!/^\d+$/.test(rawCursor)||!Number.isSafeInteger(afterSeq)||afterSeq<0)return Response.json({error:'Invalid campaign stream cursor.'},{status:400});
  const stream=createCampaignStream({
    ...campaignEventProjector(campaignId,context.user.id),afterSeq,signal:request.signal,
    canDeliver:()=>{const campaign=getCampaignForUser(campaignId,context.user.id);return Boolean(campaign&&campaignCapsFor(campaign,context.user.id).role===role);},
    latestSeq:()=>latestSeq(campaignId),
    // Raw process-local frames are projected at dequeue, not twice.
    listEventsSince:(cursor,limit)=>listEventsSince(campaignId,cursor,limit),
    subscribe:send=>subscribeRaw(campaignId,send,context.user.id),sseChunk,
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store, no-transform',
    Vary:'Cookie',Connection:'keep-alive','X-Accel-Buffering':'no'}});
}
