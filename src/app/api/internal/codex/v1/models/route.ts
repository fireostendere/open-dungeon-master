import { verifyInference,gateway } from '@/lib/provider-auth/service.mjs';
import { failure,responseHeaders } from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request):Promise<Response>{
  if(!verifyInference(request))return Response.json({error:'Unauthorized'},{status:401,headers:responseHeaders});
  try{return Response.json({object:'list',data:(await(await gateway()).models()).map(m=>({id:m.id,object:'model',owned_by:'chatgpt'}))},{headers:responseHeaders});}
  catch(error){return failure(error);}
}
