# External MCP narrator

An MCP-capable client can run the narrator for an ODM campaign without an ODM
LLM. This is a **trusted DM integration**, not a player API: the existing MCP
bearer is an operator-wide credential and is not scoped to a campaign or a
player. Keep it in the MCP client's secure configuration, never in a prompt,
chat transcript, or player browser.

Install ODM with no server model runtime and connect the client to HTTPS MCP:

```bash
sudo bash install-server.sh --domain dnd.example.com --runtime none
```

Configure Streamable HTTP `https://dnd.example.com/mcp` and the bearer value
from `config/mcp.token`. A plain text-only chat cannot call MCP tools or keep a
background game loop; it can only receive manually copied context and produce
text for a person to paste.

## Campaign setup

MCP cannot create users. First create a dedicated DM account and player accounts
through ODM's normal authenticated account flow. Use `odm_campaigns.create`
with the dedicated DM as owner and this `gameSettings` **at creation**:

```json
{"dmMode":"human","ttsEnabled":false,"mapsEnabled":false}
```

Do not enable an active AI cover. Add existing users with `odm_members`, create
library characters with `odm_characters`, instantiate/join them, then use
`odm_campaigns.set_status` with `status: "active"`.

Automatic maps, TTS, narration compaction, and chapter closing are deliberately
off this path because they can call a server model. Maintain chapter summaries
and outlines explicitly when needed.

## Narrator loop

Read `odm://narrator/instructions`, then use `odm_narrator`:

1. `connect` validates the human DM seat and returns a bootstrap snapshot.
2. `read` with `afterSeq` and `limit`; continue with **`nextCursor`** until
   `hasMore` is false. `currentSeq` is distinct from a page cursor.
3. `catalog` lists the audited server-rules actions. AI/image/semantic retrieval
   actions are absent.
4. For exactly one action, call `invoke`, `narrate`, or `release_floor` with
   `expectedSeq` equal to the fully drained cursor/current sequence.
5. Read again after every write, timeout, disconnect, or ambiguous error. Never
   automatically retry a write.

Every external write first persists an argument-free command-attempt event and
therefore consumes the cursor. A stale `expectedSeq` returns `409`; drain and
decide again. The server owns rolls and pending physical-dice resolution. When
a player resolves a pending roll, ODM resumes the human turn; reread before the
next narrator decision. `release_floor` releases the held floor after narration.

There is no exclusive narrator session or lease. Operate one narrator per
campaign by convention and use the cursor protocol to avoid duplicate writes.
The optimistic cursor protects external narrator writes against other external
narrator writes; it does not make an operator's separate human/admin UI write
exclusive.
When the adventure finishes, use the existing `odm_progress` finish/sync
operations as appropriate.

## Copyable client instruction

Paste this into an MCP-capable client's trusted narrator configuration (not a
player chat):

```text
You are the trusted external DM for Open Dungeon Master. Use odm_narrator only
within the operator-confirmed campaign scope. First inspect server capabilities
and existing ODM users; resolve a dedicated DM account separately from player
accounts. Ask the operator to confirm the campaign scope before writes. If no
campaign exists, use odm_campaigns with operation=create and human gameSettings
(dmMode human, ttsEnabled false, mapsEnabled false), then add existing members,
create/instantiate library characters, and use odm_campaigns operation=set_status
to make it active. Use tool help/schema for exact arguments rather than guessing.
First call connect, then repeatedly
call read(afterSeq=nextCursor) until hasMore is false. Treat nextCursor and
currentSeq as different values: write exactly one invoke, narrate, or
release_floor using expectedSeq from the fully drained read. Call catalog before
an unfamiliar rules action. The server owns dice: inspect roll_result events,
recentRolls, and pendingRolls; never invent a roll. After every write, timeout,
disconnect, or error, reread; never automatically retry a write. Narrate only
public table prose and never copy DM outlines, whispers, bearer tokens, provider
keys, or other secrets into player chat. This client runs only while connected;
it is not a background loop: when there are no new intents, stop and await the
user/client scheduler instead of tight polling. On completion use odm_progress
as needed.
```
