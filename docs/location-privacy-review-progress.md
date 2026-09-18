# Location privacy review remediation — current status

Repository: `fireostendere/dungeon_master`.
Branch: `feat/location-privacy-playwright`.
Review: R01-R13, dated 2026-09-18.
Starting branch tip: `47cce60bc52026f46631e57e94c05ab106d7e120`; its changes were preserved.

**The full review is NOT closed. This branch is NOT accepted as complete location isolation and must not be merged on the strength of these component tests alone.**

## Committed implementation milestones

| Commit | Implemented changes | Evidence and boundary |
| --- | --- | --- |
| `1fb90aed51361d39622ef1bc9b56d4e83f15ee10` | R08-R10 memory component: witness-aware summary segments and milestones; scoped rolls/encounters/characters; legacy summary migration; persistent deduplication and revision replacement. | Existing compaction test plus 8 new memory regressions. Runtime delivery still must supply the actual authorized reply audience. |
| `73bed0223f88bd3e76b1f424c8546de89612de79` | R01 event boundary: immutable publication audiences; shared live/replay projection; hidden-event checkpoints; repeated membership/role checks; private ephemeral routing. | Actual event/stream/HTTP-route code with real SQLite and explicit auth/campaign fixtures. Domain publisher scope wiring is not complete. |
| `28cfcc2d86e11936479154edf52a6903a3aa683a` | R12-R13 client intent boundary: stable WebMCP intent IDs and exact revision/payload retries; identity-bound hook sessions; abort/late-completion protection; server expected-user assertion. | 9 regressions, including a real loopback HTTP response loss after fixture commit. Native WebMCP and actual React navigation have not passed. |
| `7a22130a66c2ba54af4524a112e0c72e588e02f9` | R06 read/recovery: complete byte/story paging, atomic per-page acknowledgement, persisted timeline assertions, cursor-ahead and epoch resync, stale-timeline write rejection. | 10 recovery tests plus a new SQLite same-sequence rewind test. No claim of actual model generation or arbitrary out-of-band database-restore detection. |

Details: `location-privacy-event-milestone.md`, `location-privacy-client-milestone.md`, `location-privacy-recovery-milestone.md` in this directory.

## Still open — implementation, not merely missing test results

- **R02 is implemented in this branch:** active tactical maps are explicitly bound to a spatial room by start_encounter, direct player reads record a per-user observed map projection, leaving freezes that projection, returning advances it, and unbound legacy boards fail closed. R03-R04 remain open for facts, notes, chapters and the rest of the legacy object/read surface.
- **R05:** independent encounters, scene-specific floor/initiative and unrelated subgroup movement still need implementation. Shared campaign-level engine assumptions are not removed by hiding the encounter panel.
- **R07:** the runner's allowed Ask path still uses a placeholder answer and fabricated usage rather than a real model adapter; the player-intent → model → engine → addressed narration chain remains unimplemented in that host. An external Luna client is a different runtime.
- **R11:** the original browser harness's contradictory outsider expectations and wrong history endpoint are not yet repaired, and the full dynamic acceptance scenario is not implemented/executed.
- **R01/R08 integration:** safe event defaults intentionally deny unknown spatial audiences. Actual authorized domain publishers and narrator reply audience selection still require integration; denied/empty results do not demonstrate working gameplay.
- **R12/R13 acceptance:** component regressions pass, but native tool registration/invocation and real UI identity/navigation behavior still need browser verification.

## Reproduce the completed regression set

```sh
node --experimental-vm-modules --test \
  scripts/test-narrator-compaction.mjs \
  scripts/test-narrator-memory-privacy.mjs \
  scripts/test-spatial-event-privacy.mjs \
  scripts/test-spatial-battle-map.mjs \
  scripts/test-location-client-intents.mjs \
  scripts/test-narrator-read-recovery.mjs
```

Latest combined run: **38 passed, 0 failed, 0 skipped**, Node 22.16.0. `scripts/test-all.mjs` discovers the new `test-*.mjs` files automatically. The entire repository test runner was NOT executed here.

Memory tests have no doubles. Event tests use real SQLite with fixture auth/campaign/after-commit adapters. Client tests execute real session/hook/adapter/route code with explicit React/native-registration/auth/Zod/service doubles; one test uses real TCP/HTTP with a fixture command journal. Recovery tests execute the actual runner/read-session/memory/atomic checkpoint code with fixture control responses and model-related dependencies. The dispatcher test uses real SQLite with domain/Zod fixtures. None of these is full Next.js/browser/production acceptance.

Changed TypeScript sources transpiled without diagnostics; the client intent module also passed a standalone strict TypeScript check. Full project typecheck, lint and production build remain unexecuted.

## Execution constraints encountered

Direct GitHub/npm access from the execution container failed DNS resolution; the authorized GitHub connector was used for source reads and fast-forward branch updates. A full checkout with project dependencies was not available. An existing CI deployment-source artifact was found but was already expired, so it did not provide a checkout.

Chromium 144 loopback navigation for a native WebMCP probe failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` before checking the API. No administrative policy was bypassed. This result is BLOCKED, not PASS and not evidence that native WebMCP is absent.

`main`, production and the production database were not modified. No paid model requests were made.

## Required closure criteria

Complete the domain/runtime/harness work above, then run real-server/test-DB scenarios for DM/A/B/outsider: separated scenes; speech, rolls, maps, facts, notes and fights; v1 observed before leaving and v2 observed only after authorized return; physical/magical observation limited to permitted aspects; loud propagation; global OOC; live/replay/reconnect/rewind; independent subgroup fights; dropped response; account/campaign change. Verify response bytes and positive controls, not just absence from the DOM. Only then reassess feature acceptance.
