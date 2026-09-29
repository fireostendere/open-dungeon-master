import { createHash, timingSafeEqual } from 'node:crypto';

export class McpAccessError extends Error {
  constructor(message, status) { super(message); this.name = 'McpAccessError'; this.status = status; }
}
const NARRATOR_ACTIONS = Object.freeze([
  'narrator.connect', 'narrator.read', 'narrator.snapshot', 'narrator.catalog', 'narrator.invoke',
  'narrator.narrate', 'narrator.status', 'narrator.store_audio', 'narrator.delete_message', 'narrator.edit_message', 'narrator.autopilot_action', 'narrator.finish_global_round', 'narrator.release_floor', 'narrator.set_floor', 'narrator.request_response', 'narrator.answer_ask', 'narrator.end_campaign',
]);
const HEALTH_ACTIONS = new Set(['server.status', 'server.capabilities']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = text => createHash('sha256').update(text, 'utf8').digest();
const matches = (value, expected) => Boolean(value && expected) && timingSafeEqual(digest(value), digest(expected));

/** Credentials and campaign binding are read only from the application environment. */
export function authenticateMcp(request, env = process.env) {
  const operator = env.ODM_MCP_TOKEN?.trim() || '';
  const narrator = env.ODM_MCP_NARRATOR_TOKEN?.trim() || '';
  const campaignId = env.ODM_MCP_NARRATOR_CAMPAIGN_ID?.trim() || '';
  if (!operator && !narrator) throw new McpAccessError('MCP control plane is disabled.', 503);
  // Misconfiguration must not silently turn the restricted credential into admin.
  if (narrator && (narrator.length < 32 || /\s/.test(narrator) || !UUID.test(campaignId) || matches(narrator, operator))) {
    throw new McpAccessError('MCP narrator access is misconfigured.', 503);
  }
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Evaluate both comparisons before choosing a role.
  const isOperator = matches(supplied, operator);
  const isNarrator = matches(supplied, narrator);
  if (isOperator) return Object.freeze({ role: 'operator' });
  if (isNarrator) return Object.freeze({ role: 'narrator', campaignId });
  throw new McpAccessError('Unauthorized.', 401);
}

/** This gate runs before ANY domain handler, not just before MCP tool discovery. */
export function authorizeMcpAction(principal, action, params) {
  if (principal?.role === 'operator') return;
  if (principal?.role !== 'narrator') throw new McpAccessError('Unauthorized.', 401);
  if (HEALTH_ACTIONS.has(action)) return;
  if (!NARRATOR_ACTIONS.includes(action)) throw new McpAccessError('Action is not available to this narrator credential.', 403);
  if (!params || typeof params !== 'object' || Array.isArray(params) || params.campaignId !== principal.campaignId) {
    throw new McpAccessError('This narrator credential is bound to a different campaign.', 403);
  }
}

/** Permit sidecar readiness without returning global counts or another campaign. */
export function narratorServiceResult(principal, action) {
  if (principal?.role !== 'narrator') return undefined;
  if (action === 'server.status') return { ok: true, role: 'narrator', campaignId: principal.campaignId };
  if (action === 'server.capabilities') return {
    role: 'narrator', campaignId: principal.campaignId, actions: [...NARRATOR_ACTIONS],
    note: 'Only this campaign. Game actions still require the narrator domain guards.',
  };
  return undefined;
}
