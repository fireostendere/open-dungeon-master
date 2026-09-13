import { authAction, bridgeProfile, gateway } from './service.mjs';
import { ProviderError, modelId, requireVerifiedProfile, profileHasChanged } from './core.mjs';
import { connectionTarget, listModels, probeConnection } from './connections.mjs';
import { createLlmProfile, updateLlmProfileCheck, applyLlmProfileToGlobal, getLlmProfile } from '@/lib/db/llm-profiles';
import { maskLlmProfile, type LlmProfileCreate } from '@/lib/schemas/llm-profile';
import { assertSafeEndpointUrl } from '@/lib/url-guard';

export async function performProviderAction(owner:string,input:Record<string,unknown>,origin?:string):Promise<unknown>{
  if(input.action==='apply'){
    if(typeof input.profileId!=='string')throw new ProviderError('PROFILE_ID_REQUIRED');
    const profile=getLlmProfile(input.profileId);
    if(!profile)throw new ProviderError('PROFILE_NOT_FOUND',404);
    requireVerifiedProfile(profile);
    if(!applyLlmProfileToGlobal(profile.id))throw new ProviderError('PROFILE_APPLY_FAILED',409);
    return {profile:maskLlmProfile(profile),applied:true};
  }
  if(input.action==='models'&&input.provider!=='chatgpt'){
    const target=connectionTarget(input);assertSafeEndpointUrl(target.baseUrl);
    return {models:await listModels(target)};
  }
  if(input.action!=='connect')return authAction(owner,input);
  const model=modelId(input.model);let config:LlmProfileCreate;
  if(input.provider==='chatgpt'){
    const models=await(await gateway()).models();
    if(!models.some(m=>m.id===model))throw new ProviderError('MODEL_NOT_AVAILABLE_TO_ACCOUNT');
    config=bridgeProfile(model,origin);
  }else config=connectionTarget(input);
  assertSafeEndpointUrl(config.baseUrl);
  const profile=createLlmProfile(config);
  const report=await probeConnection(profile,{timeoutMs:120000});
  const fresh=getLlmProfile(profile.id);
  if(!fresh||profileHasChanged(fresh,profile))throw new ProviderError('PROFILE_CHANGED_DURING_PROBE',409);
  const checked=updateLlmProfileCheck(profile.id,{at:new Date().toISOString(),ok:report.ok,stages:report.stages});
  if(!checked)throw new ProviderError('PROFILE_CHANGED_DURING_PROBE',409);
  if(input.apply===true){requireVerifiedProfile(checked);if(!applyLlmProfileToGlobal(profile.id))throw new ProviderError('PROFILE_APPLY_FAILED',409);}
  return {profile:maskLlmProfile(checked),report,applied:input.apply===true};
}
