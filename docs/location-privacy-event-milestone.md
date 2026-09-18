# Event privacy milestone (R01)

Branch: `feat/location-privacy-playwright`, following narrator-memory commit `1fb90aed51361d39622ef1bc9b56d4e83f15ee10`.

## Implemented

Live fan-out and HTTP replay share `projectEventForUser`. A persisted event now stores its versioned audience in `campaign_events.audience_json` in the same insert/transaction as its payload. Audience membership is captured at publication, not recomputed from a reader's later location. The new optional server-only scope is `dm`, `global`, `users` or `room`; room IDs embedded in ordinary payloads cannot grant access.

Spatial events with unknown legacy audiences fail closed for players. Explicit global events remain supported. Sheet updates reach their owner and the current DM. Generic campaign updates expose only table metadata, not a legacy scene/floor envelope. The other domain publishers still need explicit scope wiring as part of R02-R05; a denied event is not a claim that the corresponding gameplay path is complete.

Each hidden persisted event projects to a contentless checkpoint, preserving page size/order and cursor progress. Ephemeral hidden events are omitted. Current membership/DM role are checked again at delivery. The HTTP stream also closes on membership or role changes before emitting buffered data. Private Ask notifications retain their original one-user-only routing.

DDL is checked rather than indefinitely cached, because first use can occur inside a transaction that later rolls back. Existing stored events and backups retain their payload format; `audience_json` is an additive column on the same row, not a separately drifting receipt table.

## Executed validation

```sh
node --experimental-vm-modules --test scripts/test-spatial-event-privacy.mjs
```

9 tests passed on Node 22.16.0. The test executes the actual TypeScript event policy, event bus, stream and HTTP route using Node's type stripping and VM modules. Persistence is real SQLite (`node:sqlite`); campaign/auth/after-commit services are explicitly substituted fixture adapters. This is not a full Next.js server or browser test. Tested owner/DM positive controls, outsider rejection, live/replay isolation, historical audience after movement, unknown legacy data, campaign envelope redaction, revocation/demotion, 1001 hidden events followed by a visible tail, rolled-back DDL recovery, private ephemeral routing and buffered-stream authorization.

The four changed TypeScript source files also transpiled without diagnostics. A project-wide TypeScript check, lint, production build, encrypted production SQLite driver, native WebMCP and full browser acceptance have not been executed here. The feature remains unaccepted until the other review blockers and those integration checks are completed.
