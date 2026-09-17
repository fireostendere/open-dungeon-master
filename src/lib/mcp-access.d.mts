export type McpPrincipal = Readonly<{ role: 'operator' } | { role: 'narrator'; campaignId: string }>;
export class McpAccessError extends Error { constructor(message: string, status: number); status: number; }
export function authenticateMcp(request: Request, env?: Record<string, string | undefined>): McpPrincipal;
export function authorizeMcpAction(principal: McpPrincipal, action: string, params: unknown): void;
export function narratorServiceResult(principal: McpPrincipal, action: string): Record<string, unknown> | undefined;
