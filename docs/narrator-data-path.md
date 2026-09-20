# Narrator data-path optimization, second pass

Continues `astra` from `b6a75a1`. This document distinguishes implemented runtime changes from work that requires access to the operator's separate local RAG. No live server, game database, model selection, RAG corpus or main branch was changed during development.

## Implemented

### Automatic host consumes post-write state

`narrator/orchestration.mjs` now requests `readAfter` directly from the internal API, not just through the MCP transport. It consumes the returned first page rather than fetching it again. The read-session module validates the snapshot, campaign, timeline, acknowledged cursor, section hashes and subsequent byte/event pages before acknowledging input. A partial/damaged response does not install a new cache baseline.

A committed command's small receipt is saved before processing readback. The attached full state is not duplicated into the checkpoint. A readback failure or restart resumes reading, never re-executes the committed effect. Ambiguous writes retain the same persisted UUID and request, with the existing two-attempt bound.

The old pre-write network read is also removed. The write still carries the sequence of the actual decision snapshot, and the engine's transactional CAS rejects stale state before effects. This is not permission to apply a draft to a newer sequence. A 409 triggers a fresh read and reconsideration. In the single-page, uncontended path this removes the standalone pre-write and post-write read calls; the post-write database read still runs inside the command response.

Stopping or changing the timeline while a role is generating discards its late decision. The optional automatic orchestrator's existing spatial-campaign guard remains; this patch does not claim that the automatic OpenCode orchestrator supports room campaigns. External Codex/MCP room play uses the application-side read optimizations.

### Prepared SQL programs and versioned projections

Both SQLite drivers reuse up to 128 prepared statements per connection. They cache programs, not row results. `exec`, `pragma`, rollback and close clear this cache. The public driver interface, synchronous transactions, native encryption and Node fallback behavior remain unchanged.

For narrator reads, `readNarratorSections` uses small source revision tokens before rebuilding these projections:

| Section | Dependencies |
| --- | --- |
| sheets | character_sheets, homebrew_entries |
| facts | world_facts |
| notes | campaign_notes |
| npcs | npcs, world_facts (witness notes) |

Revision tokens are updated by SQLite triggers in the same transaction as inserts, updates and deletes, including writers on other connections. Random tokens avoid reuse after rollback. Reassignment updates both campaign scopes. Insertions additionally change a source-wide token, conservatively covering implicit deletes from `INSERT OR REPLACE` even with recursive triggers disabled. Chat does not invalidate these source tables.

The per-connection projection cache is bounded to 128 entries and 16 MiB of serialized bodies (JavaScript object overhead is additional). Its keys include campaign, timeline, narrator identity, section, schema and dependency versions. Schema changes or missing dependencies invalidate/bypass caching. If a source changes while its loader runs, that result is not stored under the old revision. Returned values are copies, not mutable shared references. The content-hash algorithm remains compatible with existing `knownSections` clients.

A warm read with matching hashes does not re-run the section loaders, parse cached JSON or hash full section bodies again. It still checks revision tokens and live campaign state. Current authorization, player observations, room audiences, pending rolls, encounters and command effects are not served from this cache. The existing item-weight lookup is process-local; replacing content packs should still follow the application's normal restart procedure.

The metadata table `odm_read_revisions` and its triggers are installed lazily against the existing schema. They contain revision tokens, not copied game prose. No new database server is required.

### Checkpoint I/O and role packets

Checkpoints remain independently readable JSON files. They are written compactly rather than pretty-printed. Identical durable narrator state is not rewritten merely because wall-clock health fields changed. Changes to cursors, command UUIDs, attempts, memory, model-call budgets and other durable fields still force the existing atomic write and fsync boundary. Reading/restoring a checkpoint invalidates duplicate suppression.

The two immediately adjacent pre-model saves are combined; output-byte telemetry is persisted with the next state boundary instead of forcing another separate fsync. Errors clean up temporary files and do not install a successful-write cache entry. Directory synchronization failures are surfaced, not silently declared durable.

This is deliberately **not** a new snapshot-plus-journal storage format. A changed large memory snapshot still needs serialization and a durable write. No backup changes or recovery sidecars are introduced.

The referee packet drops portrait-rendering metadata and an exact duplicate of the current input. It retains mechanics, resources, biographies, notes, rules, catalog and audience information. Writer and private Ask packets are not shortened. No cheaper model, speculative roll outcome or automatic reduction of literary quality is introduced.

## Local RAG: not modified or benchmarked

The actual Codex-side D&D RAG path, repository, backend and launch configuration were not available in this checkout/context. The in-project server embedding/retrieval modules are not evidence of that local RAG's implementation, and were not altered as a substitute. The engineering `mcp-rag` repository was not changed.

Consequently this pass does not claim a warm embedding process, query single-flight, result cache or reranker tuning in the user's real local RAG. Those changes require its actual configuration and source plus cold/warm timing measurements. Any eventual result cache must preserve corpus version, edition, campaign timeline and audience/access scope; live HP/initiative remain authoritative engine state, not RAG facts.

## Validation actually executed

On Node v22.16.0:

```sh
node --test scripts/test-narrator-data-path.mjs
node scripts/benchmark-narrator-data.mjs
```

Result: **39 tests passed, 0 failed, 0 skipped**. Tests use actual Node SQLite and filesystem I/O, with controlled model/HTTP/host boundaries. Coverage includes revision invalidation across connections, delete/reassignment/replace, rollback and schema recreation, bounded caches, prepared statements, checkpoint fsync failure, readback integrity/delta/paging, receipt recovery, CAS conflicts, stop/timeline changes and durable model-call limits.

All staged JavaScript modules passed `node --check`. The changed TypeScript files passed transpilation/syntax checks. The actual transpiled Node driver was exercised separately for prepared-statement reuse and nested/outer rollback. These checks are not a full TypeScript typecheck, native encrypted-driver run, Next.js/Docker build or complete repository regression run; dependency downloads were unavailable in this environment.

Synthetic benchmark fixture: 8 sheets, 250 facts, 20 notes and 100 NPCs. Over 100 repeated reads after warming, section loader calls fell from **400 to 0**. In the recorded local run the isolated section-building median was **2.700 ms vs 0.064 ms**, p95 **3.714 ms vs 0.153 ms**. These are synthetic data-path timings, not whole-turn/provider/RAG performance. 100 unchanged-state checkpoint attempts caused **1 durable write**. Script output includes its fixture and Node version; rerun on the target machine rather than treating these numbers as a service-level guarantee.

`ODM_LATENCY_LOG=1` adds the content-free trace described in `narrator-latency.md`, including `read_sections`, split checkpoint serialization/fsync stages and host model bytes. Metrics contain counts/durations/byte lengths, not game prose or credentials.

## Rollout

Deploy the matching web/MCP versions as described in `narrator-latency.md`; restart the optional narrator host to load its new modules. Before merging/deploying, run the normal locked-dependency install, complete test suite, TypeScript check and production build in the target environment. No rollout or main-branch merge was performed here.
