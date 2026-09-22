# OpenCode DnD Edition: project MCP and local measurements

The obsolete remote `/mcp` URL returned HTML 404. The project now uses the
canonical `odm_narrator` namespace over SSH stdio. The launcher queries
`odm-mcpctl status` on every connection and executes its active sidecar command;
container names and bearer tokens are not copied into configuration.

From this checkout, configure the directory where OpenCode is launched:

```sh
python3 scripts/configure-opencode.py --workspace /path/to/dungeon_master --ssh-target user@odm-host
python3 scripts/test-opencode-project.py
```

The remote host must already provide SSH access, Python 3 and `odm-mcpctl`.
Setup preserves existing RAG connection details, uses this checkout's skills,
disables unrelated inherited `kb`, `diptrace` and `fabric` servers for this project,
and backs up an existing configuration once. An existing `dnd` RAG server and
`odm-ui-test` remain project connections. Install the companion custom_opencode
`astra` changes for project precedence, tool permissions, cancellation and skill
preloading. This script does not install a missing RAG service.

## Measurement

The real native model completed the same seeded local chest-inspection turn in
100.888 s before optimization and 54.122 s after it (46% less elapsed time).
Tool calls/errors fell from 12/4 to 6/0. Total input including cache reads fell
from 183,460 to 87,229 tokens (52%); uncached input from 40,100 to 28,349.
The intermediate 66.828 s run is retained in the JSON report.

[Sanitized results](performance/opencode-dnd-2026-09-22.json) contain counts,
operations and timings, without authentication tokens, private model reasoning or player data.
These are single runs, not latency percentiles or a billing guarantee. Baseline
means repaired MCP connectivity before the context/router/discovery improvements.
Provider cache state and server dice differed; the local fixture has no imported
SRD corpus and disables RAG for this particular turn. Production MCP connectivity
was checked separately; the production sidecar was not redeployed.

Additional direct local engine checks covered an item grant, gold, short rest,
combat start and server initiative (6.78–12.81 ms per successful write).
An attempted out-of-range melee attack was rejected by the engine. Cursor,
concurrent-write, privacy and roll-replay regressions passed unchanged.

## Reproduce

Requires installed Node/MCP dependencies, compatible Linux SQLite native modules,
and a running custom OpenCode service with an authenticated model provider.
Start a disposable local server in one terminal:

```sh
node scripts/serve-opencode-benchmark.mjs /tmp/odm-benchmark-state.json
```

In another terminal (this performs paid inference):

```sh
python3 scripts/benchmark-opencode.py --state /tmp/odm-benchmark-state.json --custom-opencode /path/to/custom_opencode --campaign optimized --output /tmp/odm-turn.json
```

Use a fresh server/campaign for each sample. Stop the fixture with Ctrl-C to
remove its temporary database and private state file. It serves the actual
Next authenticated control handler over loopback with real SQLite/engine code;
it does not start the browser UI or modify an existing campaign database.
