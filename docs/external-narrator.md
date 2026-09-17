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

1. `connect` validates the human-DM configuration and returns the current state.
   The sidecar prefixes returned instructions with the canonical player policy.
2. `read(afterSeq, limit)` must be drained using `nextCursor` until `hasMore` is
   false. OOC filtering may leave an empty page but still advance the cursor.
   `currentSeq` is not an intermediate page cursor. `dmPolicy` accompanies these
   sidecar results without rewriting messages, Ask visibility or sequence values.
3. Inspect `catalog`, sheets, encounter, pending physical rolls, roll_result and
   recentRolls. The server owns dice/results; never roll the same event twice.
4. Use the fully drained cursor as `expectedSeq` for one `invoke`, `narrate`, or
   `release_floor`. These story operations persist an argument-free attempt event.
5. Reread after each write, error, timeout or disconnect. Never automatically
   replay an ambiguous mutation. A stale sequence returns 409. `release_floor`
   removes a hold and preserves its inner floor, including initiative.

No exclusive narrator lease is claimed. Use one active narrator per campaign by
operator convention; cursor checks do not make simultaneous separate admin/UI
writes exclusive. Do not tight-poll or claim background activity without an actual
client scheduler.

## Ask is not a story turn

Inspect `asks` on every read even when story sequence is unchanged. The current
read returns the latest 20, not a complete unbounded work queue. Human-mode Ask
initially contains a localized acknowledgement under the existing answered/failed
schema; the external DM replaces it with an answer.

Use `answer_ask` with `campaignId`, `askId`, `answer` (1–4000 trimmed characters),
optional citations (up to 50), and optionally `expectedSeq`. Citations use the
published schema and must be grounded, not invented. The question must belong
to that campaign. A mismatched campaign cannot write the Ask even with its UUID.

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
