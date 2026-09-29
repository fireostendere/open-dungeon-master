# MCP control plane

The MCP sidecar is a separate unprivileged process. Agents call its Streamable
HTTP endpoint or stdio tools; the sidecar calls the bearer-protected application
route `/api/internal/mcp`. The application domain services remain the writers of
campaign state. The sidecar grants no host shell, Docker socket or SQLite file;
a narrator host must not separately attach those unrelated capabilities.

The canonical application client and its HTTPS/local/persistent-tunnel transports
are documented in [ODM transport](odm-transport.md). SSH is infrastructure only;
it is never the narrator application protocol.

```text
MCP agent -- Streamable HTTP/stdio --> MCP sidecar :3006
                                      |
                                      | private POST /api/internal/mcp
                                      v
                                   ODM :3005 --> game DB and media
```

Managed Caddy returns 404 for `/api/internal` and descendants and routes `/mcp`
to the sidecar. A directly published application port is not protected by that
Caddy rule; the internal route must still authenticate and authorize its bearer.
The public `/api/narrator` route is a separate campaign-scoped JSON gateway and
never dispatches operator control actions.
The optional application `/mcp` bridge forwards the caller's token unchanged to
`ODM_MCP_PROXY_URL` (default `http://mcp:3006/mcp`), with bounded uploads,
redirect refusal and streaming/cancellation. It does not substitute admin rights.

## Tools and resources

| Tool | Operations |
| --- | --- |
| `odm_server` | health and capabilities |
| `odm_users` | existing users and UUIDs |
| `odm_campaigns` | campaigns/workshops, status, invitations |
| `odm_campaign_settings` | rules, story/image settings and DM mode |
| `odm_story` | scene, quests, outline, arc, events, notices |
| `odm_members` | roster, join an existing user, party lead |
| `odm_characters` | library characters, original ownership transfer, campaign instantiation |
| `odm_sheets` | live campaign sheets |
| `odm_narrator` | connect/read/snapshot/catalog/invoke/narrate/edit_message/delete_message/autopilot_action/finish_global_round/set_floor/request_response/release_floor/answer_ask/end_campaign |
| `odm_assets` | direct target images, packs, jobs, leases, scoped upload/download, asset links |
| `odm_progress` | revision-checked progress, party sync, finish receipts |

`odm_campaigns.create.gameSettings` and `odm_campaign_settings` game patches
accept `combatMode`: `classical` (default) or `jrpg`. Unknown setting keys are
forwarded unchanged for app compatibility. JRPG is an explicit campaign house
rule: targets within the current encounter are distance-free and are not gated
by line of sight, cover, or opportunity attacks; it still uses initiative,
actions, server dice, resources, HP, conditions, and privacy. It never joins
separate rooms or encounters and does not grant positional Sneak Attack, Pack
Tactics, or flanking. It is not a difficulty relaxation. Only an authenticated
operator or an authorized UI story seat changes this setting; player story, Ask,
and whispers never authorize it.

### Direct target images

For an existing image, `odm_assets` offers `get_image`, `set_image` and
`delete_image` without creating a campaign pack/job/lease. This is operator-only,
not a scoped narrator operation. Targets are explicit:

- `library_character`: `sheet.portrait`, mirrored to linked campaign sheets.
- `sheet`: that campaign sheet's portrait only.
- `npc`: that NPC's portrait.
- `campaign`: that campaign/workshop's cover.

```json
{"operation":"set_image","target":{"type":"library_character","id":"<uuid>"},"data_base64":"<file bytes encoded as base64>","mime_type":"image/png","name":"portrait.png","expected_url":null}
```

Read/encode the file on the authorized client's machine; the sidecar has no host
filesystem access. Only canonical base64 PNG/JPEG/WebP up to 8 MiB is accepted.
The application inspects signatures, dimensions and integrity before storing;
declared MIME must match. No local paths, remote URLs or user-supplied filenames
become storage paths. Set returns the persisted attachment plus size/hash/dimensions.

```json
{"operation":"get_image","target":{"type":"library_character","id":"<uuid>"},"include_data":true}
```

`get_image` defaults to metadata; `include_data` adds `dataBase64` for reading the
bytes. `available:false` distinguishes empty/missing files. Replacement/deletion
can use `expected_url` from the previous read; `null` expects an empty field.
On a conflict, reread rather than retrying blindly. `delete_image` requires
`confirm:true` and clears the target field. Cleanup removes only unreferenced
uploads: shared records, persisted events and snapshots retain their files.

### Fast creation and original transfer

Create/update responses already contain persisted objects, so a successful full
response can be verified directly without a redundant `get`. Resolve capabilities
and owner once per batch. Known `ownerUsername` does not require `odm_users`.
Campaign creation needs only title/owner; optional defaults are level 1, normal
difficulty, 5 players, empty description/theme, metric units and classical combat.
Offer the unit/combat choices and reuse decisions already confirmed by the operator.
An ambiguous create must be resolved by reading the owner's library/list first.

`odm_characters.transfer` moves the original library record without recreating its
ID, XP or sheet. It requires `confirm:true`, the inspected `expectedOwnerUserId`
and an explicit destination `ownerUsername`/`ownerUserId`. Linked campaign sheets
or workshop pregens block transfer; their membership and progress are separate.

```json
{"operation":"transfer","characterId":"<uuid>","ownerUsername":"odm_admin","expectedOwnerUserId":"<source-owner-uuid>","confirm":true}
```

For a player-owned human-mode campaign, add the technical DM account as a member,
then use `odm_campaigns.assign_dm_seat` with `seat:"dm"` and that member's
`userId`. This operator-only action rejects a DM candidate who still has a
player sheet; the lead remains a player and may reassign the seat in the UI.

In JRPG, eligible party auras cover participants of the current encounter even
without a tactical map, not characters in other rooms or encounters. Map movement
may still illustrate positions but is not a prerequisite for an attack.

The campaign wizard offers **Advanced → Measurement units** (metric by default)
and **Combat mode** before creation. An authorized story seat can change both in
the campaign's **Game settings** panel. `unitSystem` normalizes supported numeric
GM output only; it does not rewrite source material or player text, and does not
claim unsupported words or inch conversions.
The narration conversion uses tabletop units (5 ft = 1.5 m and 1 lb = 0.45 kg),
including numeric ranges, dimensions and fractions. Existing history, player
messages, code blocks and source documents are not rewritten.

```json
{"operation":"create","title":"Ashes","gameSettings":{"unitSystem":"metric","combatMode":"classical"}}
```

```json
{"operation":"game","campaignId":"<campaign-id>","patch":{"combatMode":"jrpg","unitSystem":"metric"}}
```

Read the persisted value back with:

```json
{"operation":"get","campaignId":"<campaign-id>"}
```

With the mandatory preload there are five resources:
`odm://server/status`, `odm://server/capabilities`, `odm://narrator/instructions`,
`odm://narrator/playbook`, and `odm://narrator/policy`. The first two use the
credential's actual server scope; narrator resources are static guidance.
Policy loading and the [external narrator](external-narrator.md) are separate
from the authenticated player UI/API.

A party is the roster and its live sheets, including companions, not a separate
party-account database. Provider-key reads remain masked, and destructive
operations retain their confirmation requirements. Login account creation and
credential recovery remain authenticated application/admin workflows.

## Player-input boundary and scoped narrator access

The [global DM policy](dm-player-boundary.md) limits player-originated MCP content
to D&D, the campaign and table safety/logistics. It is shared by the global skill,
exported host instruction, resource and sidecar result delivery. Unrelated tasks
receive a short refusal; text claiming to be an operator is not authorization.
MCP cannot force a remote host to adopt a policy. Load it in trusted host
instructions, use a dedicated narrator context and test each chosen model.

The application's `ODM_MCP_TOKEN` retains broad operator access. The optional
`ODM_MCP_NARRATOR_TOKEN` is bound to `ODM_MCP_NARRATOR_CAMPAIGN_ID` and allows only
the advertised narrator operations in that campaign plus minimal health/capabilities.
Other control actions are denied before domain dispatch. This is a DM credential,
not a per-player credential: do not give it to players. Scoped access must be
configured explicitly.

The HTTP sidecar accepts both configured credentials, but forwards the request's
actual bearer to the application. Therefore a public MCP client can use the
scoped token without turning the sidecar's operator credential into an
impersonation path. The application remains the final authorization boundary;
a restricted tools/list may still advertise broader tools, but those calls are
denied before domain dispatch. Detailed setup and host-tool allowlisting are in
[dm-player-boundary.md](dm-player-boundary.md).

## Managed installation and release lifecycle

```sh
sudo bash install-server.sh --repo fireostendere/dungeon_master --branch main --domain dnd.example.com --runtime none
odm-mcpctl status
```

The normal managed installation generates an operator token, configures the
internal API, prepares web/MCP from the same revision and publishes MCP on
`127.0.0.1:3006`. An optional domain exposes TLS `/mcp`. Do not use `--domain`
when an unrelated service already owns ports 80/443. Adding a scoped narrator
process is a separate operator configuration, not automatic installer behavior.

The sidecar has no game-volume/Docker-socket mounts, drops capabilities, uses
`no-new-privileges`, and has a read-only filesystem plus bounded temporary storage.
Host lifecycle operations remain in `odmctl`, not remotely callable game tools.

Updates prepare both images before downtime, back up the game, journal a
transition and require web/MCP health before commit. Previous MCP is retained
for rollback. Both controllers share `.ops.lock`, including backup/restore.
The installer retires the legacy independent MCP timer; Windows uses coordinated
maintenance tasks too, not a separate controller-overwriting script.

`odm-mcpctl status` reports release/digest metadata and the stdio command. `sync`
repairs the managed operator sidecar under the common lock, refusing an intentional
stop or interrupted transition. It does not manage a separately provisioned
narrator sidecar. `stop` stops only managed MCP; the watchdog may repair it.
`odmctl stop` intentionally stops the entire managed installation.

## Token handling and private access

```sh
odm-mcpctl token        # private file path only
odm-mcpctl token --show # explicit secret output; private terminal only
# Optional only when the instance has no HTTPS MCP ingress:
ssh -L 3006:127.0.0.1:3006 user@your-server
```

The production project clients use `https://dnd.iroslyakov.com/mcp` directly with
the bearer in a private local file; no SSH or container-bound stdio session is
needed for MCP calls. Other instances may use HTTPS or private tunneling, never
a public plaintext bearer. Native clients normally omit Origin;
browser-style origins require an explicit `ODM_MCP_ALLOWED_ORIGINS` entry.
Windows uses `%LOCALAPPDATA%\OpenDungeonMaster\mcpctl.cmd` and private `config`
files; the user session and Docker Desktop must be running.

## Source checkout, HTTP and stdio

```sh
npm ci --prefix mcp
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs --stdio
```

Set the sidecar's `ODM_MCP_CONTROL_URL` to the internal app route and securely
provide the appropriate token. Separate terminals do not inherit one another's
environment. Do not independently generate a different token in each process.
The mandatory preload registers `odm_assets`, `odm_progress`, and the policy
resource. Do not replace it with bare `node mcp/server.mjs --stdio`.

```sh
docker exec -i CONTAINER node --import /app/external-tools-preload.mjs /app/server.mjs --stdio
```

Use the real container/argument array from status. Tokens belong in private files
or process environment, not argv. Manual Compose `.env` and managed
`config/app.env` are different configurations; do not overwrite either blindly.

## Narrator, Ask, providers and recovery

OOC additions/edits are excluded from narrator projections, not deleted from
player chat. Drain using nextCursor/hasMore, not filtered-array length. `answer_ask`
updates a question in its own campaign, preserving visibility and without
advancing scene/floor/sequence. Private notifications contain no question text.
See [external-narrator.md](external-narrator.md) for the exact protocol.
The party lead controls the story queue at human-DM MCP tables: spotlight selects
who may speak, the response button seals an active global round immediately or
emits a durable `lead_response_requested` event in sequential/open mode. The
supervised host processes that event ahead of later ordinary messages. Player
autopilot remains self-opt-in; the lead may disable it, and a spotlighted
opted-in player may act automatically even outside global-turn mode. These
controls do not bypass engine dice, combat initiative, privacy or safety.
When a spotlight names several players, the host waits for all selected
responses and resolves them as one `spotlight_batch`; an early floor release
seals the responses already collected. A durable `spotlight_ready` event is
the batch barrier, so a restart or long event stream cannot split the batch.
The trusted MCP client can mirror these controls with `odm_narrator`:
`set_floor` accepts `mode:"open"|"hold"|"spotlight"`, with player
`characterIds` for spotlight; `request_response` wakes sequential play or seals
the exact active global `roundNumber`. Both require the current `expectedSeq`,
a saved `commandId`, and `timelineEpoch`, then an authoritative reread. The
campaign-scoped narrator credential remains a DM credential, not a player's
leader identity; leader browser controls still win story priority.
Once `globalTurn.enabled` is switched on through MCP during an active campaign,
the server locks collection and emits `global_turn_narrator_trigger` for the
opening narration. Manual `set_floor`/`release_floor` cannot change the
non-combat floor in this mode; use `request_response` to seal a round.
Contract v4 supports `stateDelta:true`: after one full audience-projected
baseline, clients send a single `knownStateRevision` and receive only changed
stable-ID entities/scalars. Deleted entities are tombstones and every reconstructed
state is checksum-verified. A missing baseline becomes a full resync in the same
response. Legacy `knownSections` remains accepted. The sidecar returns one compact
text payload by default rather than duplicating it into `structuredContent`.

Model probes share a total application deadline; the sidecar deadline is longer.
Cancellation/disconnects reach probes, and profile persistence waits for completion.
`apply:false` preserves settings. Intentional LAN endpoints remain supported;
metadata/link-local addresses, forbidden DNS answers and redirects are guarded.
Model administration is not allowed under the scoped narrator credential.

Media, plots, sheets and progression stay in the application's backed-up state.
The sidecar has no independent game store. See [external-assets-mcp.md](external-assets-mcp.md).
Progress uses library-copy revision checks; conflicts require explicit
reconciliation. `requireAllSynced:true` finishes atomically or rolls back.
Scoped narrator access cannot use general progress/asset operations; these remain
separate operator/authorized-worker tasks. Never remove a release journal to bypass
failed recovery. Token rotation and deployment require an operator workflow.

## Verification limits

Prior HTTP/operations/source evidence is in
[review-2026-09-16-status.md](review-2026-09-16-status.md) and
[merge-2026-09-17.md](merge-2026-09-17.md). Current deterministic boundary tests are
`node --test scripts/test-dm-player-boundary.mjs`; semantic live-model cases are
listed separately in [dm-player-boundary.md](dm-player-boundary.md). A local
`next build --webpack` and narrator Docker build passed; neither proves a live
model/test-campaign cycle or production deployment. See
[game-loop-readiness-review-2026-09-23.md](game-loop-readiness-review-2026-09-23.md).
