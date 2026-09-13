import { ProviderError, publicError } from './core.mjs';
export const responseHeaders={'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
export function failure(error:unknown):Response{return Response.json({error:publicError(error)},{status:error instanceof ProviderError?error.status:502,headers:responseHeaders});}
export async function limitedJson(request:Request,limit=65536):Promise<Record<string,unknown>>{
  const reader=request.body?.getReader();if(!reader)throw new ProviderError('JSON_BODY_REQUIRED');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ProviderError('BODY_TOO_LARGE',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProviderError('INVALID_JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ProviderError('JSON_OBJECT_REQUIRED');
  return parsed as Record<string,unknown>;
}
