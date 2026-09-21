# Host-mediated D&D rules RAG

The narrator model does not receive the knowledge MCP, shell access, or any other
tool. Rules retrieval is owned by the trusted narrator host.

Flow:

```text
referee model (deny-all OpenCode session)
        |
        | {"kind":"rules_lookup","query":"..."}
        v
narrator/run.mjs
        |
        | persistent stdio JSON-RPC
        v
knowledge_base.dnd_mcp_server
        |
        | read-only: rules_search/get/sources/status
        v
dnd_srd Qdrant + registry SQLite mode=ro
```

The returned evidence is bounded and marked `untrusted:true`. It is appended to
the current input's authoritative outcomes and reaches the next referee step
through the sticky-session packet delta. It cannot authorize another tool or
change campaign state. Exact repeated lookups reuse the prior outcome once and
then fail closed instead of producing an unbounded retrieval loop.

For private Ask with `scope:"rules"`, the host performs one rules search before
the Ask model call. Campaign/story Ask does not trigger rules retrieval.

## Configuration

Nothing in OpenCode needs to be changed. Keep narrator role permissions deny-all.
Configure the narrator host process instead:

```sh
export ODM_RULES_MCP_PYTHON=/absolute/path/to/mcp-rag/.venv/bin/python
export ODM_RULES_EDITION='your-corpus-edition'
export ODM_RULES_MCP_COLLECTION=dnd_srd

# These are consumed by mcp-rag's normal settings loader:
export KB_DATA_DIR=/absolute/path/to/mcp-rag/data_dnd
export QDRANT_URL=http://127.0.0.1:6333

# Optional:
export ODM_RULES_MCP_TIMEOUT_MS=15000
export ODM_RULES_MCP_TOP_K=3
```

`ODM_RULES_MCP_PYTHON` must be an absolute executable path. If it is unset,
rules RAG is disabled and the narrator behaves as before. If it is set but the
edition or collection contract is wrong, the lookup fails closed; it never falls
back to the engineering corpus.

The child process is always launched as:

```text
<ODM_RULES_MCP_PYTHON> -m knowledge_base.dnd_mcp_server
```

No shell is used. At initialization the host requires the server to advertise
exactly four tools: `rules_search`, `rules_get`, `rules_sources`,
`rules_status`. Any broader tool surface is rejected.

## Efficiency and cache semantics

The D&D MCP uses raw hybrid dense+BM25 retrieval rather than engineering
part-number expansion/classification. The retrieval process keeps one validated
Qdrant client warm for the configured idle window and has a bounded exact-result
cache with single-flight concurrency. Search cache keys contain
`corpus_revision`, so ingest/rebuild changes invalidate prior results without a
manual clear.

The narrator host keeps one OpenCode referee session only for the immediate
multi-step resolution of one input. The first referee packet is complete;
subsequent steps use `odm.role.delta.v1` when the delta is materially smaller.
A physical-roll wait, explicit wait, pause, error, rewind, completion or input
change closes the sticky session. Ask, writer and actor roles remain isolated
one-shot sessions.

Provider accounting still treats the accumulated sticky conversation as model
context. If OpenCode reports real usage, that usage wins; otherwise ODM's fallback
budget estimate includes prior prompts and model outputs rather than counting
only the latest delta.
