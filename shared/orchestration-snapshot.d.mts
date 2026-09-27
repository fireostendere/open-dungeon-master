export const ORCHESTRATION_SECTIONS: readonly ["party", "combat", "location", "recent", "memory", "npcs"];
export type OrchestrationSection = (typeof ORCHESTRATION_SECTIONS)[number];
export type OrchestrationSnapshotOptions = {
  sections?: OrchestrationSection[];
  maxBytes?: number;
  recentLimit?: number;
  knownRevision?: string;
};
export function buildOrchestrationSnapshot(raw: Record<string, unknown>, options?: OrchestrationSnapshotOptions): Record<string, unknown>;
