import { isErrorResponse,requireAdmin } from '@/lib/admin-api';
import { getLlmProfile,updateLlmProfileCheck } from '@/lib/db/llm-profiles';
import { maskLlmProfile } from '@/lib/schemas/llm-profile';
import { probeConnection } from '@/lib/provider-auth/connections.mjs';
import { assertSafeEndpointUrl } from '@/lib/url-guard';
import { failure } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{profileId:string}>}){
  const admin=await requireAdmin();if(isErrorResponse(admin))return admin;
  const {profileId}=await params;const profile=getLlmProfile(profileId);
  if(!profile)return Response.json({error:'Profile not found.'},{status:404});
  try{
    assertSafeEndpointUrl(profile.baseUrl);
    const body=await request.json().catch(()=>({}));
    const timeoutMs=typeof body.timeoutMs==='number'&&Number.isFinite(body.timeoutMs)?Math.max(1000,Math.min(body.timeoutMs,180000)):120000;
    const report=await probeConnection(profile,{timeoutMs});
    const fresh=updateLlmProfileCheck(profileId,{at:new Date().toISOString(),ok:report.ok,stages:report.stages},profile);
    if(!fresh)return Response.json({error:'Profile changed during probe. Run the check again.'},{status:409});
    return Response.json({profile:maskLlmProfile(fresh),report:{...report,capabilities:{tools:report.ok,streaming:false,modelListed:report.stages.models?.ok??false}}});
  }catch(error){return failure(error);}
}
