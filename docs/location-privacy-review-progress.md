# Location privacy review remediation

Base: `47cce60bc52026f46631e57e94c05ab106d7e120`, branch `feat/location-privacy-playwright`.
Scope: R01-R13 of the review dated 2026-09-18. This is a progress record, not whole-feature acceptance.

## Milestone 1: narrator memory (R08-R10)

- Version 2 checkpoints retain each compacted segment's source ID, sequence range, room, witnesses and permitted-aspect metadata. Milestones preserve the same provenance.
- `getPromptContext(roomId, { audienceUserIds })` intersects knowledge for all recipients; scene filtering also applies to rolls, encounters and characters. No-audience calls are trusted DM context, not a player projection.
- Legacy summaries and initialSummary survive empty reads and are migrated as DM-only memory with unknown audience.
- The bounded persistent message fingerprint ledger and compaction watermark prevent repeated full snapshots from duplicating history. Revisions replace old content; timeline changes clear incompatible memory. Updates older than the bounded ledger must carry a monotonic updatedSeq.

Executed locally with Node 22.16.0:

```sh
node --test scripts/test-narrator-compaction.mjs scripts/test-narrator-memory-privacy.mjs
```

Result: 9 tests passed (the existing compaction test plus 8 new regressions). No test doubles are used in these memory tests. The existing test file was copied with Git blob SHA `7b48196225736a0fa552e72b9cc1a14d1f921417` unchanged.

This proves the memory component only. R08's complete host-delivery guarantee also depends on a runtime passing the actual reply audience and on server-side domain projections.

## Still open at this milestone

R01-R05: server event/domain isolation and independent encounters.
R06-R07: complete narrator delivery, recovery and real model adapter.
R11-R13: browser acceptance, WebMCP idempotency and identity-bound retries.

Full checkout, npm dependencies, TypeScript check, lint, Next production build and native browser E2E have not run in this environment. Direct GitHub/npm access from the execution container is unavailable; source reads and commits use the authorized GitHub connector. Do not label the entire feature accepted or merge it on the strength of this milestone.
