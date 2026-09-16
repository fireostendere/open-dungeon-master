import {getAppSetting,setAppSetting,getGlobalConfig} from '@/lib/db/app-settings';
import {serverEnv} from '@/lib/server-env';
import type {ChatMessage,ChatRequestOptions,UpstreamResult} from '@/lib/model-client';
import {requestCloudCompletion} from './cloud-client.mjs';
import {chatUrl} from './connections.mjs';
import {ProviderError,publicError} from './core.mjs';
const STATE='provider_cloud_tool_metadata_v1';
export async function requestStrictCloudMessage(baseUrl:string,model:string,apiKey:string,messages:ChatMessage[],options:ChatRequestOptions):Promise<UpstreamResult>{
  const config=getGlobalConfig();
  const same=(other:string)=>{try{return !!other&&chatUrl(other)===chatUrl(baseUrl);}catch{return false;}};
  const globalMatch=same(config.text.customBaseUrl||serverEnv('OPENAI_COMPAT_BASE_URL'));
  const utilityMatch=same(config.text.utilityBaseUrl||serverEnv('UTILITY_TEXT_BASE_URL'));
  const key=apiKey||(globalMatch?config.text.customApiKey||serverEnv('OPENAI_COMPAT_API_KEY'):'')||(utilityMatch?config.text.utilityApiKey||serverEnv('UTILITY_TEXT_API_KEY'):'');
  try{return await requestCloudCompletion({baseUrl,model,apiKey:key},messages,{...options,timeoutMs:options.timeoutMs||config.text.timeoutMs||180000,maxOutputTokens:options.maxOutputTokens??(config.text.maxOutputTokens||16384)},{read:()=>getAppSetting<Record<string,unknown>>(STATE,{}),write:value=>setAppSetting(STATE,value)});}
  catch(error){return {error:Response.json({error:publicError(error)},{status:error instanceof ProviderError?error.status:502})};}
}
