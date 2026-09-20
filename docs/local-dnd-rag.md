# Local D&D RAG discovery and benchmark

## Confirmed boundary

The enabled D&D MCP is an external stdio process:
`/mnt/c/Users/fireo/mcp-rag/.venv/bin/python -m knowledge_base.cli serve` in
`/mnt/c/Users/fireo/mcp-rag`. Workspace and Codex D&D configuration both select
collection `dnd_srd` and data directory `/mnt/c/Users/fireo/mcp-rag/data_dnd`.
The unrelated engineering KB is disabled. The local Qdrant collection responded
green with 5,303 points; that is availability evidence, not a corpus revision.
Read-only `/proc` inspection also found two running `knowledge_base.cli serve`
processes selecting exactly this collection/data directory, neither with a
reranker environment override. Only these booleans were recorded, not process
environments or credentials. The outer workspace configuration and vault are
outside this Git repository; `src/lib/dm/context-retrieval.ts` is not this path.

`knowledge_search` normally enters `_model_resources`, which calls `_stores`.
That path constructs `Registry`, calls `ensure_collection`, and verifies the
manifest. Those operations can initialize SQLite schema or Qdrant payload
indexes, so this benchmark **does not call it**: it must remain read-only against
the user-dirty external repository and data. The MCP process keeps embedding and
reranker singletons and schedules their release after the configured 600-second
idle period; its Qdrant client is reopened for a query resource context.

## What is measured

`scripts/benchmark-local-dnd-rag.py` is classified as
`direct_engine_kernel_per_query_client_lifecycle`, not `knowledge_search` or
end-to-end MCP latency. It uses the external engine's real `search.search`,
FastEmbed dense/BM25 sparse retrieval, and per-query `VectorStore`/bounded client
setup. It deliberately bypasses `Registry`, `_stores`, and `ensure_collection`.
The result explicitly says `actual_mcp_query_lifecycle: not_measured_write_risk`.

The benchmark accepts explicit `--external-root`, `--data-dir`, and
`--collection` values, but rejects a collection other than `dnd_srd` or data
outside the selected external root. It requires Qdrant to resolve exclusively to
loopback, requires an existing collection, and reads the compatibility manifest
through SQLite `mode=ro`. It sets model hubs offline, has a 180-second child
timeout, and exits nonzero with a content-free error class if incomplete.

It uses only fixed public SRD phrases; it never starts a service, ingests,
rebuilds, downloads, reads ODM/campaign SQLite, or emits text, document IDs,
room IDs, prompts, secrets, or engine error messages. Citation identity hashes
the real hit fields (`source`, `document_id`, `page_start`, `page_end`,
`section`) only in memory. Empty/error results cannot pass deterministic checks.

Run it with:

```sh
/mnt/c/Users/fireo/mcp-rag/.venv/bin/python scripts/benchmark-local-dnd-rag.py \
  > docs/performance/local-dnd-rag-YYYY-MM-DD.json
python3 scripts/test-benchmark-local-dnd-rag.py
```

The default is at least 20 warm and ambiguous samples plus five concurrent batches
of width four. Each scenario reports query API calls, real model-query inferences,
cache hits, dense/BM25/rerank counts and accessible stage durations. Client setup,
query duration and their paired sum are reported separately; `vector_ms` is the
combined dense/sparse Qdrant hybrid search, not an isolated lexical timing. Concurrent
output separates batch wall time from caller latency and records failures as
errors; a partial run is incomplete rather than successful.

## Recorded direct-engine kernel run

[`performance/local-dnd-rag-2026-09-20.json`](performance/local-dnd-rag-2026-09-20.json)
records import/startup 18,726.786 ms, model init/dimension probe 9,142.310 ms,
and total process wall 38,748.931 ms (including every scenario and cleanup).
The first query was 328.137 ms, or 405.500 ms including client setup.
Twenty warm queries were 81.343 / 130.620 ms p50/p95; their client setup was
66.829 / 142.223 ms and paired setup-plus-query was 153.904 / 256.329 ms.
Five four-caller batches were 459.280 / 528.888 ms wall; per caller including
setup was 382.727 / 486.646 ms. Twenty warm identical queries made zero model
query inferences, but still made twenty dense and twenty lexical searches.
Citation identities were deterministic with zero errors. Reranking
was not configured and ran zero times; these results do not exercise it and make
no before/after or runtime-optimization claim.

## Deliberate non-optimizations

No D&D golden set, reliable content-revision token, or campaign/edition/audience
retrieval contract was found. No new result cache, single-flight layer or
confidence threshold was added. The existing query-embedding cache is per model
instance and exact query string; the benchmark observes it, it does not implement
it. Campaign mechanics never go behind this cache. The external working tree has
pre-existing changes in embedding/search/MCP/metadata and tests; none were edited.

## External Work Remaining

- `mcp_server.py:_model_resources/_stores`: keep clients and registries warm with
  bounded idle/shutdown cleanup and unchanged manifest checks. This does not need
  a response cache, but requires a separate change to the shared external engine.
- `embed.py`: make model initialization/cache/in-flight ownership safe for
  simultaneous callers and independent cancellation; preserve the selected model.
- `search.py` / corpus metadata: define a real revision and edition/source/scope
  contract before caching retrieved results or calibrating reranker skips.
- `ingest.py:135-153,181-196`: unchanged document hashes and identical-content
  aliases already avoid re-embedding; changed documents embed all their chunks
  in batches of 32. This is document-level, not changed-chunk indexing. No ingest
  or rebuild was run, and foreground priority against a large indexing job was
  not verified or implemented. The search path itself does not start ingestion.
- The local Codex instructions still prescribe `knowledge_search` for rule
  questions. No automatic host in this repository calls that MCP tool: adding an
  unused proxy here would not optimize the running installation. Use already
  confirmed state and known exact document IDs when adequate, but retain genuine
  rules/lore lookups. No new keyword gate or extra summarizing LLM was introduced.

Edition/source, corpus invalidation, campaign/epoch/audience cache separation,
retrieval single-flight/cancellation, exact-D&D-rule reranker bypass and indexing
priority tests are **not covered** by this measurement. The fake-engine tests
validate counters, cache-hit accounting, citation comparison and failure reporting,
not those missing runtime features. This completes discovery and measurement,
not the requested external-RAG optimization phase.
