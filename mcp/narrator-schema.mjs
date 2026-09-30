import * as z from 'zod/v4';

const LOCAL_VOICEOVER = /^(1|true)$/i.test(process.env.ODM_LOCAL_TTS_ENABLED?.trim() || "");
const voiceoverSegments = z.array(z.object({
  speaker: z.enum(["aidar", "baya", "kseniya", "xenia", "eugene"]),
  text: z.string().trim().min(1).max(2000),
}).strict()).min(1).max(24);
// The application re-validates every id; the advertised schema only needs the shape.
// z.uuid()'s RFC regex added ~150 bytes per id field to every narrator request.
const uuid = () => z.string().regex(/^[0-9a-f-]{36}$/i);
const seq = () => z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sections = z.object(Object.fromEntries(
  ['sheets', 'facts', 'notes', 'npcs', 'recentMessages', 'recentRolls', 'chapters']
    .map(key => [key, z.string().regex(/^[a-f0-9]{64}$/).optional()]),
)).strict();
const readFields = {
  afterSeq: seq().optional(), limit: z.number().int().min(1).max(100).optional(),
  afterAskSeq: seq().optional(), askLimit: z.number().int().min(1).max(50).optional(),
  includeAsks: z.boolean().optional().describe('read/readAfter only; omit on connect.'),
  paged: z.boolean().optional(),
  projection: z.enum(['full', 'live']).optional(),
  maxBytes: z.number().int().min(4096).max(131072).optional(),
  delta: z.boolean().optional().describe('read/readAfter only; omit on connect.'), stateDelta: z.boolean().optional(),
  knownStateRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  knownSeq: seq().optional(), knownSections: sections.optional(),
};

// Keep the advertised MCP contract in sync with the strict application API.
// In particular, never let Zod silently strip idempotency or paging fields.
export const narratorInputSchema = z.object({
  operation: z.enum(['connect', 'read', 'snapshot', 'catalog', 'invoke', 'narrate', 'status', 'store_audio', 'delete_message', 'edit_message', 'autopilot_action', 'finish_global_round', 'release_floor', 'set_floor', 'request_response', 'answer_ask', 'end_campaign', ...(LOCAL_VOICEOVER ? ['voiceover'] : [])]),
  campaignId: uuid(), ...readFields,
  pageCursor: z.string().max(500).optional(),
  commandId: uuid().optional(),
  timelineEpoch: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expectedSeq: seq().optional(), expectedVersion: seq().optional(),
  name: z.string().trim().min(1).max(100).optional().describe('invoke only: exact engine action name from catalog, e.g. request_roll. Do not use action for invoke.'),
  args: z.record(z.string(), z.unknown()).optional(),
  content: z.string().trim().min(1).max(24000).optional().describe('Narration, edit_message or autopilot_action text; each operation applies its own tighter limit. Shown verbatim to players: in-world prose and short mechanics lines only, never IDs, seq numbers, tool names, JSON, (ooc) status notes or anything addressed to the operator.'),
  characterId: uuid().optional().describe('autopilot_action only; invoke engine characterId belongs inside args.'),
  messageId: uuid().optional().describe('store_audio only: the DM narration message to attach the generated WAV to.'),
  mimeType: z.literal('audio/wav').optional().describe('store_audio only: generated narration audio is stored as WAV.'),
  audioBase64: z.string().min(4).max(16_777_216).optional().describe('store_audio only: base64-encoded WAV, maximum 12 MiB decoded.'),
  roundNumber: z.number().int().min(1).optional().describe('Global-round number; omit for sequential spotlight autopilot.'),
  mode: z.enum(['start', 'complete', 'open', 'hold', 'spotlight']).optional().describe('finish_global_round: start/complete; set_floor: open/hold/spotlight.'),
  state: z.enum(['idle', 'thinking', 'rolling', 'narrating', 'awaiting_rolls']).optional().describe('status only: current external narrator activity shown to the table.'),
  characterIds: z.array(uuid()).max(12).optional().describe('set_floor spotlight: player character IDs.'),
  prompt: z.string().trim().max(300).optional().describe('set_floor spotlight prompt.'),
  kind: z.literal('do').optional().describe('autopilot_action only; speech belongs inside Do content.'),
  turnId: uuid().optional(), askId: uuid().optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  citations: z.array(z.object({
    kind: z.enum(['fact', 'chapter', 'scene', 'summary', 'npc', 'place', 'rule', 'sheet', 'recent']),
    ref: z.string().max(300), quote: z.string().max(2000),
  }).strict()).max(50).optional(),
  sections: z.array(z.enum(['party', 'combat', 'location', 'recent', 'memory', 'npcs'])).max(6).optional().describe('snapshot only; not a read field.'),
  recentLimit: z.number().int().min(1).max(20).optional(),
  knownRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  releaseFloor: z.boolean().optional(),
  passTurn: z.boolean().optional()
    .describe('narrate only: this is the LAST message about a held combat turn; hand initiative to the next actor. Without it players stay locked.'),
  outcome: z.enum(['victory', 'defeat']).optional()
    .describe('end_campaign only: how the whole campaign ended.'),
  epilogue: z.string().trim().max(12000).optional()
    .describe('end_campaign only: in-world epilogue shown in the finale.'),
  completeGlobalRound: z.number().int().min(1).optional()
    .describe('Global-turn host: complete this sealed round atomically with narration.'),
  startGlobalRound: z.number().int().min(1).optional()
    .describe('Global-turn host: start this locked round atomically with narration.'),
  summaryOnly: z.boolean().optional(), category: z.string().optional(), action: z.string().optional().describe('catalog only: return the schema for this one engine action. invoke uses name instead.'),
  // The application's readAfterSchema is strict; repeating every read field here doubled the schema.
  readAfter: z.union([z.boolean(), z.looseObject({})]).optional()
    .describe('Story writes include a bounded post-commit state by default: consume it instead of another snapshot/read. Pass your cached read cursor/revision for smaller deltas, or false to opt out. Drain hasMore/pages before the next write; readRequired means read again, never repeat the effect.'),
  scopeRoomId: uuid().optional()
    .describe('Only location_narrate: permit provably unrelated room chat after expectedSeq. Shared-state changes and unknown sequence gaps still conflict.'),
  ...(LOCAL_VOICEOVER ? {
    voiceoverSegments: voiceoverSegments.optional()
      .describe('Local Russian speech segments for a just-published public DM narration. Cover the exact narration in order; use one Silero speaker ID per segment.'),
  } : {}),
}).strict();
