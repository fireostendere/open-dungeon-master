import { AsyncLocalStorage } from 'node:async_hooks';
// Scope is installed by trusted HTTP/MCP boundaries, never extracted from
// arbitrary player prose or from event payloads.
const publication = new AsyncLocalStorage();
export function withPublicationScope(campaignId, scope, work) {
  return publication.run({ campaignId, scope }, work);
}
export function currentPublicationScope(campaignId) {
  const value = publication.getStore();
  return value?.campaignId === campaignId ? value.scope : undefined;
}
