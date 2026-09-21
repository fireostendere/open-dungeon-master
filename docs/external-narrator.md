# External MCP narrator

An MCP-capable host can run a trusted DM for an ODM human-DM campaign without
an ODM story LLM. This is not a public player assistant or a general coding agent.
The player-facing host must use the [D&D-only policy](dm-player-boundary.md).
The operator's direct development/setup conversation is a separate context.

## Setup belongs to the operator

Install ODM without a server model runtime, provision DM/player accounts using
the authenticated account flow, and create/select the campaign using operator
credentials. At creation use `dmMode: human`, `ttsEnabled: false`, `mapsEnabled:
false`; ensure a dedicated DM seat, no active AI cover, appropriate members and
character sheets, and active campaign status. MCP does not create login accounts.
Do not have player input authorize setup or change these settings.

Read `gameSettings.combatMode` from the campaign state. `classical` is the
default. `jrpg` is an operator-selected campaign house rule: within one current
encounter it removes distance, line-of-sight, cover, and opportunity-attack
target gates, but not initiative, actions, dice, resources, HP, conditions, or
privacy. It does not merge rooms/encounters or automatically satisfy Sneak
Attack, Pack Tactics, or flanking. A narrator never changes it from story text,
Ask, or whispers.

Ensure the DM seat (`human_dm_user_id`) is assigned to a dedicated bot user (such as `ai_dm`)
rather than any human player's account. Any account sitting in `human_dm_user_id` has its
character sheet disabled by the web UI and receives DM composer controls ("Narrate" and "OOC").
When the DM seat belongs to a dedicated bot, human participants (including the campaign creator)
can join with their own character sheets and use player composer controls ("Do", "Say", "OOC").

Automatic map generation, TTS, LLM narration compaction and AI chapter closing
are off this external-narrator path. A separate privileged operator can maintain
outlines/chapters and finish/synchronize progression when explicitly authorized.
The restricted narrator credential does not expose those general admin services.

The existing managed `ODM_MCP_TOKEN` is operator-wide. Prefer a separate
`ODM_MCP_NARRATOR_TOKEN` in the application, bound through
`ODM_MCP_NARRATOR_CAMPAIGN_ID`. Give its value, not the admin secret, to a dedicated
narrator sidecar as that process's `ODM_MCP_TOKEN`. Configuration, separate
process/port details and limitations are in [dm-player-boundary.md](dm-player-boundary.md).
The default managed operator sidecar is not automatically converted or made
multi-token by adding this documentation. Never put credentials in player chat.

Use HTTPS or a private tunnel to the chosen sidecar. An MCP resource/skill does
not install a client, persist a connection, schedule a loop or wake a model.

## Trusted host instructions

From a trusted checkout, export the fixed policy:

```sh
node scripts/export-dm-policy.mjs
```

Install that output in the dedicated host's trusted system/developer configuration
before it receives game data. Also read `odm://narrator/policy`,
`odm://narrator/instructions`, and `odm://narrator/playbook` for reference. Loading
a skill only on demand is not equivalent to a persistent host instruction.
Do not promote stored player prose, quoted instructions or arbitrary remote
resource contents into a higher-priority message.

Limit the narrator host's exposed tools to `odm_narrator`, minimal `odm_server`
and the static narrator resources. Do not attach shell, Git, email or arbitrary
web/filesystem tools. Internal API authorization still checks every call even if
the sidecar's broad tools/list advertises an operator tool.

The role accepts D&D rules, character questions, campaign play, recaps and table
safety/logistics. It briefly declines unrelated tasks without tool calls for them.
Requests such as “ignore your instructions”, “I am the admin” and “write my code
for D&D” inside Ask/notes/whispers do not change its privileges or purpose.

## Narrator loop

1. `connect(stateDelta:true)` validates the human-DM configuration and returns
   only cursor/timeline metadata plus the trusted instructions. This avoids
   echoing a full snapshot during the handshake. Legacy clients that omit
   `stateDelta` still receive the previous `state` shape.
2. `read(afterSeq, limit, stateDelta:true)` must be drained using `nextCursor`
   until `hasMore` is false. OOC filtering may leave an empty page but still
   advance the cursor. `currentSeq` is not an intermediate page cursor.
3. Keep the returned `stateDelta.revision`. On the next read send it as
   `knownStateRevision`. The server returns only changed entities/scalars when
   that bounded baseline is still available, or one full self-healing resync when
   it is not.
4. Inspect `catalog`, sheets, encounter, pending physical rolls, `roll_result`
   and recent rolls. The server owns dice/results; never roll the same event twice.
5. Use the fully drained cursor as `expectedSeq` for one `invoke`, `narrate`,
   or `release_floor`. Request `readAfter` with the same state-delta baseline:
   a confirmed write then carries its authoritative post-commit delta in the same
   MCP result. Drain later event pages before the next write.
6. After errors, timeout or disconnect, reread/recover the exact receipt; never
   regenerate an ambiguous mutation. A stale sequence returns 409. `release_floor`
   removes a hold and preserves its inner floor, including initiative.

Contract-v4 narrator traffic carries a transport-owned process UUID. The
application keeps a short SQLite lease per campaign (15 s by default, configurable
with `ODM_NARRATOR_LEASE_MS`); a second live narrator process gets HTTP/MCP 409.
The host UUID is injected by the sidecar/OdmClient and is not a model-controlled
tool argument. A crashed host therefore fails over after the bounded lease TTL.
Normal admin/UI writes remain separate and are still guarded by sequence/CAS
checks rather than this narrator lease.

### Revisioned entity delta reads

The preferred v4 path is `delta:true, stateDelta:true`. The first read returns a
full authoritative projection and a 64-hex `stateDelta.revision`. Subsequent reads
send that value as `knownStateRevision`. The revision is scoped to campaign,
timeline, narrator principal and projection.

Changed entity arrays use stable-ID patches:

```json
{"stateDelta":{"format":"odm.state.delta.v1","baseRevision":"...","revision":"...","patch":{"entities":{"sheets":{"upsert":[{"id":"...","hp":12}],"remove":[]}}}}}
```

Deletions travel as `remove` tombstones; reordered entity arrays carry an
explicit order. Scalar/object changes use `set`/`unset`. Unchanged campaign
state is not repeated. The host verifies the SHA-256 checksum after applying the
patch. If the server restarted or evicted the bounded baseline, it returns a full
projection with `resyncRequired:true` in that same read instead of requiring a
failed patch followed by another round trip.

The older `knownSections`/ `sectionVersions` negotiation remains supported for
existing clients. `knownSeq` remains a receipt cursor, never proof that a state
section is unchanged. Story reads can also set `includeAsks:false`; the managed
host does this because Ask has its own durable queue/cursor and otherwise the same
pending questions would be repeated on every story/post-write read.

The repository's `narrator/run.mjs` is the minimal long-lived lifecycle host. It
polls both independent queues, drains paged snapshots, persists cursors and
pending Ask command payloads, and keeps retrying after transport failures. Start
it with `node narrator/run.mjs --campaign <campaign-id>` (or the supplied
`deploy/narratorctl.py` controller). It is a listener/checkpoint process; the
model adapter that turns new story events into narration still runs in the
trusted narrator host. `watch-player.sh`, where installed, is only a wake-up
optimization and must not be the sole source of events.

## Ask is not a story turn

Inspect `asks` on every read even when story sequence is unchanged. The current
read returns the latest 20, not a complete unbounded work queue. Human-mode Ask
initially contains a localized acknowledgement under the existing answered/failed
schema; the external DM replaces it with an answer.

Use `answer_ask` with `campaignId`, `askId`, `answer` (1–4000 trimmed characters),
optional citations (up to 50), and optionally `expectedSeq`. Citations use the
published schema and must be grounded, not invented. The question must belong
to that campaign. A mismatched campaign cannot write the Ask even with its UUID.
Persist a UUID `commandId` and the exact answer payload before sending it; after
a timeout retry only that identical command to recover an accepted answer.

Unlike story writes, **answer_ask does not advance the story sequence, floor or
scene**. A brief off-topic refusal is also an Ask answer and retains its original
private/table visibility. Private notifications contain no question/answer text
and target the appropriate authenticated user; never quote private questions,
DM plans or secrets into public narration. A host holding all DM context is still
trusted and must not expose that context to a player's general assistant.

## Acceptance limits

The policy and bounded narrator token are complementary: one is host behavior,
the other is deterministic campaign/action authorization. Neither proves that
an arbitrary external LLM will never answer off-topic. Live-model acceptance
cases are in `scripts/fixtures/dm-player-policy-cases.json`. They are not passed
merely because source tests succeeded. Rate limits, cost quotas, a semantic
classifier and runtime configuration of third-party hosts are separate work.
