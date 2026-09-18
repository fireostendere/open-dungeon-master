// Pure tool descriptors shared by the page and executable adapter tests.
// The agent owns a stable requestId and (for IC) an explicit room/revision.
// Repeating identical tool arguments therefore repeats exactly one intent,
// including after remount: never fetch a new revision during an ambiguous retry.
const uuid = { type: 'string', format: 'uuid' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function locationWebTools({ campaignId, userId, signal, fetchImpl = globalThis.fetch }) {
  const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
  const request = async (suffix = '', options = {}) => {
    signal.throwIfAborted();
    const response = await fetchImpl(endpoint + suffix, { ...options, cache: 'no-store', signal,
      headers: { 'X-ODM-Actor': userId, ...options.headers } });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok) throw new Error(body?.error || 'Location request failed.');
    return body;
  };
  return [
    { name: 'odm_list_visible_locations', title: 'List visible locations',
      description: 'List locations and the current room/revision authorized for this signed-in player.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => request() },
    { name: 'odm_read_location_history', title: 'Read authorized location history',
      description: 'Read only witnessed messages. Use roomId=ooc for global table talk.',
      inputSchema: { type: 'object', properties: { roomId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['roomId'], additionalProperties: false },
      execute: ({ roomId }) => {
        if (roomId !== 'ooc' && !uuidPattern.test(String(roomId))) throw new Error('Invalid room ID.');
        return request(`?roomId=${encodeURIComponent(roomId)}`);
      } },
    { name: 'odm_send_location_message', title: 'Send an authorized location message',
      description: 'Persist a UUID requestId before sending. On an ambiguous error repeat identical arguments and the same ID; never generate a replacement ID for that intent. For say/do first read the current roomId/revision and pass both explicitly. OOC is global. No DM powers.',
      inputSchema: {
        type: 'object', properties: { requestId: uuid, roomId: { type: ['string', 'null'], format: 'uuid' },
          expectedRevision: { type: 'integer', minimum: 1 }, kind: { type: 'string', enum: ['say', 'do', 'ooc'] },
          content: { type: 'string', minLength: 1, maxLength: 2000 } },
        required: ['requestId', 'kind', 'content'], additionalProperties: false,
        oneOf: [ { properties: { kind: { const: 'ooc' }, roomId: { type: 'null' } } },
          { properties: { kind: { enum: ['say', 'do'] }, roomId: uuid }, required: ['roomId', 'expectedRevision'] } ],
      },
      execute: input => {
        if (Object.keys(input).some(key => !['requestId', 'roomId', 'expectedRevision', 'kind', 'content'].includes(key))) throw new Error('Unknown message argument.');
        if (!uuidPattern.test(String(input.requestId)) || !['say', 'do', 'ooc'].includes(input.kind) ||
            typeof input.content !== 'string' || !input.content.trim() || input.content.length > 2000) throw new Error('Invalid message arguments.');
        if (input.kind !== 'ooc' && (!uuidPattern.test(String(input.roomId)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
          throw new Error('Read the current roomId/revision first, then send both explicitly.');
        }
        if (input.kind === 'ooc' && input.roomId != null) throw new Error('OOC does not belong to a room.');
        return request('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'send', requestId: input.requestId, roomId: input.kind === 'ooc' ? null : input.roomId,
            kind: input.kind, content: input.content, ...(input.kind === 'ooc' ? {} : { expectedRevision: input.expectedRevision }) }) });
      } },
  ];
}
