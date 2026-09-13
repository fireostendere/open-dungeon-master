import {verifyInference,gateway} from '@/lib/provider-auth/service.mjs';
import {ProviderError} from '@/lib/provider-auth/core.mjs';
import {failure,limitedJson,responseHeaders} from '@/lib/provider-auth/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response>{
  if(!verifyInference(request))return Response.json({error:'Unauthorized'},{status:401,headers:responseHeaders});
  try{
    const body=await limitedJson(request,2*1024*1024);
    return Response.json(await(await gateway()).complete(body,{signal:request.signal}),{headers:responseHeaders});
  }catch(error){
    // ODM already retries unsupported image input as text with portrait
    // labels retained. Fail before creating a native turn, using its known
    // image_url marker so graphics never break the text-only bridge.
    if(error instanceof ProviderError&&error.code==='ONLY_TEXT_MESSAGES_SUPPORTED')return failure(new ProviderError('IMAGE_URL_UNSUPPORTED',400));
    return failure(error);
  }
}
