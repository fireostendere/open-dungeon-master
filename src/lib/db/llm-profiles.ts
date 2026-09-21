export type LlmProfile = { id: string; [key: string]: unknown };

export function listLlmProfiles(): LlmProfile[] {
  return [];
}

export function getLlmProfile(_profileId: string): LlmProfile | null {
  return null;
}

export function applyLlmProfileToGlobal(_profileId: string): boolean {
  return false;
}

export function applyLlmProfileToCampaign(_profileId: string, _campaignId: string): boolean {
  return false;
}
