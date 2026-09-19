# Narrator read and recovery milestone (R06)

Branch: `feat/location-privacy-playwright`, following `28cfcc2d86e11936479154edf52a6903a3aa683a`.

Connect no longer acknowledges the first response's currentSeq. The host fully assembles byte pages, drains story pages from the durable cursor, ingests them and atomically checkpoints each accepted page. An incomplete response, non-advancing cursor, inconsistent hash/shape or failed checkpoint cannot advance the cursor. Byte pages, accumulated bytes and story pages have explicit hard limits.

Narrator reads now include timelineEpoch, derived from the authoritative persisted campaign_rewound event. Each new rewind event includes a random nonce, distinguishing repeated rewinds even when sequence, timestamp and other payload fields match. The upgraded host carries the epoch on reads and Ask writes. The dispatcher rejects stale epoch assertions before command execution or receipt recovery. The existing contractVersion remains 2; connect advertises the additive timelineVersion 1 capability.

A poll conflict triggers a bounded metadata reconnect. A confirmed epoch change or cursor-ahead condition clears incompatible memory and pending writes, then drains the replacement history. A mere snapshot paging conflict does not erase accepted history. The host avoids overlapping polls, and --once returns failure rather than claiming a successful failed run.

## Executed checks

```sh
node --experimental-vm-modules --test \
  scripts/test-narrator-compaction.mjs \
  scripts/test-narrator-memory-privacy.mjs \
  scripts/test-spatial-event-privacy.mjs \
  scripts/test-location-client-intents.mjs \
  scripts/test-narrator-read-recovery.mjs
```

38 tests passed on Node 22.16.0. The recovery suite contributes 10 tests and the event suite now includes one additional durable-timeline test. Recovery tests execute the actual runner, read-session, memory and atomic file checkpoint modules. Control responses, cost tracker and semantic classifier are explicitly substituted. The dispatcher test executes the real TypeScript dispatcher and timeline query with real SQLite and stubbed domain/Zod adapters; it is not full engine integration. The unchanged checkpoint module was verified as Git blob `46633f1a117c6d63e85ffc830054901ba9ebc888`.

Three changed TypeScript sources transpiled without diagnostics; both host JavaScript files passed node --check. Full project typecheck, lint, production build and real-browser/production acceptance have not run.

## Remaining boundaries

This milestone confirms durable collection, not model generation or completed gameplay intents. R07's placeholder Ask answer and fabricated usage remain to be replaced or explicitly separated from a real narrator runtime. R02-R05 domain integration and R11 full browser acceptance are still open.

The timeline contract covers application rewinds that publish campaign_rewound. An out-of-band database restore must restart/resynchronize narrator state; automatic detection of an arbitrary restored database with an identical event log is not claimed. Legacy clients that omit the optional epoch retain their old contract and do not receive this stale-timeline write guarantee.
