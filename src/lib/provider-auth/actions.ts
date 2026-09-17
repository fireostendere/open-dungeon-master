import { authAction, bridgeProfile, gateway } from './service.mjs';
import { ProviderError, modelId, requireVerifiedProfile } from './core.mjs';
import { connectionTarget, listModels, probeConnection } from './connections.mjs';
import { createLlmProfile, updateLlmProfileCheck, applyLlmProfileToGlobal, getLlmProfile, listLlmProfiles } from '@/lib/db/llm-profiles';
import { maskLlmProfile, type LlmProfileCreate } from '@/lib/schemas/llm-profile';
import { assertSafeEndpointUrl } from '@/lib/url-guard';
import { combinedSignal, currentOperationSignal } from '../operation-scope.mjs';

export async function performProviderAction(owner:string,input:Record<string,unknown>,origin?:string,options:{signal?:AbortSignal}={}):Promise<unknown>{
  const signal=combinedSignal(options.signal,currentOperationSignal());
  signal?.throwIfAborted();
  if(input.action==='profiles'){
    return {profiles:listLlmProfiles()};
  }
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
    return {models:await listModels(target,{signal})};
  }
  if(input.action!=='connect')return authAction(owner,input);
  const model=modelId(input.model);let config:LlmProfileCreate;
  if(input.provider==='chatgpt'){
    const models=await(await gateway()).models();
    signal?.throwIfAborted();
    if(!models.some(m=>m.id===model))throw new ProviderError('MODEL_NOT_AVAILABLE_TO_ACCOUNT');
    config=bridgeProfile(model,origin);
  }else config=connectionTarget(input);
  assertSafeEndpointUrl(config.baseUrl);
  // Probe the immutable candidate before creating a persisted profile. An
  // aborted request must not leave a new profile or switch a live campaign.
  const report=await probeConnection(config,{timeoutMs:120000,signal});
  signal?.throwIfAborted();
  const profile=createLlmProfile(config);
  const checked=updateLlmProfileCheck(profile.id,{at:new Date().toISOString(),ok:report.ok,stages:report.stages});
  if(!checked)throw new ProviderError('PROFILE_CHANGED_DURING_PROBE',409);
  if(input.apply===true){requireVerifiedProfile(checked);if(!applyLlmProfileToGlobal(profile.id))throw new ProviderError('PROFILE_APPLY_FAILED',409);}
  return {profile:maskLlmProfile(checked),report,applied:input.apply===true};
}
