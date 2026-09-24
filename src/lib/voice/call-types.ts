import type { VoiceRosterEntry } from "./types";
export type VoiceAccessSnapshot = {
  available: boolean; unavailableReason?: string; mode: "sfu" | "mesh";
  scope: "global" | "location"; canManageScope: boolean; privateScopeAvailable: boolean;
  assignedLocation: boolean; channelId?: string; warning?: string | null;
  joined?: boolean; peers: VoiceRosterEntry[];
};
