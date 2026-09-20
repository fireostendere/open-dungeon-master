# D&D Edition external narrator

Selecting `openai/gpt-5.6-dnd-edition` in `local-role-adapter.mjs` enables the
thin deterministic runtime around the existing authoritative narrator
cursor/receipt protocol. An embedding host may also pass `dndEdition: true`.
Neither path adds a rules engine or alters command idempotency, timeline epochs,
Ask privacy, or server mechanics.

## Operator configuration

Use a campaign-bound narrator token, a restricted empty OpenCode workspace and
the explicit alias `openai/gpt-5.6-dnd-edition` (Sol medium). The adapter rejects
non-OpenAI D&D routes; Sol unavailability is an operational failure, not a
third-party fallback. High is reserved for private/spatial/split/canon work;
max additionally requires a recorded high-reasoning failure and an exceptional
privacy, causality or irreversible-action gate.

Set `ODM_OPENCODE_URL`, `ODM_OPENCODE_TOKEN`, `ODM_OPENCODE_WORKSPACE` and the
campaign-bound control token in the host environment, never in prompts or JSONL.
Optional local RAG must filter exactly by campaign and audience scope. Current
MCP RAG has only the audience scopes supplied by its retriever; it cannot infer
room witnesses, so private retrieval fails closed unless that exact scope is
available.

```sh
export ODM_NARRATOR_ADAPTER_MODULE='file:///opt/odm/repository/narrator/local-role-adapter.mjs'
export ODM_OPENCODE_PROVIDER='openai'
export ODM_OPENCODE_MODEL='gpt-5.6-dnd-edition'
export ODM_OPENCODE_VARIANT='medium'
export ODM_NARRATOR_START_AFTER_SEQ=0
```

Optional `ODM_NARRATOR_RAG_MODULE` must name an operator-installed local
`file:` module exporting `retrieveDndKnowledge`. The host supplies
`campaignId`, normalized query, exact `visibilityScope`, `topK` and
`maxChunks`; results without that same scope are discarded. RAG is capped at
four chunks and 9000 total JSON bytes, cached by campaign/scope/memory revision,
and fails closed when private audience metadata is absent.

Ordinary and combat turns make one narrator call. The first observed scene and
chapter are only a baseline. A later scene change may run one scoped Luna-low
memory update; a later chapter change may also run one Sol-high planner call.
Both outputs are schema/size checked and stored by audience scope.

`/status` requires its status token and exposes only route, campaign, bounded
context/turn estimates, latency, escalation and RAG metadata—not prompts,
whispers, Ask text, secrets or credentials.

Token fields distinguish exact provider usage from explicit byte-based
estimates. A missing provider usage response is never reported as exact zero.
Audience UUIDs are reduced to `public`, `room`, `audience` or `dm` in telemetry.

## Troubleshooting

Timeout, 409, rate and network errors never increase reasoning effort. Read the
authoritative state and replay the one saved commandId/payload once; do not
regenerate a mutation after an ambiguous outcome. Spatial narration uses
`location_narrate` only when the current room audience still equals the input
witnesses. Otherwise it uses `location_perceive` for the original witnesses;
missing room/audience data pauses instead of broadening publication. A
committed spatial narration completes the input and is not regenerated.

Local acceptance is provider-free:

```sh
node --test scripts/test-dnd-edition.mjs
node --experimental-vm-modules --test scripts/test-narrator-orchestration.mjs
node scripts/benchmark-dnd-edition.mjs
```

The benchmark report labels token counts as estimates and leaves provider TTFT,
inference latency and cost unavailable until an explicitly authorized live run.
