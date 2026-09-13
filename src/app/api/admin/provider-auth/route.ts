import { requireAdmin,isErrorResponse } from '@/lib/admin-api';
import { requestIsSameOrigin,ProviderError } from '@/lib/provider-auth/core.mjs';
import { performProviderAction } from '@/lib/provider-auth/actions';
import { failure,limitedJson,responseHeaders } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response>{
  const admin=await requireAdmin();if(isErrorResponse(admin))return admin;
  try{
    if(!requestIsSameOrigin(request))throw new ProviderError('SAME_ORIGIN_JSON_REQUIRED',403);
    return Response.json(await performProviderAction(`admin:${admin.id}`,await limitedJson(request),request.url),{headers:responseHeaders});
  }catch(error){return failure(error);}
}
