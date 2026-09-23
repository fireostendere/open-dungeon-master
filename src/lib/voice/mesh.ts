// The legacy mesh is available only for global, explicitly configured calls.
// A direct request to an old mesh URL must not bypass private SFU isolation.
export * from "@/lib/voice/mesh-core";
import * as core from "@/lib/voice/mesh-core";
import { getVoiceScope } from "@/lib/voice/location-access";
import { voiceConfig } from "@/lib/voice/config";
function allowed(campaignId: string): boolean {
  const config = voiceConfig();
  return config.enabled && config.mode === "mesh" && getVoiceScope(campaignId) === "global";
}
// Inspect the unfiltered registry only inside the leader mode-change route.
// Existing direct connections cannot be revoked by an SFU they never joined.
export function hasMeshPeers(campaignId: string): boolean {
  return core.meshRosterFor(campaignId).length > 0;
}
export function meshJoin(campaignId: string, userId: string, username: string) {
  return allowed(campaignId) ? core.meshJoin(campaignId, userId, username) : [];
}
export function meshRosterFor(campaignId: string) {
  return allowed(campaignId) ? core.meshRosterFor(campaignId) : [];
}
export function meshJoined(campaignId: string, userId: string) {
  return allowed(campaignId) && core.meshJoined(campaignId, userId);
}
export function meshHeartbeat(campaignId: string, userId: string) {
  return allowed(campaignId) ? core.meshHeartbeat(campaignId, userId) : null;
}
export function meshSignal(campaignId: string, from: string, to: string, data: unknown) {
  return allowed(campaignId) && core.meshSignal(campaignId, from, to, data);
}
export function meshSetState(campaignId: string, userId: string, state: Parameters<typeof core.meshSetState>[2]) {
  return allowed(campaignId) && core.meshSetState(campaignId, userId, state);
}
export function meshGainsFor(campaignId: string, userId: string) {
  return allowed(campaignId) ? core.meshGainsFor(campaignId, userId) : {};
}
