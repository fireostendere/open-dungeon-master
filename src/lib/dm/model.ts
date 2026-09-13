import { requestCustomMessage,requestLocalMessage,type ChatMessage,type ChatRequestOptions,type UpstreamResult } from '@/lib/model-client';
import type {StorySettings} from '@/lib/types';
import {isStrictCloudEndpoint} from '@/lib/provider-auth/cloud-client.mjs';
import {requestStrictCloudMessage} from '@/lib/provider-auth/cloud';

// Strict vendor APIs retain their opaque tool metadata server-side. Local
// runtimes and the official Codex bridge keep the existing compatible client.
function custom(baseUrl:string,model:string,key:string,messages:ChatMessage[],options:ChatRequestOptions):Promise<UpstreamResult>{
  return isStrictCloudEndpoint(baseUrl)?requestStrictCloudMessage(baseUrl,model,key,messages,options):requestCustomMessage(baseUrl,model,key,messages,options);
}
export function requestDmMessage(settings:StorySettings,messages:ChatMessage[],options:ChatRequestOptions):Promise<UpstreamResult>{
  if(settings.textProvider==='local')return requestLocalMessage(settings.localTextModel,messages,options);
  return custom(settings.customBaseUrl,settings.customModel,settings.customApiKey,messages,options);
}
// Utility work uses the selected backend, with the original DM fallback.
export async function requestUtilityMessage(settings:StorySettings,messages:ChatMessage[],options:ChatRequestOptions):Promise<UpstreamResult>{
  const model=(settings.utilityModel??'').trim();if(!model)return requestDmMessage(settings,messages,options);
  const result=settings.utilityProvider==='local'?await requestLocalMessage(model,messages,options):await custom(settings.utilityBaseUrl,model,settings.utilityApiKey,messages,options);
  if(!result.error)return result;
  console.error('[model] Utility request failed; retrying with the story model.');
  return requestDmMessage(settings,messages,options);
}
