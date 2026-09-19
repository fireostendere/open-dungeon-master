# Location privacy: implementation and acceptance status

Updated 2026-09-19. Work branch: `feat/location-scoped-chat`.

**Overall status: PARTIAL. Do not merge or deploy as completed spatial privacy.**
The baseline review was against `7ea2344`; its merged equivalent was `9aea3a7`.
The changes below are actual follow-up implementations, not a statement that all
old mechanical paths have been converted. Earlier typecheck/lint/build claims in
this document described another environment and do not validate this HEAD.

## Published milestones

| Commit | Scope |
| --- | --- |
| `26da80f` | Audience-bearing narrator summary records, legacy checkpoint migration, repeat-read deduplication and scoped memory. |
| `cead454` | Stable browser/WebMCP intents, identity-bound retries, expected-actor checks and registration status. |
| `1b335e2` | Immutable per-recipient SSE views, live/replay projection, membership/role rechecks and discarded-timeline protection. |
| `5fb1e1e` | Complete byte/story draining, partial-drain rollback, verified cursor-ahead recovery; collector no longer invents Ask answers. |
| `f354e67` | Real note CRUD/API integration with observed versions, local note UI and note-event audience capture. |

A subsequent hardening change removes the assumption that the author of an active
shared location note should receive all future edits while absent. Authorship is
not a remote subscription or permission to obtain the latest version with an
empty PATCH. Private personal journals and explicitly global notes retain their
different contracts.

## What is implemented and how far it is verified

| Review | Implemented work | Remaining acceptance / integration |
| --- | --- | --- |
| R01 | Audience captured transactionally with the original event; live and replay use saved wire views; current membership/DM role checked at delivery; hidden entries advance a contentless cursor; discarded-timeline buffers are rejected. | Every remaining mechanical writer still needs an explicit scene scope. Unknown unscoped foreign events are denied; this is not proof all authorized scene mechanics are wired. Actual auth middleware/browser connections still need a full-app run. |
| R02 | Not completed in this change set. | Direct battle-map API, per-viewer map versions, fog/ally tokens, image/asset access and map update hooks. |
| R03–R04, notes | Canonical insert/update/delete records an immutable view in the same transaction. Main snapshot uses the existing listNotesVisibleTo caller, now backed by observations. List and detail API preserve v1 after departure, including an unseen deletion. Current arrivals may discover present public state, not an old history. Empty PATCH needs actual write rights and local presence. | Audit remaining search/export/prompt callers of raw canonical helpers. Full-app UI test is not run. Other object families (facts, chapters, rolls, maps, sheets and media) are not declared converted. |
| R05 | No independent-encounter engine change in this set. | Scene-owned encounters/floor/initiative, participant/target validation, parallel fights and joining scenes without resource resets. |
| R06 | Handshake no longer confirms unread pages. Byte pages assemble before ingest; partial story drains roll memory back. Verified cursor-ahead conflicts recover once without treating arbitrary 409s as rewind. | Server timeline epoch and rewinds that regrow beyond the old cursor still need end-to-end work. |
| R07 | CLI clearly reports collector mode. It leaves Ask pending without an explicit operator adapter; no fabricated model response or synthetic usage. Adapter Ask retries reuse the durable exact command. | External Luna gameplay round-trip and actual model/engine/scoped narration delivery are not executed. CLI is not an autonomous story narrator. |
| R08–R10 | Summary records/milestones retain room, witnesses and aspects. DM context is separate from audience-projected context. Legacy memory stays DM-only. Watermark persists across restarts; repeated backfill does not duplicate folded events. | Full application/provider integration, proper provenance on all source mechanics and existing complete test suite. |
| R12–R13 | Frozen UI payload/UUID, identity disposal, stale expected-actor rejection, explicit WebMCP requestId and IC room/revision. Old callbacks/completions cannot transfer another identity's pending intent. | Native browser/MCP transport and actual navigation acceptance remain not run. |
| R11 | Corrected contradictory outsider assertion, right location-history endpoint, positive controls, archived B history handling and portable pinned-workspace module loading. Native page API is checked when requested. | This remains a prepared read-smoke subset, not a self-seeding complete four-player acceptance fixture. Dynamic movement/combat/maps/rewind and Playwright MCP transport still need implementation and execution. |

## Local validation actually executed

Node 22.16.0, built-in SQLite and VM modules. The added tests include real source
modules with narrow authentication/campaign/schema/embedding doubles; they are
not substitutes for production session middleware or Chromium.

```sh
node --experimental-vm-modules --test \
  scripts/test-narrator-memory-privacy.mjs \
  scripts/test-location-client-privacy.mjs \
  scripts/test-location-client-boundary.mjs \
  scripts/test-spatial-event-privacy.mjs \
  scripts/test-spatial-event-wiring.mjs \
  scripts/test-narrator-reader-recovery.mjs \
  scripts/test-spatial-note-versions.mjs \
  scripts/test-spatial-note-authorship.mjs \
  scripts/test-location-smoke-contract.mjs
```

65 tests passed, 0 failed. This is the listed regression set only, **not `npm test`
for the whole repository**. TS/TSX syntax transpilation is an additional check,
not a full typecheck.

Not executed in this implementation environment: complete repository `npm test`,
full `tsc --noEmit`, ESLint, production build, real-browser E2E and a live external
Luna turn. The working container has a partial source copy, no application
node_modules and no usable network/DNS to clone/install them. No production
server, database, credentials or main branch were changed.

The browser command was attempted without a fixture and correctly returned
`NOT RUN`, exit 2. No browser pass is claimed.

## Note semantics

The existing Party note composer continues to mean explicit global publication.
The new Location notes panel sends a roomId, retains local audience on approval
and uses the canonical /notes and /notes/:id endpoints. Character/private note
rules remain conjunctive with spatial permissions; a DM seat is not permission
to read another user's private journal. Player suggestions are pending for the
DM, not visible to the room until approval.

Unknown unscoped DM-written notes are not placed in the party lead's room simply
because the old schema stores that lead's user ID as the author FK. Pre-feature
public notes retain their prior shared contract. New scoped notes and their
versions/scopes are included in chapter snapshots; old snapshots clear the added
state. Actual full-application snapshot/rewind still requires the complete suite.

## Prepared browser smoke (not full acceptance)

Install dependencies from the pinned `tests/ui-mcp` workspace, prepare a local
throwaway campaign and four independent test-only storage states. A must know the
unique marker in its current room; B must be outside and must not have witnessed
that marker. B may already have an archived tab; 200 containing only known history
is valid. The outsider must be denied. Credentials/state files must not be committed.

```sh
npm ci --prefix tests/ui-mcp
# Install the browser using that workspace's pinned Playwright installation.
ODM_E2E_BASE_URL=http://127.0.0.1:3000 \
ODM_E2E_CAMPAIGN_ID='<test campaign UUID>' \
ODM_E2E_SECRET_MARKER='<unique test-only marker>' \
ODM_E2E_DM_STATE='/absolute/path/to/dm.json' \
ODM_E2E_A_STATE='/absolute/path/to/a.json' \
ODM_E2E_B_STATE='/absolute/path/to/b.json' \
ODM_E2E_OUTSIDER_STATE='/absolute/path/to/outsider.json' \
node scripts/e2e/location-privacy.e2e.mjs
```

Native `document.modelContext.getTools/executeTool` is required by default and
must actually exist; a polyfill does not count. `ODM_E2E_READ_ONLY_SMOKE=1` runs
only the read-path subset and still reports `fullAcceptance:false`. This flag is
not a route to a complete acceptance PASS. The legacy /tmp browser fallback is
removed. `ODM_PLAYWRIGHT_MODULE` remains an explicit operator module override.

Native page API execution and `browser_webmcp_list` / `browser_webmcp_call` over
the pinned Playwright MCP server are distinct tests. The latter is not yet
executed by this read smoke. Consult the official WebMCP draft and Microsoft
Playwright MCP documentation before updating experimental API/version wiring.

## Remaining release gate

Finish real map/fact/chapter/roll/sheet/media and export access, independent
scenes, server timeline recovery and the external narrator round-trip. Then run
a self-contained full application fixture with DM/A/B/outsider through movement,
old/new object versions, two encounters, hearing/scrying, incident propagation,
OOC, live/replay/reconnect, rewind, ambiguous writes and identity changes.
Verify both secrecy and legitimate functionality. A hidden panel, an empty API,
a successful isolated store test or a limited smoke is not full completion.
