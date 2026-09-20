# Narrator performance follow-up, 2026-09-20

Baseline: remote `astra` at `7aa73c4`, fetched before implementation. Work was
isolated in the `astra-perf` worktree because the original `main` checkout has
uncommitted work. No main merge, production deployment, live game mutation,
corpus ingestion, model/provider change or external-repository edit was made.

This delivers measured DB/packet improvements and a cache correctness fix. It
does **not** complete the external-RAG optimization or live end-to-end acceptance
criteria. Those gaps are explicit below, not represented as successful tests.

## Runtime Paths

Installed external-host configuration, confirmed from the outer workspace
`opencode.json`, `config/codex-dnd-profile.toml`, running stdio processes and local
Qdrant metadata:

```text
Player UI
  -> POST /api/campaigns/:id/actions (legacy)
     or POST /api/campaigns/:id/location-chat (room mode)
  -> authorization, ingress/floor checks, persisted input
  -> configured SSH stdio ODM MCP -> control-client -> /api/internal/mcp
  -> narrator.read: authorization + live DB state + bounded sections/pages
  -> external Codex/OpenCode narrator
       -> optional local dnd MCP: knowledge_base.cli serve
          -> mcp-rag/data_dnd SQLite + Qdrant dnd_srd
          -> FastEmbed dense + sparse BM25 + optional reranker
  -> narrator.invoke: persisted UUID, epoch + sequence CAS, engine/dice
  -> committed receipt + attached readAfter state (drain every page)
  -> grounded narration; optional writer only after confirmed outcomes
  -> narrator.narrate or scoped location_narrate commit
  -> authorized SSE / location-chat long poll -> browser
```

The optional automatic path in this repository is different:
`narrator/run.mjs` -> `poll-cycle.mjs` -> `orchestration.mjs` -> isolated
OpenCode referee -> engine/readback -> optional isolated writer -> commit.
Its model sessions deny tools and it has **no call to the external D&D RAG**.
Private Ask runs separately, with the asker's context, its own read cache and
private write. This automatic host still refuses spatial campaigns. Its presence
in the repository does not establish that it is the installed live narrator.

`useCampaignStream.ts` consumes the authorized SSE stream; `useLocationChat.ts`
uses identity-bound private long polls. Neither browser path nor production was
instrumented or exercised end-to-end in this pass. No draft prose is broadcast.

## Changes And Invalidation

- Receipt/Ask readiness no longer runs `CREATE ... IF NOT EXISTS` on each read.
  Prepared `sqlite_master` checks are live reads, not cached authorization or row
  results. Ask's migration marker is also checked live; its repair remains
  transactional. No indexes were added, so there is no new index write cost.
- The existing prepared-statement cache was retained. Avoiding repeated schema
  `exec` calls now lets it retain programs across reads. Statements still bind
  fresh parameters and read fresh rows.
- The narrator caps the active NPC SQL result before mapping agency/witness
  notes, with the same `ORDER BY name COLLATE NOCASE` and strict archived-row
  semantics. An empty active roster avoids the redundant facts query.
- Referee/writer packets use selective copying immediately before synchronous
  JSON serialization. Only exact identified input duplicates, portrait rendering
  data and an identical second scene are omitted. Referee now also receives the
  previously missing `party` and `members`; writer still receives only its public
  projection, input and approved draft. No opaque state references or extra LLM
  summarizer were introduced. Writer selection policy and model-call count stay
  unchanged.
- Checkpoint durability and write suppression were retained, not replaced with
  a journal or disabled fsync. Serialization/hash, file/directory fsync and
  successful writes now have separate content-free metrics.

### Schema rollback defect found in the previous Astra cache

`PRAGMA schema_version` can repeat. Reproduction: warm a facts projection; inside
a transaction create an unrelated table and read again; roll back; drop the facts
table. SQLite returns the same schema version as the rolled-back branch, and the
old cache returned the deleted facts. The regression first failed on `7aa73c4`'s
implementation and now passes.

`RevisionCache` now verifies a transactional schema-epoch token in
`odm_read_revisions` in addition to `schema_version`. Schema/trigger installation
and token publication use a savepoint; an outer rollback rolls the token back
too. Another connection reuses the committed marker rather than invalidating
peers on every read. Normal reads add a cheap token check, not a state write.
The small receipt/Ask readiness paths deliberately use live metadata instead of
their own version-only memoization, which has the same rollback ambiguity.

| Cache | Key / invalidation |
| --- | --- |
| Prepared SQL | Per connection, SQL text, bounded 128; exec/pragma/rollback/close invalidate programs |
| Narrator sections | Campaign, timeline, narrator principal, section/variant, schema_version and source revision tokens; schema-epoch mismatch clears the cache; bounded 128 / 16 MiB |
| Frozen byte pages | Existing campaign/timeline/DM/read-parameter binding, reauthorization per page, 60 s / 32 / 16 MiB limits |
| Checkpoint suppression | Durable-state digest plus file identity; advisory timestamps excluded, restore/read invalidates |
| Local RAG embeddings | Existing external per-model-instance exact-query cache; observed, not added here |

Authorization, room/witness access, pending rolls, encounters, command receipts
and engine mutations are not cached RAG facts. Sheet projection invalidation
still follows transactional source triggers, including same-transaction writes,
rollback, replace/reassignment and other connections. Projection content hashes
and the client's omitted-section merge contract are unchanged.

## Measurements

All figures are recorded observations, not provider throughput or a game-speedup
claim. Node v24.18.0 on local Linux/WSL, installed dependencies matching the same
lockfile. Timings include the measurement wrappers. No new model/token estimate
is substituted for actual usage.

### Local SQLite integration

`benchmark-narrator-db-milestone.mjs` runs the same fixture against a temporary
`git archive 7aa73c4` and current sources. It invokes the real narrator handler
against isolated SQLite, not HTTP/SSH or a live campaign. Fixture: one sheet,
125 NPCs, 30 facts, non-spatial human mode without an encounter or pending roll;
five warmups and 25 samples per read scenario. Active battle and large multi-PC
paged-read latency were not benchmarked here. Raw evidence:
[`performance/narrator-db.json`](performance/narrator-db.json).

| Scenario | Before p50 / p95, ms | After p50 / p95, ms | Response bytes |
| --- | --- | --- | --- |
| Warm live read | 0.632 / 0.993 | 0.423 / 0.908 | 25,783 unchanged |
| Changed sheet | 0.746 / 1.105 | 0.524 / 0.631 | 25,783 unchanged |
| Changed fact + NPC | 1.554 / 2.411 | 1.360 / 2.115 | 25,804 unchanged |
| Exact server spell/alias lookup, 100 samples | 0.014 / 0.064 | 0.014 / 0.061 | 234 unchanged |

For 25 warm reads, DDL `exec` calls fell **50 -> 0**, and distinct observed
prepared-statement handles **475 -> 22**. This is not a count of SQLite internal
recompilations. SQL reads increased **825 -> 975** because of live metadata and
rollback-safe epoch checks. Source projection loads remain **0 -> 0**: the prior
Astra cache already removed them. Changed-sheet and changed-fact/NPC source loads
remain 25 and 50 respectively. Mapped NPC rows fell **3,125 -> 2,500** in the
changed-roster scenario. Exact lookup retains SRD 5.1 provenance and uses zero
embedding/reranker calls; it is **not** the external local RAG.

### Synthetic packets and complete turns

[`performance/packet-turns.json`](performance/packet-turns.json) uses actual
baseline/current packet helpers and orchestrators, a controlled model, fake CAS
engine with a confirmed physical-roll event, attached readback and real filesystem
fsync. Each complete-turn scenario has three warmups and 20 repetitions. It is
not a rules-engine integration or a model/network benchmark.

| Scenario | Before p50 / p95, ms | After p50 / p95, ms |
| --- | --- | --- |
| Referee packet, four sheets | 0.0323 / 0.0697 | 0.0085 / 0.0167 |
| Referee packet, eight sheets | 0.0291 / 0.0713 | 0.0094 / 0.0223 |
| Writer packet | 0.0024 / 0.0026 | 0.0008 / 0.0008 |
| Complete speech turn | 21.4937 / 22.6902 | 23.4421 / 25.8369 |
| Complete mechanical turn | 46.1441 / 47.9511 | 45.6647 / 48.8007 |

Writer JSON fell **458 -> 351 bytes**. Referee JSON grew by **57 bytes** because
restoring `party`/`members` adds more than removing the duplicate scene saves in
that fixture; this is an intentional correctness cost. In the separate turn
fixture those fields are absent, so 20 speech turns use **9,040 -> 8,520** model
input bytes and 20 mechanical turns **28,430 -> 27,390**. These are packet bytes,
not provider token counts or all trusted-policy bytes.

Model calls remain **20 -> 20** for speech and **40 -> 40** for mechanical turns.
MCP calls remain **40 -> 40** and **80 -> 80**, including a fresh catalog per
fixture host and the physical-roll read. Checkpoint writes remain **140 -> 140**
and **280 -> 280**. RAG/DB work is explicitly stubbed in these turn fixtures.
Filesystem latency dominates them; the recorded speech turn is slower, so no
whole-turn improvement is claimed. Further coalescing was not justified at the
expense of durable command intent, attempts, receipt, cursor or model budget.

### Actual external RAG kernel

[Local RAG discovery](local-dnd-rag.md) records the actual implementation and
read-only benchmark. Warm query plus per-query client setup is **153.904 /
256.329 ms** p50/p95 with `top_k=8, compact=True`. Import/startup and model init are separate single cold
observations, **18.727 s** and **9.142 s**. Twenty repeated warm queries already
hit the embedding cache, but still perform twenty dense and lexical searches.
No runtime code there was changed, no before/after improvement is claimed, and
the configured reranker is disabled. An ambiguous query was measured without a
reranker; the requested ambiguous-with-reranker case remains untested.

## Reproduce And Trace

```sh
node scripts/benchmark-narrator-db-milestone.mjs --write
node scripts/benchmark-narrator-turns.mjs --write
python3 scripts/test-benchmark-local-dnd-rag.py
/mnt/c/Users/fireo/mcp-rag/.venv/bin/python scripts/benchmark-local-dnd-rag.py
ODM_LATENCY_LOG=1 node scripts/benchmark-narrator-db-milestone.mjs --worker \
  > /tmp/opencode/db-fixture.json 2> /tmp/opencode/db-trace.log
node scripts/summarize-latency.mjs /tmp/opencode/db-trace.log
```

`--write` intentionally refreshes generated benchmark reports. The DB comparison
requires Git, tar and installed dependencies; it never switches the working
branch. The RAG script is opt-in and rejects non-loopback or incompatible targets.

[`performance/trace-summary.tsv`](performance/trace-summary.tsv) demonstrates
p50/p95 aggregation from captured **local DB + controlled-model fixture** logs,
not a live turn. Source logs were kept under `/tmp/opencode/odm-trace-*.log`.
Nested spans are not additive. A zero aggregate means no counter was emitted for
that stage, not proof that the corresponding whole-game work never happened.
Production host cycles have opaque process-local trace IDs; there is no cross-HTTP
correlation propagation or player acceptance/browser-delivery trace yet.

## Validation And Limits

The final focused command covers **233 passed, 0 failed, 0 skipped**:

```sh
node --experimental-vm-modules --test scripts/test-narrator-*.mjs \
  scripts/test-latency-trace.mjs scripts/test-packet-performance.mjs \
  scripts/test-dm-player-boundary.mjs scripts/test-spatial-event-privacy.mjs \
  scripts/test-mcp-readiness-p1.mjs scripts/test-mcp-narrator-control.mjs \
  scripts/test-ask.mjs scripts/test-merge-mcp-registration.mjs \
  scripts/test-review-mcp-http.mjs
node_modules/.bin/tsc --noEmit --incremental false
```

TypeScript passed. The Python benchmark instrumentation has **3 passing tests**.
Safety coverage includes exact UUID recovery, no replay after committed-readback
failure, stale CAS, pending physical rolls, stop/rewind during generation, Ask
isolation, real room/witness projection, schema rollback/recreation and the new
schema-version ABA reproduction. The MCP flattened package import is tested.
Outdated harnesses were repaired to load real privacy/commit modules, not to
stub their access decisions or relax privacy assertions.

The full repository suite is **not green**: the 262-script inventory plus two
verified targeted reruns has **250 passing scripts and 12 failing scripts**
(including one bounded timeout). All twelve already failed in the baseline;
nine previously failing suites were repaired. The baseline was 238/259 passing,
with 21 failures. These are script counts, not individual assertion counts.
The exact inventory, targeted reruns and remaining names are recorded in
[`performance/validation.json`](performance/validation.json). It must not be
reported as a complete successful `npm test` run. No Next/Docker build, Windows
execution, Node 22 run, production load test, live model/provider call, browser
delivery test or real gameplay replay was performed here.

External RAG source/result caching, scoped single-flight/cancellation,
edition/source/corpus invalidation, changed-chunk indexing, foreground scheduling
and retrieval QA remain open. The shared external engine has existing local
changes and lacks the necessary D&D revision/scope/golden-set contract. Its
clients and import/model cold starts are measured remaining costs, not solved
by an unused proxy in this repository. See the exact external follow-up paths in
[local-dnd-rag.md](local-dnd-rag.md).

The complete changed-file inventory relative to the fetched baseline is in
[`performance/changed-files.txt`](performance/changed-files.txt).
