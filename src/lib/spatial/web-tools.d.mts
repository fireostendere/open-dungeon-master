export type LocationWebTool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>) => Promise<unknown> };
export function locationWebTools(options: { campaignId: string; userId: string; signal: AbortSignal; fetchImpl?: typeof fetch }): LocationWebTool[];
