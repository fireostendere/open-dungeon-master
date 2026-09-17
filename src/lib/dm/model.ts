import { requestCustomMessage, requestLocalMessage, storyContextTokens, configuredMaxOutputTokens, localMaxOutputTokens,
  type ChatMessage, type ChatRequestOptions, type UpstreamResult } from '@/lib/model-client';
import { getGlobalConfig } from '@/lib/db/app-settings';
import type { StorySettings } from '@/lib/types';
import { isStrictCloudEndpoint } from '@/lib/provider-auth/cloud-client.mjs';
import { requestStrictCloudMessage } from '@/lib/provider-auth/cloud';
import { ModelContextError, normalizeModelRuntime, requestBudget } from '@/lib/model-runtime';

// Strict vendor APIs retain opaque tool metadata server-side.
function custom(baseUrl: string, model: string, key: string, messages: ChatMessage[], options: ChatRequestOptions): Promise<UpstreamResult> {
  return isStrictCloudEndpoint(baseUrl) ? requestStrictCloudMessage(baseUrl, model, key, messages, options) : requestCustomMessage(baseUrl, model, key, messages, options);
}
export async function requestDmMessage(settings: StorySettings, messages: ChatMessage[], options: ChatRequestOptions): Promise<UpstreamResult> {
  const runtime = normalizeModelRuntime(settings.modelRuntime, settings.customBaseUrl, settings.customModel);
  const contextTokens = storyContextTokens(settings);
  try {
    const budget = requestBudget(messages, options.tools, contextTokens,
      options.maxOutputTokens ?? runtime?.maxOutputTokens ?? (settings.textProvider === 'local' ? localMaxOutputTokens() : (getGlobalConfig().text.maxOutputTokens || configuredMaxOutputTokens())));
    const resolved: ChatRequestOptions = { ...options, contextTokens, maxOutputTokens: budget.maxOutputTokens,
      timeoutMs: options.timeoutMs ?? runtime?.timeoutMs,
      thinking: options.toolChoice === 'none' ? false : runtime && runtime.thinking !== 'auto' ? runtime.thinking === 'on' : options.thinking };
    if (settings.textProvider === 'local') return requestLocalMessage(settings.localTextModel, messages, resolved);
    return custom(settings.customBaseUrl, settings.customModel, settings.customApiKey, messages, resolved);
  } catch (error) {
    if (error instanceof ModelContextError) return { error: Response.json({ error: error.message, ...error.budget }, { status: 400 }) };
    throw error;
  }
}
export async function requestUtilityMessage(settings: StorySettings, messages: ChatMessage[], options: ChatRequestOptions): Promise<UpstreamResult> {
  const model = (settings.utilityModel ?? '').trim();
  if (!model) return requestDmMessage(settings, messages, options);
  const result = settings.utilityProvider === 'local' ? await requestLocalMessage(model, messages, options) : await custom(settings.utilityBaseUrl, model, settings.utilityApiKey, messages, options);
  if (!result.error) return result;
  console.error('[model] Utility request failed; retrying with the story model.');
  return requestDmMessage(settings, messages, options);
}
