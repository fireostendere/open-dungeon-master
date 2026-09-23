# Location-scoped text chats

## Status and boundaries

This is an opt-in text-scene feature for **human-DM campaigns, including an external MCP narrator occupying the DM seat**. It does not start an embedded AI narrator and does not enable AI cover. The existing table remains unchanged until the DM enables location chats.

**It is not complete spatial isolation of every game system.** The existing combat/initiative engine, dice projections, maps, facts, shared notes, voice and other legacy campaign UI remain campaign-wide. Those are explicitly identified as shared in the interface. Do not put private scene information into shared mechanical descriptions, public Ask answers or shared notes. Independent simultaneous combats, scene-scoped voice and automatic embedded-AI scene orchestration are not implemented. The player TUI has not been adapted to this mode. A full multi-browser acceptance pass is required before treating the feature as production-ready.

## Player behavior

Each location is a separate tab. A player's first arrival creates the tab but grants **no old messages**. A message's recipients are recorded when it is written. Leaving preserves already witnessed messages and stops delivery of future ones. Returning never fills the absence gap. Entering a tab is not a movement action: use an available passage or ask the DM to move the character.

Normal speech does not cross a room boundary, even if that boundary carries sound. A DM-adjudicated `speech` observation grants **future speech only**, not silent actions or visual narration. A `scry` observation grants future scene messages. Both require an explicit reason and expire after 1–3600 real-time seconds. Moving the observer revokes their grants; closing a sound path revokes physical eavesdropping across it. The DM must also revoke a grant when its fictional conditions or concentration end. Previously heard material remains in the archive.

`perceive` sends a separately authored fragment to specified players. `propagate` sends a separately authored sound/sight incident to occupants of directly connected rooms, one hop only. Neither copies the source transcript or unlocks its history. A fire can therefore be described to people outside without disclosing the conversation inside.

**OOC is one global channel.** It is not included in the narrator's in-character feed and requires neither a character position nor an open story turn. Location speech/actions are intents and do not advance the shared initiative engine. Player movement during an active encounter requires DM adjudication.

There is no automatic end-of-game history reveal. The DM can read all scenes; a party lead who is a player does not gain that authority.

## Enabling and running it

In the web session, the actual DM can choose **Enable location chats** beneath the ordinary composer. This creates a starting room and places the current player seats there. The DM's location controls create rooms and passages, move subgroups, grant/revoke observation and deliver perceived incidents. Players joining later must be placed by the DM.

The new UI has English, Russian and Polish copy. The original table widgets, dice controls and shared history remain in a separate shared-mechanics panel. Ask uses the chat composer; public questions and answers appear in global OOC, while private exchanges stay visible only to their author. New location prose never enters that public transcript. An old client attempting an unscoped in-character POST receives 409 instead of accidentally broadcasting its scene. Legacy OOC sends are routed to the new global OOC ledger.

### External MCP narrator

No additional administrator credential or MCP tool family is required. Continue using `odm_narrator` / `narrator.connect`, `narrator.read`, `narrator.catalog`, and `narrator.invoke`.

`narrator.read` includes location messages in its ordered `messages` array, marked with `channel: "location"`, `roomId`, `kind` and **DM-only** `witnessUserIds`. Room state and observation grants are returned as the separately pageable `spatialRooms` and `spatialGrants` arrays. `spatial.instructions` explains audience-aware narration. Public browser projections never return witness lists.

The catalog exposes these invoke names:

| Name | Arguments in `args` |
| --- | --- |
| `location_enable` | `name` |
| `location_create_room` | `name`, optional `connectTo`, `walkable`, `sound`, `sight` |
| `location_link` | `sourceId`, `targetId`, optional `walkable`, `sound`, `sight` |
| `location_move` | `roomId`, `userIds` (player **user** UUIDs) |
| `location_narrate` | `roomId`, `content` |
| `location_observe` | `roomId`, `userId`, `mode: "speech" | "scry"`, `seconds`, `reason` |
| `location_revoke` | `grantId` |
| `location_propagate` | `roomId`, `medium: "sound" | "sight"`, `content` |
| `location_perceive` | `roomId`, `userIds`, `content` |

Example control request (replace placeholders with IDs from the current catalog/read):

```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign UUID>",
    "expectedSeq": 123,
    "commandId": "<persisted fresh UUID>",
    "name": "location_narrate",
    "args": {
      "roomId": "<tavern UUID>",
      "content": "The innkeeper lowers his voice and points toward the cellar."
    }
  }
}
```

Drain reads to `hasMore: false`, use the drained `currentSeq` for one write, and reread afterward. `projection: "live"` avoids historical duplicate sections. The normal byte-budgeted paging contract also covers location data. Both the public-event ledger and the private-message ledger constrain cursor advancement, so a busy room cannot be skipped when no corresponding public SSE event exists.

Commands retain the existing narrator queue, compare-and-set cursor and durable command receipts. Retry an ambiguous write only with the same command UUID, expected sequence and exact payload. Narrator receipts return message IDs, not another copy of the prose. Unscoped `narrator.narrate` is refused after enablement: use `location_narrate`.

The narrator must not recap unwitnessed scenes to arrivals or use omniscient knowledge in public answers. Checks, resources and spell slots are adjudicated with the rules engine before granting perception; a grant is not itself a rules-engine spell cast.

## Storage and privacy

Nine additive `spatial_*` tables store mode, rooms, passages, current presence, retained visits, messages, write-time receipts, observation grants and command receipts. Initialization is idempotent on the existing SQLite driver. HTTP and MCP both resolve current campaign membership and the real DM seat on the server. Client-supplied actor, role and audience fields are not accepted.

A player history query checks receipts **before** pagination. Room entry grants no retrospective access; membership restoration likewise does not create receipts for the period of absence. Cross-campaign IDs fail closed. Author deletion keeps the message with a null author; campaign deletion cascades through all spatial tables.

The browser polls authenticated, `private, no-store` views, with conditional ETags derived only from that viewer's permitted projection. It does not subscribe to a room-wide/global stream containing private text. An archived tab exposes no current remote roster or activity counter. Requests are aborted on tab changes, old pages are replaced rather than merged across timelines, and stale room/revision sends receive 409. Ambiguous writes retain their UUID for manual retry; no private transcript is stored in localStorage.

Full SQLite backups include these tables. Chapter-boundary and pre-rewind snapshots now capture and restore them too, including audiences and idempotency records. Restoring a pre-feature chapter snapshot clears/disables location mode rather than retaining future access grants.

Limits: 128 locations per campaign, 256 active observation grants, 100 messages per page, 2000 characters for player/OOC/perception text, 8000 for DM narration, and 40 KB per HTTP command body. All times in observation grants are real-time, not game rounds.

## Verification

Executed in the implementation environment:

```sh
node --test scripts/test-spatial-chat.mjs scripts/test-spatial-snapshot.mjs
```

**27 tests passed** using real in-memory SQLite. These cover entry/exit/reentry, unseen gaps, global OOC, sound and sight incidents, eavesdropping/magic, expiry/revocation/closed windows, stale tabs, actor/campaign boundaries, hidden activity, paging, atomic batch movement, retry persistence, deleted users, snapshot rollback and merged narrator cursor progression.

Executed in the implementation environment:

```sh
node --experimental-vm-modules scripts/test-spatial-integration.mjs
npm test
npx tsc --noEmit
npm run lint
npm run build
```

The spatial integration suite passed, `npx tsc --noEmit` passed and `npm run lint` passed with seven warnings. The full `npm test` run is currently stopped by the unrelated asset-claim race assertion in `scripts/test-asset-claim-concurrency.mjs`; `npm run build` is blocked in this sandbox by Next/Turbopack's attempt to bind a worker port. The integration suite uses the real application database and narrator dispatcher, blocks provider/network calls, tests failed-first-write schema recovery, private message delivery in normal MCP reads, durable retries, OOC exclusion, and refusal of unscoped narration. It is automatically discovered by `scripts/test-all.mjs`.

The dedicated completion matrix, exact command results and remaining mechanical-view/browser blockers are in [location-privacy-acceptance.md](./location-privacy-acceptance.md).

### Required browser acceptance

Use independent accounts and browser contexts for DM, A and B (not three tabs sharing one login). Verify: A enters the tavern and writes a secret; B cannot retrieve it by API or by entering later; both hear a subsequent sentence; B leaves and retains only witnessed history; A writes while B is away; B returns without the gap. Repeat after a reload/reconnect and after a chapter rewind. Grant and revoke a window observation, test a magic grant, and deliver an explosion summary outside. Check that OOC reaches both rooms and that a stale tab cannot post to its old room. Inspect responses for private text, not just the rendered UI. Audit the explicitly shared legacy mechanical views before expanding the privacy guarantee beyond location-chat prose.
