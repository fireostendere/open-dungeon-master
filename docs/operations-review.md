# Coordinated operations and review regressions

## Release boundary

`odmctl` is the sole owner of web/MCP transitions and HTTPS ingress. Install, start,
update, restore, backup, watchdog and direct `odm-mcpctl sync` use the same
installation-local `.ops.lock`. Status, token-path lookup and following logs are
read-only and do not hold that writer lock. The Linux bootstrap passes a verified
inherited lock descriptor; no environment flag can bypass locking.

An update builds and checks both images before downtime, records their digests,
backs up stopped writers, and journals the transition. MCP candidates have no
published port or `mcp` network alias until their health check succeeds. The old
container remains available through the coordinated gate. A failed transition
restores the prior web/MCP release, game state and credentials; a failed recovery
keeps its journal for the next `odmctl start`. Do not delete transaction.json to
silence a failed recovery.

Caddy has one renderer in `deploy/odmctl.py`. It mounts only `config/caddy`, not the
secrets directory. A candidate is validated before atomic replacement; the proxy
is explicitly recreated to activate the validated configuration. `/api/internal`
and descendants return 404 publicly; `/mcp` goes to the sidecar. Manifest creation
and `restore-check` do not activate or rewrite live ingress.

Use an isolated test installation before deploying this branch. Run the current
installer to migrate the operations bundle and retire this installation's old
MCP timer. It waits for an already-running legacy MCP operation rather than
killing a transition. A legacy game rollback does not downgrade the new operations
controller to a version that lacks the shared lock.

## CLI

```sh
odmctl status
odmctl logs -f --tail 200
odm-mcpctl status
odm-mcpctl token
```

`token` prints the private file path, not the bearer secret. `token --show` is the
explicit secret-disclosure command; run it only in a private terminal. Never paste
its output into an issue or a chat. Status includes a stdio argument array. The
managed equivalent is:

```sh
docker exec -i CONTAINER node --import /app/external-tools-preload.mjs /app/server.mjs --stdio
```

The preload is mandatory for `odm_assets` and `odm_progress`. Local source launch:

```sh
npm ci --prefix mcp
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs --stdio
```

Provide `ODM_MCP_TOKEN` and `ODM_MCP_CONTROL_URL` through the process environment.
Do not include the token in command arguments or commit it to the repository.

## Retention

```sh
odmctl retention                 # preview only
odmctl retention --apply         # apply the displayed policy
odmctl retention --apply --prune # also reclaim unreferenced restic data
```

Retention runs only for a healthy, running installation with a confirmed backup
and no pending transaction. Active/previous releases, rollback and last-backup
snapshots, and operator pins are preserved. All `odm` snapshot classes—including
pre-update and pre-restore—participate in one rolling policy. Non-ODM snapshots,
dirty/foreign worktrees, unknown files and unlabelled Docker images are not removed.
No global Docker prune or deletion of live state is performed.

Defaults in `config/retention.json`:

```json
{"keepReleases":5,"keepDisplaced":2,"keepLast":4,"keepDaily":7,"keepWeekly":4,"keepMonthly":6}
```

Each value must be an integer from 1 through 100. Optional
`config/retention-pins.json` contains arrays named `snapshotIds`, `releaseShas` and
`stateDirs`; use actual inspected identifiers, not placeholders. The `odm-pin`
restic tag also preserves a snapshot. Review displaced states before retaining or
removing them. Automatic cleanup occurs only after a healthy committed release or
a successful backup-integrity check. Local retention is not off-site recovery.

## Executed versus unexecuted checks

```sh
python3 scripts/test-review-ops.py
```

36 behavioral tests pass in the isolated review workspace. They use real temporary
files, Git worktrees, child processes and POSIX locks, plus test doubles for Docker,
restic and service activation. They cover candidate/published MCP failures, rename
ambiguity, coordinated rollback, recovery-journal preservation, pure restore-check,
bootstrap idempotency, CLI parsing and bounded retention. They do **not** establish
that Docker/Caddy HTTPS deployment, native Windows scheduling or encrypted-SQLite
restore passed end to end. Those environment checks remain a release gate.
