import { verifyLocalControl } from '@/lib/provider-auth/service.mjs';
import { performProviderAction } from '@/lib/provider-auth/actions';
import { failure,limitedJson,responseHeaders } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response>{
  if(!verifyLocalControl(request))return Response.json({error:'Unauthorized'},{status:401,headers:responseHeaders});
  try{return Response.json(await performProviderAction('local-cli',await limitedJson(request),request.url),{headers:responseHeaders});}
  catch(error){return failure(error);}
}
