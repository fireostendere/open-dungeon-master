import { z } from 'zod';
import { isErrorResponse,requireAdmin } from '@/lib/admin-api';
import { applyLlmProfileToCampaign,applyLlmProfileToGlobal,getLlmProfile,updateLlmProfileCheck } from '@/lib/db/llm-profiles';
import { canApplyProfile,ProviderError } from '@/lib/provider-auth/core.mjs';
import { probeConnection } from '@/lib/provider-auth/connections.mjs';
import { assertSafeEndpointUrl } from '@/lib/url-guard';
import { failure } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({scope:z.enum(['global','campaign']),campaignId:z.string().optional()});
export async function POST(request:Request,{params}:{params:Promise<{profileId:string}>}){
  const admin=await requireAdmin();if(isErrorResponse(admin))return admin;
  const {profileId}=await params;let profile=getLlmProfile(profileId);
  if(!profile)return Response.json({error:'Profile not found.'},{status:404});
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return Response.json({error:'Invalid apply request.'},{status:400});
  if(parsed.data.scope==='campaign'&&!parsed.data.campaignId)return Response.json({error:'campaignId required.'},{status:400});
  try{
    // Legacy wizard probes before saving. Verify the actual saved profile
    // rather than trusting a browser-provided success flag or rejecting its flow.
    if(!canApplyProfile(profile)){
      assertSafeEndpointUrl(profile.baseUrl);const snapshot=profile;
      const report=await probeConnection(profile,{timeoutMs:120000});
      profile=updateLlmProfileCheck(profileId,{at:new Date().toISOString(),ok:report.ok,stages:report.stages},snapshot);
      if(!profile)throw new ProviderError('PROFILE_CHANGED_DURING_PROBE',409);
      if(!canApplyProfile(profile))throw new ProviderError('PROFILE_REQUIRES_SUCCESSFUL_TOOL_PROBE',409);
    }
    const {scope,campaignId}=parsed.data;
    const ok=scope==='global'?applyLlmProfileToGlobal(profileId):applyLlmProfileToCampaign(profileId,campaignId!);
    if(!ok)return Response.json({error:'Target not found.'},{status:404});
    return Response.json({ok:true,scope,...(campaignId?{campaignId}:{})});
  }catch(error){return failure(error);}
}
