import {applyLlmProfileToCampaign,getLlmProfile} from '@/lib/db/llm-profiles';
import {isErrorResponse,requireStoryAuthority} from '@/lib/campaign-api';
import {maskStorySettings,scrubStorySettings} from '@/lib/db/settings';
import {publishPersisted} from '@/lib/events';
import {canApplyProfile} from '@/lib/provider-auth/core.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(_request:Request,{params}:{params:Promise<{campaignId:string;profileId:string}>}){
  const {campaignId,profileId}=await params;
  const context=await requireStoryAuthority(campaignId);if(isErrorResponse(context))return context;
  const profile=getLlmProfile(profileId);if(!profile)return Response.json({error:'Profile not found.'},{status:404});
  if(!canApplyProfile(profile))return Response.json({error:'Run the administrator tool check before applying this profile.'},{status:409});
  const updated=applyLlmProfileToCampaign(profileId,campaignId);if(!updated)return Response.json({error:'Could not apply profile.'},{status:500});
  publishPersisted(campaignId,'campaign_updated',{settings:scrubStorySettings(updated)});
  return Response.json({settings:maskStorySettings(updated)});
}
