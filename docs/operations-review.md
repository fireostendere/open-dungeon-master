# Coordinated operations and review regressions

The application controller owns web/MCP release transitions and Caddy ingress.
Mutating entrypoints share the installation's `.ops.lock`; following logs and
read-only status/token lookup do not hold that writer lock. The Linux bootstrap
passes a verified inherited descriptor, not an environment-only bypass.

## Release and recovery

Both images are prepared and their digests recorded before downtime. Writers are
stopped for a consistent snapshot and the transition is journaled. A candidate MCP
container has neither a published port nor the `mcp` alias before its health gate.
The original container remains available for coordinated rollback. A failed
recovery keeps the journal for `odmctl start`; do not delete transaction.json to
silence errors. Rolling back game code must not downgrade the operations controller
to a legacy version lacking the common lock.

Caddy has one renderer in `deploy/odmctl.py`. It binds only `config/caddy`, not the
secrets directory or a replaceable single-file inode. Candidate validation precedes
atomic replacement and proxy recreation. Manifest generation and restore-check do
not activate ingress. Public `/api/internal` paths return 404 through managed
Caddy, while `/mcp` routes to the sidecar. Direct application-port exposure still
requires authentication and its own network access policy.

Run the current installer to migrate the operations bundle and retire this root's
legacy MCP timer. It waits for a running old MCP operation instead of killing a
transition. The source changes do not themselves prove a deployed instance was
migrated; inspect the installed controller, service units and release metadata.

## Commands

```sh
odmctl status
odmctl logs -f --tail 200
odm-mcpctl status
odm-mcpctl token
```

`token` prints a private path. `token --show` explicitly prints the bearer: use it
only in a private terminal and never paste the output into an issue or shared chat.
The stdio command requires preload:

```sh
docker exec -i CONTAINER node --import /app/external-tools-preload.mjs /app/server.mjs --stdio
```

Use the actual container name from status. Source checkout:

```sh
npm ci --prefix mcp
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs --stdio
```

Supply the matching `ODM_MCP_TOKEN` and `ODM_MCP_CONTROL_URL` in the environment.

## Retention

```sh
odmctl retention                 # preview
odmctl retention --apply         # apply current policy
odmctl retention --apply --prune # also reclaim restic data
```

A healthy running installation, confirmed backup and no pending transaction are
required. Active/previous releases, rollback/last-backup snapshots and operator
pins are protected. All ODM snapshot classes, including pre-update/pre-restore,
participate in rolling retention. Foreign snapshots, dirty/foreign worktrees,
unknown files and unlabelled Docker images are preserved. There is no global
Docker prune or removal of live state.

Defaults in `config/retention.json`:

```json
{"keepReleases":5,"keepDisplaced":2,"keepLast":4,"keepDaily":7,"keepWeekly":4,"keepMonthly":6}
```

Each value is an integer from 1 through 100. `config/retention-pins.json` accepts
arrays `snapshotIds`, `releaseShas`, `stateDirs` with real inspected identifiers.
The restic tag `odm-pin` also preserves snapshots. Review displaced states before
removing them. Local snapshots are not off-site disaster recovery.

## Verified execution

```sh
python3 scripts/test-review-ops.py
```

At source revision `298db3b15cc90eaf3d231c320b9a9911ee382851`, the actual committed
suite ran with Python 3.11.8: **36 tests passed, zero failures/errors/skips**. The
workspace files were checked against their Git blob hashes before execution.
The run took 2.697 seconds. It exercised real temporary files, real Git worktrees,
child processes and POSIX locks, with explicit Docker/restic/service-activation
test doubles. Cases include candidate/published MCP failure, ambiguous rename,
coordinated rollback, preserved failed-recovery journals, pure restore-check,
bootstrap idempotence, CLI parsing and bounded history.

This is the first verified operations-suite run in this continuation; the earlier
unsupported claim of 36 passing tests was withdrawn before this run. The new
result supplies evidence for the suite, **not** for an installed environment.
Docker/Caddy HTTPS, native Windows scheduling, real encrypted-SQLite restore and
actual SDK stdio remain unexecuted acceptance checks. See the review status file.
