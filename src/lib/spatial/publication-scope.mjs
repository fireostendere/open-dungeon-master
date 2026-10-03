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

// Mechanical room selection is independent of who receives an event.
export function withEncounterRoom(campaignId, roomId, work) {
  const previous = publication.getStore();
  return publication.run({ ...(previous?.campaignId === campaignId ? previous : {}), campaignId, roomId }, work);
}
export function currentEncounterRoom(campaignId) {
  const value = publication.getStore();
  return value?.campaignId === campaignId ? value.roomId : undefined;
}

// Without rooms, several fights can run at once, one per place. A fight
// scope names which one the engine is working on: its encounter, its own
// floor. null is the table itself (no fight); undefined is no scope at all,
// where a lone fight is still found by itself (src/lib/db/encounters.ts).
export function withFight(campaignId, encounterId, work) {
  const previous = publication.getStore();
  return publication.run({ ...(previous?.campaignId === campaignId ? previous : {}), campaignId, fightId: encounterId }, work);
}
export function currentFight(campaignId) {
  const value = publication.getStore();
  return value?.campaignId === campaignId && 'fightId' in value ? value.fightId : undefined;
}

