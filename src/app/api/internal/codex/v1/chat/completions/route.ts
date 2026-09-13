import { verifyInference,gateway } from '@/lib/provider-auth/service.mjs';
import { failure,limitedJson,responseHeaders } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response>{
  if(!verifyInference(request))return Response.json({error:'Unauthorized'},{status:401,headers:responseHeaders});
  try{
    const body=await limitedJson(request,2*1024*1024);
    // ODM's existing model client supports genuine JSON fallback when a
    // provider does not stream. Never manufacture fake streaming deltas.
    return Response.json(await(await gateway()).complete(body,{signal:request.signal}),{headers:responseHeaders});
  }catch(error){return failure(error);}
}
