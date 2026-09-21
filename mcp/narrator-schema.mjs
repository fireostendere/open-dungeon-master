import * as z from 'zod/v4';

const seq = () => z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sections = z.object(Object.fromEntries(
  ['sheets', 'facts', 'notes', 'npcs', 'recentMessages', 'recentRolls', 'chapters']
    .map(key => [key, z.string().regex(/^[a-f0-9]{64}$/).optional()]),
)).strict();
const readFields = {
  afterSeq: seq().optional(), limit: z.number().int().min(1).max(100).optional(),
  afterAskSeq: seq().optional(), askLimit: z.number().int().min(1).max(50).optional(),
  paged: z.boolean().optional(),
  projection: z.enum(['full', 'live']).optional(),
  maxBytes: z.number().int().min(4096).max(131072).optional(),
  delta: z.boolean().optional(), knownSeq: seq().optional(), knownSections: sections.optional(),
};

// Keep the advertised MCP contract in sync with the strict application API.
// In particular, never let Zod silently strip idempotency or paging fields.
export const narratorInputSchema = z.object({
  operation: z.enum(['connect', 'read', 'snapshot', 'catalog', 'invoke', 'narrate', 'release_floor', 'answer_ask']),
  campaignId: z.string().uuid(), ...readFields,
  pageCursor: z.string().max(500).optional(),
  commandId: z.string().uuid().optional(),
  timelineEpoch: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expectedSeq: seq().optional(), expectedVersion: seq().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  turnId: z.string().uuid().optional(), askId: z.string().uuid().optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  citations: z.array(z.object({
    kind: z.enum(['fact', 'chapter', 'scene', 'summary', 'npc', 'place', 'rule', 'sheet', 'recent']),
    ref: z.string().max(300), quote: z.string().max(2000),
  }).strict()).max(50).optional(),
  sections: z.array(z.enum(['party', 'combat', 'location', 'recent', 'memory', 'npcs'])).max(6).optional(),
  recentLimit: z.number().int().min(1).max(20).optional(),
  knownRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  releaseFloor: z.boolean().optional(),
  completeGlobalRound: z.number().int().min(1).optional()
    .describe('Global-turn host: complete this sealed round atomically with narration.'),
  startGlobalRound: z.number().int().min(1).optional()
    .describe('Global-turn host: start this locked round atomically with narration.'),
  summaryOnly: z.boolean().optional(), category: z.string().optional(), action: z.string().optional(),
  policyMode: z.enum(['full', 'compact']).optional(), includePolicyText: z.boolean().optional(),
  compact: z.boolean().optional(),
  readAfter: z.union([z.boolean(), z.object(readFields).strict()]).optional()
    .describe('Story writes: return a bounded post-commit read with the receipt (default true). Merge verified deltas and drain hasMore/pages before the next write; a read failure never means the write failed.'),
  scopeRoomId: z.string().uuid().optional()
    .describe('Only location_narrate: permit provably unrelated room chat after expectedSeq. Shared-state changes and unknown sequence gaps still conflict.'),
}).strict();
