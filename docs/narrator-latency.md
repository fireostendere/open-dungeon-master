# Narrator latency: protocol, runtime and room delivery

This change targets application-controlled latency in external MCP play and the optional OpenCode narrator host. It does not change dice, private audiences, provider safety policy, model quality settings or the operator's local RAG. It does not promise a measured end-to-end speedup without a live trace.

## External Codex / MCP path

The MCP transport now defaults narrator reads to `projection: "live"` and `delta: true`. Historical duplicate sections are omitted. Send `knownSections` from the same campaign/timeline to avoid receiving unchanged current sections; merely sending `afterSeq` is not equivalent. A client that has lost its cached section values must drop those hashes and request fresh values. Direct internal API v2 read defaults are retained for compatibility; the fast defaults are applied by `mcp/control-client.mjs` and explicitly by the narrator runner.

The full gameplay policy remains in `connect.instructions` and the policy resource. Install it once as trusted instructions in a dedicated narrator host. Routine tool results default to compact policy metadata, not another copy of the document. `ODM_MCP_POLICY_MODE=full`, `policyMode: "full"`, and `includePolicyText: true` retain explicit full delivery. This is context deduplication, not removal of safety or privacy rules.

Unfiltered catalog requests default to summaries. Ask for a single `action` when its parameter schema is needed. The MCP schema now advertises and preserves `commandId`, `timelineEpoch`, `expectedVersion`, `paged`, `pageCursor`, `afterAskSeq`, and `askLimit`, matching the application's existing safety/paging contract. The MCP Docker image explicitly includes the new schema module.

### Read state with the command receipt

Story writes (`invoke`, `narrate`, `release_floor`) default to `readAfter: true` through MCP. A successful result includes the original durable receipt plus a bounded post-commit `state` and the exact `readAfter` parameters used. Consuming this state satisfies the post-write read requirement; do not make another identical read just to obtain it again.

For a cached client, use an explicit readAfter object:

```json
{
  "readAfter": {
    "projection": "live",
    "delta": true,
    "paged": true,
    "maxBytes": 65536,
    "knownSections": {}
  }
}
```

Populate knownSections only with hashes whose values the client actually retains. Drain every byte page and every event page before another write. For the attached snapshot's next byte page, call `read` with the returned readAfter parameters and `pageCursor: state.nextPage`. Merge verified section deltas; an omitted array is not an instruction to erase remembered state. A later concurrent change can still require a fresh read before the next CAS write.

Read options are validated before mutation. If readback fails after commit, the result retains the successful receipt, sets `readRequired: true`, and supplies a sanitized read error. **Read again; do not regenerate a UUID, reroll, or replay the effect.** An ambiguous original write still permits only the existing exact receipt-recovery retry. `readAfter: false` preserves the old receipt-only path. The wrapper does not bulk-apply speculative actions or manufacture outcomes.

### Stable byte pagination

Multi-page reads retain a private frozen snapshot for up to 60 seconds, bounded to 32 entries and 16 MiB per process. Ordinary new reads are not cached. Every page request is authorized again and bound to the same campaign, timeline, DM seat and read parameters. New activity no longer forces reassembling the same historical byte page from a different live state. Expiry, eviction, a changed scope or restart returns a conflict and requires a new first page. Deployments with multiple web processes should use request affinity for byte-page sequences; process-local cache misses fail closed.

### Narrow room concurrency optimization

An external client may attach `scopeRoomId` to `invoke` **only for `location_narrate` with the same explicit `args.roomId` and timelineEpoch**. Under the command transaction the server accounts for every intervening sequence. Only ordinary speech in other rooms, not witnessed by the destination audience, and OOC may be ignored. The proof is bounded to 100 intervening sequences.

Movement, mechanics, stealth, same-room messages, perceived speech, command receipts, unknown sequence gaps and all other action kinds still require exact campaign state. This is not independent per-room combat or a general bypass of CAS. Command UUID/fingerprint replay checks and the campaign write queue remain intact.

## Room chat delivery

The existing identity-bound GET endpoint supports `waitMs` up to 20000 with If-None-Match. Same-process spatial commits trigger an internal wakeup only after the enclosing transaction commits. The waiting request reauthenticates membership and recomputes only that user's authorized view. An unchanged view keeps waiting: private message text, room IDs and hidden-activity notifications are not published on the global event bus.

The browser immediately renews a completed long poll rather than sleeping two seconds. It keeps one request in flight, cancels on navigation/identity disposal and backs off on failures. Old servers retain the previous polling interval. Two-second authoritative fallback checks cover other processes, missed internal notifications and perception-grant expiry. This fallback interval is not a guaranteed maximum delivery latency under load.

Generated draft tokens are still not broadcast to the table: unvalidated mechanics or private content must not leak in exchange for a lower apparent first-token time. The room receives committed, authorized text.

## Optional automatic narrator / OpenCode path

Normal runner drains now honor live projection; explicit full reads remain for bootstrap/recovery and physical-roll verification. Productive story steps continue through an event-loop timer without a fixed two-second sleep; idle and error states retain the configured poll interval and existing model/step budgets.

Private Ask work runs as one separate worker alongside story decisions, with its own section cache and a fixed campaign/timeline scope. The default worker batch is one attempted question; `ODM_NARRATOR_ASK_BATCH` accepts 1–20. Later pages remain discoverable even when earlier ambiguous commands are blocked. The worker never advances the story cursor. Model output finishing after a rewind or stop is discarded before creating a new private write; already persisted command UUIDs are retained for exact receipt recovery. The standalone collector still waits for its Ask task, and `--once` waits for the task before exiting.

OpenCode generation still uses isolated sessions for roles and private contexts. Session deletion is no longer awaited on the completed-answer path. Cleanup has its own 2000 ms default deadline (configurable constructor option, maximum 10000 ms), a bounded pending set and a close/drain method. A failed cleanup cannot hide an otherwise completed response. Referee-to-writer calls remain sequential when literary rewriting is requested; this patch does not silently downgrade substantive narration.

## Diagnostics

Set `ODM_LATENCY_LOG=1` in the web/MCP processes to emit content-free JSONL to stderr, prefixed with `[odm-latency]`. Every record has an opaque random `traceId`, an allowlisted stage and numeric duration/count/byte fields only; durations retain millisecond precision to three decimals. It never includes player text, prompts, private Ask values, room/campaign/user/command IDs, hashes, credentials, tool arguments or error text. Logging failures are isolated from the command.

Current coverage: MCP-side calls report `mcp_read`, `mcp_engine`, `mcp_narration` and `mcp_ask`; the host records `post_write_read` while it validates and consumes an attached receipt state; `narrator_write` records server queue and total command time. Packet construction reports `packet`; section cache work reports `read_sections`; checkpoints separately report serialization (state-key hash plus payload JSON, excluding filesystem work), file fsync, directory fsync and one `checkpoint_write` only after the full durable boundary succeeds. The OpenCode adapter reports `adapter_session`, `adapter_policy`, `adapter_model` and `adapter_cleanup`; `narrator_model` adds host role/input/output bytes and a model-call count. Summarize captured files without replaying raw input:

```sh
node scripts/summarize-latency.mjs /path/to/odm.log
```

The summarizer accepts either raw JSONL or the stderr prefix and outputs p50/p95 by stage and role with distinct input/output/response bytes, model/MCP calls, cache hits/loads and successful checkpoint writes. It silently discards malformed lines and never prints them. A story cycle shares one in-process trace ID; each concurrent private Ask worker gets a separate ID. These IDs are process-local correlation only: no campaign, user or distributed request propagation is claimed. There is no instrumented browser delivery, input-acceptance, remote provider-internal or operator-local RAG stage; these are **unavailable**, not inferred or fabricated. OpenCodeAdapter's `onTiming` callback receives the same sanitized adapter events; callback failures cannot break generation.

For an actual before/after comparison capture input acceptance, MCP read/write durations and response sizes, model/RAG duration, receipt time and browser delivery time. Do not infer provider throughput or RAG performance from unit-test durations.

## Validation and rollout

Focused validation executed with Node 22.16.0:

```sh
node --experimental-vm-modules --test scripts/test-narrator-latency.mjs scripts/test-narrator-scheduling.mjs
```

Result: **31 passed, 0 failed, 0 skipped**. Tests use in-memory SQLite for the concurrency proof and controlled/mock boundaries for HTTP, model responses, checkpoint dependencies and authorization loaders. They cover frozen-page integrity and scope isolation, expiry and bounds, committed receipt preservation on read failure, relevant versus unrelated room activity, private long-poll wakeups and revocation, abort/race cleanup, live/full runner selection, productive/idle scheduling, stalled Ask isolation, rewind handling, exact retry UUIDs, isolated model sessions and nonblocking cleanup. The existing test-all runner automatically discovers both new scripts. Syntax/transpile checks of the locally staged modules also passed.

These are not a production end-to-end run. The full repository suite, complete TypeScript typecheck, Next.js production build, Docker build and a live Codex/OpenCode game were not executed in the patch environment because dependency downloads were unavailable. Before deployment, run the repository's normal checks with its lockfiles:

```sh
npm ci
npm --prefix mcp ci
npm test
npx tsc --noEmit
npm run build
```

Update the web application and MCP sidecar together: an updated sidecar sends readAfter, which an older strict backend does not accept. Refresh the client's discovered MCP schema and restart its dedicated narrator session with the trusted policy. No production settings, game data or main-branch deployment are changed by this branch. Local RAG configuration and existing model settings are untouched.
