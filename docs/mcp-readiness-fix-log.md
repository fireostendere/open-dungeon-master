# External narrator readiness fixes

Basis: the 2026-09-17 M01–M14 audit of main
`a95685a6ef8f4687af61780d21b6fadd7dbf362e`.

## P1 implementation batch — M01–M07

- M01: synchronous human lifecycle advances initiative only for explicit
  `end_turn`, using the exact adjudication turn. Combat bookkeeping is keyed by
  encounter/round/position, so separate enemy actions are not forgotten before
  advancement. Pending physical rolls block completion; hold is preserved.
  Narration never advances initiative. Optional `turnId` links its receipt to an
  adjudication, rather than selecting an arbitrary latest turn.
- M02: deterministic facade/dispatcher uses the shared SQL/savepoint + mutable
  state rollback + deferred notification mechanism. Returned refusals roll back
  just like exceptions. A legitimate failed dice check still commits. Async
  operator-only actions do not enter a synchronous transaction.
- M03: message, sequence, persisted event and hold share a transaction; fan-out
  follows commit. External command receipts commit in the enclosing transaction.
- M04: `send_whisper.args.replyToWhisperIds` names exact incoming messages. The
  reply and scoped acknowledgements commit together; foreign/already-answered
  IDs and extra recipients are rejected. Only recipients and the DM are notified.
- M05: capture cancellation before enqueue and check after waiting and before
  commit. A command cancelled before commit makes no game change. A successful
  command has a private durable result and random, argument-free public marker.
  Repeating the same command ID, expected sequence and payload recovers that
  result without re-executing. Changed arguments or a rewound timeline conflict.
- M06: the fixed-destination app proxy preserves `Mcp-Method`, `Mcp-Name` and
  `Mcp-Param-*` without forwarding caller cookies or caller-selected Host.
- M07: the browser SSE route replays pages to a fixed watermark, then drains a
  bounded live buffer. Every connection refreshes private/ephemeral views using
  the existing contentless events; a restored cursor requests a fresh snapshot.
  Disconnects release presence/subscriptions/timers.

### Reproducible checks performed for this batch

Node 22.16.0 and TypeScript 5.8.3. In a source-only workspace:

```sh
node --test scripts/test-mcp-readiness-p1.mjs \
  scripts/test-narrator-command.mjs \
  scripts/test-human-adjudication-atomic.mjs \
  scripts/test-whisper-replies.mjs
```

27 tests passed, zero failed/skipped/cancelled. These execute production boundary
modules with real temporary SQLite, real HTTP loopback/Web Streams and explicitly
substituted catalog/domain/DB projection dependencies. The harness documents
those substitutions. Combat is a lifecycle/scope fixture (two PCs, companion,
two rounds), not the complete combat engine. Whisper tests verify three successive
replies, later unread messages, foreign IDs/authors and targeted notifications.
The existing application integration test was updated to require **no** sequence
change on a refused tool, replacing its old partial-attempt expectation.

This is **not** a full checkout acceptance: dependency installation, whole-project
TypeScript/lint, full npm test, production Next build, actual MCP SDK discovery,
real browser play, SQLCipher restore and live model tests were not executed in
this environment. GitHub/npm network access from the runtime was unavailable.
P1 code fixes do not constitute a claim that the complete application is ready
for a friends' campaign. P2 and final deployment/model acceptance remain separate.

### Command recovery contract

Persist a UUID `commandId` and the complete request before an external story
write. On an ambiguous disconnect, recover only by sending **that same** request;
never regenerate arguments or replace expectedSeq on a retry. Then reread/drain
before planning the next action. Legacy callers without a command ID get an
identical-request fingerprint key, but new hosts should use explicit IDs.
`commands` in narrator.read contains recent receipt metadata, not private results.
Receipts are in the same database as campaign state and therefore belong in its
backup. A receipt whose marker was removed by rewind is not reusable.

The old general playbook's prohibition on automatic replay remains the safe
rule for clients that do not persist requests. Receipt recovery is not permission
to invent a replacement command. The mandatory preload advertises `commandId`
and `turnId` on the existing narrator tool; it does not add operator permissions.
